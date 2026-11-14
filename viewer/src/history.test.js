// The undo stack and the hash-checked write path (history.js) against a fake server that hashes its file the way
// the core does (by content) and answers 409 for a stale base.
import { describe, expect, test } from 'bun:test';
import { SceneHistory, diffScenes, applyChanges, Conflict } from './history.js';
import { splitInstance } from '../../core/scene.ts';

function fakeServer(scene) {
  let n = 0;
  const srv = {
    scene: structuredClone(scene), hash: 'h0', shown: null, sse: [], writes: 0,
    state() { return { hash: srv.hash, exists: true, scene: structuredClone(srv.scene), errors: [] }; },
    commit(next) { srv.scene = structuredClone(next); srv.hash = `h${++n}`; srv.sse.push(srv.state()); },
    // someone else writes (the CLI, Claude): the file changes and an SSE state goes out
    outside(edit) { const s = structuredClone(srv.scene); edit(s); srv.commit(s); },
    io: null,
  };
  const reply = async (base, next) => {
    srv.writes++;
    if (base !== srv.hash) return { error: 'stale', hash: srv.hash };
    if (next.instances.some((i) => !/^[\w-]+$/.test(i.id))) return { error: 'bad id', errors: ['bad id'] };
    srv.commit(next); return { ok: true, hash: srv.hash };
  };
  srv.io = {
    current: () => srv.shown,
    reload: async () => (srv.shown = srv.state()),
    put: (next, base) => reply(base, next),
    patch: (id, fields, base) => {
      const s = structuredClone(srv.scene), inst = s.instances.find((x) => x.id === id);
      for (const [k, v] of Object.entries(fields)) if (v == null) delete inst[k]; else inst[k] = v;
      return reply(base, s);
    },
  };
  srv.shown = srv.state();
  return srv;
}
// deliver the SSE states the way the viewer does: shown, then observed
const deliver = (srv, h) => { for (const st of srv.sse.splice(0)) { srv.shown = st; h.observe(st); } };
const start = () => {
  const srv = fakeServer({ version: 1, instances: [{ id: 'a' }, { id: 'b', at: [10, 0, 0] }] });
  const h = new SceneHistory(srv.io); h.observe(srv.state());
  return { srv, h };
};
const ids = (srv) => srv.scene.instances.map((i) => i.id);

describe('diff and apply', () => {
  test('a field change, an add, a remove; undo then redo is the identity', () => {
    const a = { version: 1, instances: [{ id: 'x' }, { id: 'y', at: [1, 2, 3] }, { id: 'z' }] };
    const b = { version: 1, instances: [{ id: 'x' }, { id: 'y', at: [4, 2, 3], color: '#ff0000' }, { id: 'w' }] };
    const c = diffScenes(a, b);
    expect(c.map((x) => x.id)).toEqual(['y', 'z', 'w']);
    expect(applyChanges(b, c, 'undo')).toEqual(a);
    expect(applyChanges(a, c, 'redo')).toEqual(b);
  });
  test('a rename puts the old id back in its place', () => {
    const a = { version: 1, instances: [{ id: 'p' }, { id: 'q', at: [1, 0, 0] }, { id: 'r' }] };
    const b = { version: 1, instances: [{ id: 'p' }, { id: 'q2', at: [1, 0, 0] }, { id: 'r' }] };
    expect(applyChanges(b, diffScenes(a, b), 'undo')).toEqual(a);
  });
  test('key order does not count as a change', () => {
    expect(diffScenes({ instances: [{ id: 'a', at: [1, 2, 3], color: '#000000' }] }, { instances: [{ color: '#000000', id: 'a', at: [1, 2, 3] }] })).toEqual([]);
  });
  test('an instance changed by someone else is a conflict, not overwritten', () => {
    const a = { version: 1, instances: [{ id: 'x', at: [0, 0, 0] }] }, b = { version: 1, instances: [{ id: 'x', at: [5, 0, 0] }] };
    const c = diffScenes(a, b);
    expect(() => applyChanges({ version: 1, instances: [{ id: 'x', at: [9, 0, 0] }] }, c, 'undo')).toThrow(Conflict);
  });
});

