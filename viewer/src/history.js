// Undo / redo for scene.json, and the one path every scene edit takes: hash-checked, reapplied once on a 409.
// Pure: no DOM, no fetch; the viewer hands it an io ({ current, reload, put, patch }) and feeds it every scene state
// the server sends (observe). Tests: history.test.js.
//
// An entry is a per-instance diff ({ id, before, after, bi, ai }: the instance before and after, null when it was
// not there, and its index each side), so undoing one entry restores those instances and leaves the rest of the scene
// alone. Every change joins the one stack: the viewer's own (a drag is one entry, a typed field one, a copy, a
// remove, a rename) and outside ones that arrive over SSE (the CLI, Claude, a hand edit, another tab). Undo walks it
// back whoever made the change; a new change of either kind clears redo.
//
// Writes name the hash they were based on. A 409 (someone wrote in between): reload, rebuild the edit on the fresh
// scene and send it once more; a second 409 is reported, never forced. Undo and redo also check that each instance
// they restore is still what the entry left it as; if not (an outside change touched it and was not seen yet), they
// say so instead of overwriting it.

const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
export const same = (a, b) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
const clone = (v) => (v == null ? null : structuredClone(v));

export class Conflict extends Error {
  constructor(ids) { super(`${ids.join(', ')} was changed elsewhere since; not overwritten (that change is on the stack now: undo it first)`); this.ids = ids; }
}

export function diffScenes(a, b) {
  const A = a?.instances ?? [], B = b?.instances ?? [];
  const ids = [...new Set([...A.map((x) => x.id), ...B.map((x) => x.id)])];
  const out = [];
  for (const id of ids) {
    const bi = A.findIndex((x) => x.id === id), ai = B.findIndex((x) => x.id === id);
    const before = bi < 0 ? null : A[bi], after = ai < 0 ? null : B[ai];
    if (!same(before, after)) out.push({ id, before: clone(before), after: clone(after), bi, ai });
  }
  return out;
}

// the scene with an entry's changes undone (dir 'undo': back to before) or redone ('redo': to after); Conflict when an
// instance is not what the other side says it should be now
export function applyChanges(scene, changes, dir) {
  const s = structuredClone(scene), list = s.instances;
  const now = (c) => (dir === 'undo' ? c.after : c.before), to = (c) => (dir === 'undo' ? c.before : c.after);
  const bad = changes.filter((c) => !same(list.find((x) => x.id === c.id) ?? null, now(c))).map((c) => c.id);
  if (bad.length) throw new Conflict(bad);
  for (const c of changes) if (!to(c)) list.splice(list.findIndex((x) => x.id === c.id), 1);
  const idx = (c) => (dir === 'undo' ? c.bi : c.ai);
  for (const c of changes.filter(to).sort((p, q) => idx(p) - idx(q))) {
    const i = list.findIndex((x) => x.id === c.id);
    if (i >= 0) list[i] = clone(to(c)); else list.splice(Math.min(Math.max(idx(c), 0), list.length), 0, clone(to(c)));
  }
  return s;
}

// one instance's fields set (null clears one), as the server's PATCH does it
export function withFields(scene, id, fields) {
  const s = structuredClone(scene), inst = s.instances.find((x) => x.id === id);
  if (!inst) throw new Error(`no instance "${id}"`);
  for (const [k, v] of Object.entries(fields)) if (v == null) delete inst[k]; else inst[k] = clone(v);
  return s;
}

const is409 = (r) => !r?.ok && typeof r?.hash === 'string' && !r.errors;