describe('SceneHistory', () => {
  test('local edits undo and redo through the server', async () => {
    const { srv, h } = start();
    expect((await h.setFields('b', { at: [20, 0, 0] })).ok).toBe(true); deliver(srv, h);
    expect((await h.setFields('b', { rot: [0, 0, 15] })).ok).toBe(true); deliver(srv, h);
    expect((await h.change('copy b', (s) => { s.instances.push({ ...s.instances[1], id: 'b2' }); return s; })).ok).toBe(true); deliver(srv, h);
    expect(h.undoStack.length).toBe(3);
    await h.undo(); deliver(srv, h);
    expect(ids(srv)).toEqual(['a', 'b']);
    await h.undo(); deliver(srv, h);
    expect(srv.scene.instances[1]).toEqual({ id: 'b', at: [20, 0, 0] });
    await h.redo(); deliver(srv, h);
    expect(srv.scene.instances[1]).toEqual({ id: 'b', at: [20, 0, 0], rot: [0, 0, 15] });
    expect(h.undoStack.length).toBe(2); expect(h.redoStack.length).toBe(1);
  });
  test('a split is one step; undo gives back the source exactly, with no parts list if it had none', async () => {
    const { srv, h } = start();
    const was = structuredClone(srv.scene), man = { parts: [{ name: 'box' }, { name: 'lid' }, { name: 'pin' }] };
    expect((await h.change('split lid out of b', (s) => splitInstance(s, man, 'b', 'lid'))).ok).toBe(true); deliver(srv, h);
    expect(srv.scene.instances).toEqual([{ id: 'a' }, { id: 'b', at: [10, 0, 0], parts: ['box', 'pin'] }, { id: 'lid', at: [10, 0, 0], parts: ['lid'] }]);
    expect(h.undoStack.length).toBe(1);
    await h.undo(); deliver(srv, h);
    expect(srv.scene).toEqual(was);
    await h.redo(); deliver(srv, h);
    expect(ids(srv)).toEqual(['a', 'b', 'lid']);
  });
  test('our own write coming back over SSE, before or after the reply, is not an outside change', async () => {
    const { srv, h } = start();
    const p = h.setFields('a', { color: '#112233' });
    deliver(srv, h);            // nothing yet: the write has not happened
    await p;
    deliver(srv, h);            // after the reply
    const q = h.setFields('a', { color: '#445566' });
    await q;                    // the SSE for it is delivered while... after: same thing, no outside entry
    deliver(srv, h);
    expect(h.undoStack.map((e) => e.source)).toEqual(['local', 'local']);
  });
  test('an outside change joins the stack and undo steps over it in order', async () => {
    const { srv, h } = start();
    await h.setFields('b', { at: [30, 0, 0] }); deliver(srv, h);
    srv.outside((s) => { s.instances[0].color = '#ff0000'; }); deliver(srv, h);
    expect(h.undoStack.map((e) => e.source)).toEqual(['local', 'outside']);
    await h.undo(); deliver(srv, h);                  // undoes the outside colour first
    expect(srv.scene.instances[0]).toEqual({ id: 'a' });
    expect(srv.scene.instances[1].at).toEqual([30, 0, 0]);
    await h.undo(); deliver(srv, h);
    expect(srv.scene.instances[1].at).toEqual([10, 0, 0]);
    await h.redo(); await h.redo(); deliver(srv, h);
    expect(srv.scene.instances[0].color).toBe('#ff0000');
    expect(srv.scene.instances[1].at).toEqual([30, 0, 0]);
  });
  test('a 409 reloads and reapplies once; the outside change is kept and recorded', async () => {
    const { srv, h } = start();
    srv.outside((s) => { s.instances[0].at = [0, 5, 0]; });      // not delivered yet: our base is stale
    const r = await h.setFields('b', { at: [40, 0, 0] });
    expect(r.ok).toBe(true);
    deliver(srv, h);
    expect(srv.scene.instances).toEqual([{ id: 'a', at: [0, 5, 0] }, { id: 'b', at: [40, 0, 0] }]);
    expect(h.undoStack.map((e) => e.source)).toEqual(['outside', 'local']);
  });
  test('a second 409 is reported, never forced', async () => {
    const { srv, h } = start();
    const io = srv.io, put = io.patch;
    io.patch = async (id, f, base) => { srv.outside((s) => { s.instances[0].n = (s.instances[0].n ?? 0) + 1; }); return put(id, f, base); };
    const r = await h.setFields('b', { at: [50, 0, 0] });
    expect(r.ok).toBe(false); expect(r.conflict).toBe(true);
    expect(srv.scene.instances[1].at).toEqual([10, 0, 0]);
    expect(h.undoStack.every((e) => e.source === 'outside')).toBe(true);
  });
  test('undo after an unseen outside change to the same instance: a conflict, said, nothing overwritten', async () => {
    const { srv, h } = start();
    await h.setFields('b', { at: [60, 0, 0] }); deliver(srv, h);
    srv.outside((s) => { s.instances[1].at = [61, 0, 0]; });     // not seen: undo's first write gets a 409
    const r = await h.undo();
    expect(r.ok).toBe(false); expect(r.conflict).toBe(true);
    expect(srv.scene.instances[1].at).toEqual([61, 0, 0]);
    // the outside change is on top now, the local move below it, so the next undo takes the outside one
    expect(h.undoStack.map((e) => e.source)).toEqual(['local', 'outside']);
    await h.undo(); deliver(srv, h);
    expect(srv.scene.instances[1].at).toEqual([60, 0, 0]);
    await h.undo(); deliver(srv, h);
    expect(srv.scene.instances[1].at).toEqual([10, 0, 0]);
  });
  test('a refused edit (400) leaves the stack alone and passes the errors on', async () => {
    const { srv, h } = start();
    const r = await h.change('rename', (s) => { s.instances[1].id = 'bad.id'; return s; });
    expect(r.ok).toBe(false); expect(r.errors).toEqual(['bad id']);
    expect(h.undoStack.length).toBe(0); expect(ids(srv)).toEqual(['a', 'b']);
  });
  test('two undos asked at once run one after the other', async () => {
    const { srv, h } = start();
    await h.setFields('a', { at: [1, 0, 0] }); deliver(srv, h);
    await h.setFields('b', { at: [2, 0, 0] }); deliver(srv, h);
    const writes = srv.writes;
    await Promise.all([h.undo(), h.undo()]); deliver(srv, h);
    expect(srv.scene.instances).toEqual([{ id: 'a' }, { id: 'b', at: [10, 0, 0] }]);
    expect(srv.writes - writes).toBe(2);              // no 409 and retry: the second waited for the first
    expect(h.redoStack.length).toBe(2);
  });
  test('a new change clears redo', async () => {
    const { srv, h } = start();
    await h.setFields('a', { scratch: true }); deliver(srv, h);
    await h.undo(); deliver(srv, h);
    expect(h.canRedo).toBe(true);
    srv.outside((s) => { s.instances[1].color = '#00ff00'; }); deliver(srv, h);
    expect(h.canRedo).toBe(false);
  });
  test('the first scene file: a default scene (hash none) is written by a patch', async () => {
    const srv = fakeServer({ version: 1, instances: [{ id: 'model' }] });
    srv.hash = 'none'; srv.shown = srv.state();
    const h = new SceneHistory(srv.io); h.observe(srv.state());
    expect((await h.setFields('model', { at: [1, 2, 3] })).ok).toBe(true);
    expect(srv.scene.instances[0].at).toEqual([1, 2, 3]);
    await h.undo();
    expect(srv.scene.instances[0]).toEqual({ id: 'model' });
  });
});