// io: current() -> the scene state shown now ({ hash, scene, errors }); reload() -> Promise of a fresh one (and shows
// it); put(scene, base) and patch(id, fields, base) -> Promise of { ok, hash } | { error, hash } (409) | { error, errors }
export class SceneHistory {
  constructor(io, { limit = 200 } = {}) {
    this.io = io; this.limit = limit;
    this.undoStack = []; this.redoStack = [];
    this.known = null;          // { hash, scene }: the last state accounted for (seen, or written by us)
    this.old = new Set();       // hashes our writes replaced: one arriving late is not a change
    this.busy = 0; this.queue = []; this.chain = Promise.resolve();
    this.onChange = () => {};
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  peek(which = 'undo') { return (which === 'undo' ? this.undoStack : this.redoStack).at(-1) ?? null; }

  // A scene state from the server (load, SSE, a reload). The first one is the start; a different one later is an
  // outside change and joins the stack. While a write of ours is in flight, states wait until it lands, so our own
  // write coming back over SSE is not mistaken for someone else's.
  observe(st) {
    if (!st?.scene || st.errors?.length || typeof st.hash !== 'string') return null;
    if (this.busy) { this.queue.push(st); return null; }
    return this.take(st);
  }
  take(st) {
    if (!st?.scene || st.errors?.length) return null;
    if (!this.known) { this.known = { hash: st.hash, scene: structuredClone(st.scene) }; return null; }
    if (st.hash === this.known.hash || this.old.has(st.hash)) return null;
    const changes = diffScenes(this.known.scene, st.scene);
    this.known = { hash: st.hash, scene: structuredClone(st.scene) };
    if (!changes.length) return null;
    const e = { label: `outside edit of ${changes.map((c) => c.id).join(', ')}`, source: 'outside', changes };
    this.push(e);
    return e;
  }
  push(e) {
    this.undoStack.push(e); this.redoStack.length = 0;
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.onChange();
  }
  wrote(base, hash, scene) {
    this.old.add(base); if (this.old.size > 50) this.old.delete(this.old.values().next().value);
    this.old.delete(hash);
    this.known = { hash, scene: structuredClone(scene) };
  }
  // one edit at a time, in the order asked (two quick ctrl-z's are two steps, not a race)
  exclusive(fn) {
    this.busy++;
    const run = async () => {
      // catch up first (states that came in while waiting, then what is shown), so the edit's diff starts from it
      for (const st of this.queue.splice(0)) this.take(st);
      this.take(this.io.current());
      try { return await fn(); }
      finally {
        this.busy--;
        if (!this.busy) { const q = this.queue.splice(0); for (const st of q) this.take(st); }
        this.onChange();
      }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }
  // Send something built from a scene state, once, and once more on a fresh state after a 409.
  // build(st) -> { next, send(base) } (may throw). Resolves { ok, next, st } or { ok: false, error, errors?, conflict? }.
  async attempt(build) {
    // what is shown may lag our last write (its SSE not back yet): then that write is the base
    let st = this.io.current();
    if (this.known && st && this.old.has(st.hash)) st = { hash: this.known.hash, scene: structuredClone(this.known.scene), errors: [] };
    for (let round = 0; round < 2; round++) {
      if (round) { st = await this.io.reload(); this.take(st); }
      if (!st?.scene || st.errors?.length) return { ok: false, error: `scene.json has errors: ${st?.errors?.[0] ?? 'unreadable'}` };
      let b;
      try { b = build(st); }
      catch (e) {
        if (e instanceof Conflict && !round) continue;          // maybe we were behind: look again
        return { ok: false, error: e.message, conflict: e instanceof Conflict };
      }
      const r = await b.send(st.hash);
      if (r?.ok) { this.wrote(st.hash, r.hash, b.next); return { ok: true, next: b.next, st }; }
      if (!is409(r)) return { ok: false, error: r?.error ?? 'save failed', errors: r?.errors };
    }
    return { ok: false, conflict: true, error: 'scene.json kept changing under this edit; not saved (nothing was overwritten)' };
  }

  // ---- the edits ----
  // fields of one instance (null clears one): PATCH, so only these fields are sent
  setFields(id, fields, label = `set ${Object.keys(fields).join(', ')} of ${id}`) {
    return this.edit(label, (st) => {
      const next = withFields(st.scene, id, fields);
      return { next, send: (base) => this.io.patch(id, fields, base) };
    });
  }
  // a whole new scene made from the current one (add, copy, remove, rename)
  change(label, make) {
    return this.edit(label, (st) => {
      const next = make(structuredClone(st.scene));
      return { next, send: (base) => this.io.put(next, base) };
    });
  }
  edit(label, build) {
    return this.exclusive(async () => {
      const r = await this.attempt(build);
      if (r.ok) {
        const changes = diffScenes(r.st.scene, r.next);
        if (changes.length) this.push({ label, source: 'local', changes });
      }
      return r;
    });
  }

  undo() { return this.step('undo'); }
  redo() { return this.step('redo'); }
  step(dir) {
    return this.exclusive(async () => {
      const from = dir === 'undo' ? this.undoStack : this.redoStack, to = dir === 'undo' ? this.redoStack : this.undoStack;
      const at = from.length - 1, e = from[at];
      if (!e) return { ok: false, error: `nothing to ${dir}` };
      from.splice(at, 1);
      const r = await this.attempt((st) => {
        const next = applyChanges(st.scene, e.changes, dir);
        return { next, send: (base) => this.io.put(next, base) };
      });
      if (r.ok) to.push(e);
      else from.splice(Math.min(at, from.length), 0, e);      // back where it was (below anything a reload added)
      return { ...r, entry: e };
    });
  }
}
