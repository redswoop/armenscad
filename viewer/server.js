// scad-viewer API: serves every model folder under a workspace root that has a viewer.json.
// The root is SCAD_ROOT (tools/browse sets it from the folder you point it at), default the
// workbench folder above viewer/. Models are found up to MAX_DEPTH folders down, so a workspace
// may hold <name>/viewer.json, <toy>/<name>/viewer.json or <group>/<toy>/<name>/viewer.json;
// the model name is the relative path ("toy/name").
// Each model gets its own state, file watcher, render cache and SSE clients,
// created lazily on first request. Routes are /api/models and /api/<model>/....
// What a model is (building, the cache, scene.json) lives in the core (../core); this file is HTTP, SSE and watching.
import { watch } from 'node:fs';
import { readFile, writeFile, stat, readdir, access, rename } from 'node:fs/promises';
import path from 'node:path';
import { compactJson, moduleSources, loadModel, buildParts, readScene, writeScene, editScene, setFields,
         SceneError, StaleError, SCENE_FILE, SCENE_SCAD } from '../core/index.ts';
import { bunHost, checkOpenscad } from '../core/bun.ts';

const PORT = parseInt(process.env.PORT ?? '3003', 10);
const HOST = process.env.HOST ?? '127.0.0.1';   // the API is unauthenticated: HOST=0.0.0.0 to reach it from the LAN
const ROOT = path.resolve(process.env.SCAD_ROOT ?? path.join(import.meta.dir, '..'));
const MAX_DEPTH = 3;
const CACHE = path.join(import.meta.dir, '.cache');
const host = bunHost();
const SKIP = new Set(['template', 'viewer', 'lib', 'tools', 'node_modules', 'stl', 'renders', 'ref']);

const exists = (p) => access(p).then(() => true, () => false);

// ---- models ----------------------------------------------------------
const models = new Map();   // name -> Model

const MODEL_RE = /^[\w.-]+(\/[\w.-]+){0,2}$/;   // "name", "toy/name", up to MAX_DEPTH segments
const REF_NAME = /^[\w][\w .()-]*\.(jpe?g|png|webp|gif)$/i;   // what counts as a reference image in <model>/ref/
const PRESETS = ['iso', 'top', 'front', 'side', 'under'];

// next free id with this prefix: a1, a2, ... (annotations) or o1, o2, ... (overlays)
function nextId(list, prefix) {
  let max = 0;
  for (const x of list) { const m = String(x.id ?? '').match(new RegExp(`^${prefix}(\\d+)$`)); if (m) max = Math.max(max, +m[1]); }
  return `${prefix}${max + 1}`;
}

async function subdirs(dir) {
  const out = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    if (d.isDirectory() && !d.name.startsWith('.') && !SKIP.has(d.name)) out.push(d.name);
  }
  return out;
}

async function listModelNames(rel = '', depth = 1, out = []) {
  for (const d of await subdirs(path.join(ROOT, rel))) {
    const name = rel ? `${rel}/${d}` : d;
    if (await exists(path.join(ROOT, name, 'viewer.json'))) out.push(name);
    if (depth < MAX_DEPTH) await listModelNames(name, depth + 1, out);   // a model may also hold sub-models (matx_case/modcase)
  }
  return rel ? out : out.sort();
}

async function getModel(name) {
  if (models.has(name)) return models.get(name);
  if (!MODEL_RE.test(name) || SKIP.has(name.split('/')[0])) return null;
  const dir = path.join(ROOT, name);
  if (!(await exists(path.join(dir, 'viewer.json')))) return null;
  // The await above lets a second first-request in: without this re-check both create a Model, the map keeps one, and
  // the orphan keeps its watcher and builds into the same cache in parallel. Its openscad truncates a part's STL just
  // as the live build stats it: one part "failed" (0 tris, empty log) at random (devastator/hip, 2026-11-13).
  if (models.has(name)) return models.get(name);
  const m = new Model(name, dir);
  models.set(name, m);
  m.scheduleBuild();
  return m;
}

class Model {
  constructor(name, dir) {
    this.name = name;
    this.dir = dir;
    this.cache = path.join(CACHE, name);
    this.clients = new Set();
    this.buildTimer = null;
    this.buildQueued = false;
    this.state = {
      model: name,
      project: dir,
      file: null,
      reference: null,
      parts: [],          // { name, call, color, group, reference, tris, ms, ok, log }; reference: a presence part (an LDraw brick, a bought part) the design is fitted to, drawn behind it
      params: [],         // { section, name, value, comment, line }
      source: '',
      overrides: {},
      building: false,
      builtAt: null,
      buildMs: 0,
      error: null,
    };
    // notes: <model>/annotations.json (strokes, arrows, traced points, overlay placement). The server owns
    // the file: every write goes through mutateNotes(), which serialises, bumps rev and broadcasts.
    this.notes = null;          // parsed doc, loaded on first use
    this.notesText = null;      // exact text last written or read, to tell our own writes from outside edits
    this.notesQueue = Promise.resolve();
    this.view = null;           // last pose pushed to the browser via POST /view
    this.viewSeq = 0;
    this.camera = null;         // what the browser reports it is showing (PUT /view)
    this.stl = () => null;      // part name -> its cached STL, from the last build
    this.keys = new Set();      // that build's cache keys, kept through the next build's prune
    // A scene may show parts of other folders (scene.json "use"). Each folder is built by its own Model, once:
    // this one asks them for their parts as the files say (base: no Parameters-panel overrides) and rebuilds
    // when one of them does. base: this model's own such build, for the models that use it.
    this.base = null;           // { parts, stl } of the last build without overrides
    this.uses = new Map();      // component rel ("../knee") -> its Model, as of the last build
    this.dependents = new Set();   // Models whose scenes use this one
    this.waiting = [];          // resolvers for whenBuilt()
    this.fresh = false;         // POST /build: render again even what the cache has
    // scene.json: written through the core (one writer at a time here); sceneHash is the last text we wrote or
    // sent, so our own write echoing back through the watcher is not sent twice
    this.sceneQueue = Promise.resolve();
    this.sceneHash = null;
    // Only the .scad files and viewer.json affect the build (not _scene.scad, which is generated from scene.json).
    // annotations.json and scene.json changes are reloaded and sent, not rebuilt.
    this.watcher = watch(dir, (ev, file) => {
      if (!file) return;
      if (file === 'viewer.json' || (file.endsWith('.scad') && file !== SCENE_SCAD)) this.scheduleBuild();
      else if (file === 'annotations.json') this.reloadNotes();
      else if (file === SCENE_FILE) this.reloadScene();
    });
    console.log(`[${name}] watching ${dir}`);
  }

  // ---- notes ----
  get notesPath() { return path.join(this.dir, 'annotations.json'); }

  async loadNotes() {
    if (this.notes) return this.notes;
    try {
      const text = await readFile(this.notesPath, 'utf8');
      const doc = JSON.parse(text);
      if (doc.version !== 1) throw new Error(`annotations.json version ${doc.version}, expected 1`);
      doc.annotations ??= []; doc.overlays ??= []; doc.rev ??= 0;
      this.notes = doc; this.notesText = text;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      this.notes = { version: 1, rev: 0, updated: null, annotations: [], overlays: [] };
    }
    return this.notes;
  }

  // An outside edit (hand edit, Dropbox sync, CLI import through another path). Content compare, not
  // mtime: Dropbox touches mtimes without changing bytes, and our own write echoes back through the watcher.
  async reloadNotes() {
    let text;
    try { text = await readFile(this.notesPath, 'utf8'); } catch { return; }
    if (text === this.notesText) return;
    try {
      const doc = JSON.parse(text);
      doc.annotations ??= []; doc.overlays ??= []; doc.rev ??= 0;
      if (this.notes && doc.rev < this.notes.rev) return;     // a stale read that raced one of our own writes
      this.notes = doc; this.notesText = text;
      console.log(`[${this.name}] annotations.json changed on disk, rev ${doc.rev}`);
      this.broadcast('annotations', doc);
    } catch (e) { console.log(`[${this.name}] annotations.json unreadable: ${e.message}`); }
  }

  // fn(doc) mutates in place and may return a value, which mutateNotes resolves with (plus rev).
  mutateNotes(fn) {
    const run = async () => {
      const doc = await this.loadNotes();
      const result = fn(doc);
      doc.rev++; doc.updated = new Date().toISOString();
      const text = compactJson(doc);
      await writeFile(this.notesPath + '.tmp', text);
      await rename(this.notesPath + '.tmp', this.notesPath);
      this.notesText = text;
      this.broadcast('annotations', doc);
      return { ...(result ?? {}), rev: doc.rev };
    };
    const p = this.notesQueue.then(run, run);
    this.notesQueue = p.catch(() => {});
    return p;
  }

  // ---- scene: <model>/scene.json, through the core ----
  async scene() {
    try { return await readScene(host, this.dir); }
    catch (e) { return { hash: null, exists: false, scene: null, parts: [], offers: {}, components: [], errors: [String(e.message ?? e)] }; }   // no readable viewer.json
  }

  // An outside edit (the CLI, Claude, a hand edit): send it, no rebuild; placement never runs OpenSCAD.
  async reloadScene() {
    const st = await this.scene();
    if (st.hash === this.sceneHash) return;
    this.sceneHash = st.hash;
    console.log(`[${this.name}] scene.json changed on disk, ${st.hash}`);
    this.broadcast('scene', st);
    this.sceneChanged(st);
  }
  // A scene that now uses a folder it did not (or no longer does) needs that folder's parts: build, which is
  // only the asking when everything is cached. And whoever uses this model shows this scene: they build too.
  sceneChanged(st) {
    const now = st.components.map((c) => c.rel).sort().join('\n'), was = [...this.uses.keys()].sort().join('\n');
    if (now !== was) this.scheduleBuild();
    for (const d of this.dependents) d.scheduleBuild();
  }

  // write(base) -> new hash; runs one at a time, then sends the scene to every tab
  mutateScene(write) {
    const run = async () => {
      this.sceneHash = await write();
      const st = await this.scene();
      this.sceneHash = st.hash;
      this.broadcast('scene', st);
      this.sceneChanged(st);
      return { hash: st.hash };
    };
    const p = this.sceneQueue.then(run, run);
    this.sceneQueue = p.catch(() => {});
    return p;
  }

  // ---- reference images: <model>/ref/*.jpeg|png|webp|gif, captions in ref/index.json ----
  get refDir() { return path.join(this.dir, 'ref'); }

  async listRefs() {
    let files = [];
    try { files = await readdir(this.refDir, { withFileTypes: true }); } catch { return []; }
    let index = {};
    try { index = JSON.parse(await readFile(path.join(this.refDir, 'index.json'), 'utf8')).images ?? {}; } catch {}
    const out = [];
    for (const f of files) {
      if (!f.isFile() || !REF_NAME.test(f.name)) continue;
      const s = await stat(path.join(this.refDir, f.name));
      const meta = index[f.name] ?? {};
      out.push({ name: f.name, size: s.size, mtime: s.mtime.toISOString(), caption: meta.caption ?? null,
                 view: meta.view ?? null, scale: meta.scale ?? null });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Serve one image. The name is one path segment, whitelisted by extension, and must resolve inside ref/.
  async refFile(rawName, req) {
    let name;
    try { name = decodeURIComponent(rawName); } catch { return json({ error: 'bad name' }, 400); }
    if (!REF_NAME.test(name) || name.includes('/') || name.includes('\\') || name.includes('..') || name.includes('\0'))
      return json({ error: 'bad name' }, 400);
    const full = path.resolve(this.refDir, name);
    if (!full.startsWith(path.resolve(this.refDir) + path.sep)) return json({ error: 'bad name' }, 400);
    let s;
    try { s = await stat(full); } catch { return json({ error: 'no such image' }, 404); }
    const etag = `"${s.size}-${Math.round(s.mtimeMs)}"`;
    if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag } });
    return new Response(Bun.file(full), { headers: { etag, 'cache-control': 'private, max-age=86400' } });
  }

  publicState() {
    const { source, ...rest } = this.state;
    return { ...rest, clients: this.clients.size };
  }

  broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    let sent = 0;
    for (const c of this.clients) {
      try { c.enqueue(msg); sent++; }
      catch { this.clients.delete(c); }          // client went away without cancel()
    }
    if (event === 'built') console.log(`[${this.name}] built in ${data.buildMs}ms, notified ${sent} client(s)`);
  }

  scheduleBuild() { clearTimeout(this.buildTimer); this.buildTimer = setTimeout(() => { this.buildTimer = null; this.build(); }, 250); }
  // resolves once a build has finished and none is running or about to
  whenBuilt() {
    if (this.state.builtAt && !this.state.building && !this.buildTimer && !this.buildQueued) return Promise.resolve();
    return new Promise((res) => this.waiting.push(res));
  }
  // The parts of the other folders the scene uses, from their own Models (built there, cached there, watched
  // there). Each is listed under src <rel>/<name>, which is what the scene's placed parts name.
  async usedParts() {
    const st = await this.scene();
    const parts = [], stls = new Map(), uses = new Map();
    for (const c of st.components) {
      const name = path.relative(ROOT, c.dir).split(path.sep).join('/');
      const m = name.startsWith('..') ? null : await getModel(name);
      if (!m) throw new Error(`the scene uses ${c.rel}, which is ${name.startsWith('..') ? `outside the workspace (${ROOT})` : 'not a model the viewer can open'}`);
      uses.set(c.rel, m);
      await m.whenBuilt();
      m.dependents.add(this);       // after the wait: its finishing build would only ask this one to build again
      if (m.state.error) throw new Error(`${c.rel}: ${m.state.error}`);
      for (const p of m.base?.parts ?? []) {
        const src = `${c.rel}/${p.name}`;
        parts.push({ ...p, src, component: c.rel, model: name, file: m.state.file });
        stls.set(src, m.base.stl(p.name));
      }
    }
    for (const [rel, m] of this.uses) if (uses.get(rel) !== m) m.dependents.delete(this);
    this.uses = uses;
    return { parts, stls };
  }

  async build() {
    const state = this.state;
    if (state.building) { this.buildQueued = true; return; }
    state.building = true; state.error = null;
    this.broadcast('building', {});
    const t0 = performance.now();
    try {
      const m = await loadModel(host, this.dir);
      state.file = m.manifest.file;
      state.reference = m.manifest.reference ?? null;
      state.source = m.source;
      state.params = m.params;
      const fresh = this.fresh; this.fresh = false;
      // as the files say, then (only while the Parameters panel has values in play) with those on top
      const base = await buildParts(host, m, this.cache, { keep: this.keys, fresh });
      const tried = Object.keys(state.overrides ?? {}).length > 0;
      const built = tried ? await buildParts(host, m, this.cache, { overrides: state.overrides, keep: new Set([...this.keys, ...base.keys.values()]), fresh }) : base;
      this.base = base;
      this.keys = new Set([...base.keys.values(), ...built.keys.values()]);
      state.parts = built.parts;
      this.stl = built.stl;
      const used = await this.usedParts();
      state.parts = [...built.parts, ...used.parts];
      this.stl = (src) => used.stls.get(src) ?? built.stl(src);
    } catch (e) {
      state.error = String(e.message ?? e);
    }
    state.building = false;
    state.builtAt = new Date().toISOString();
    state.buildMs = Math.round(performance.now() - t0);
    this.broadcast('built', this.publicState());
    if (this.buildQueued) { this.buildQueued = false; this.build(); return; }
    for (const res of this.waiting.splice(0)) res();
    for (const d of this.dependents) d.scheduleBuild();
  }
}

// ---- http ------------------------------------------------------------
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

// Bun closes idle connections after 10 s by default, which silently kills the
// SSE stream between builds (the Vite proxy keeps the browser side open, so the
// page never notices). Disable the idle timeout and send a heartbeat.
setInterval(() => { for (const m of models.values()) m.broadcast('ping', { t: Date.now() }); }, 15000);

async function modelList() {
  const names = await listModelNames();
  return Promise.all(names.map(async (name) => {
    const m = models.get(name);
    let file = null;
    try { file = JSON.parse(await readFile(path.join(ROOT, name, 'viewer.json'), 'utf8')).file ?? null; } catch {}
    if (!m) return { name, file, loaded: false };
    const s = m.state;
    return { name, file: s.file ?? file, loaded: true, building: s.building, builtAt: s.builtAt, error: s.error,
             parts: s.parts.length, failed: s.parts.filter((p) => !p.ok && !p.empty).length, clients: m.clients.size };
  }));
}

Bun.serve({
  port: PORT,
  hostname: HOST,
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === '/api/models') return json(await modelList());
    if (p === '/api/root') return json({ root: ROOT, port: PORT });

    // /api/<model>/<route>, where <model> is one to MAX_DEPTH path segments. The deepest folder with a viewer.json
    // wins, so a sub-model (<toy>/<name>) is found before a route of the same name on its parent.
    if (!p.startsWith('/api/')) return new Response('not found', { status: 404 });
    let segs;
    try { segs = p.slice(5).split('/').map(decodeURIComponent); } catch { return new Response('not found', { status: 404 }); }
    let name = segs[0], route = segs.slice(1).join('/'), model = null;
    for (let n = Math.min(MAX_DEPTH, segs.length - 1); n >= 1 && !model; n--) {
      const cand = segs.slice(0, n).join('/');
      if (MODEL_RE.test(cand) && await exists(path.join(ROOT, cand, 'viewer.json'))) { name = cand; route = segs.slice(n).join('/'); model = await getModel(cand); }
    }
    if (!model) return json({ error: `no model "${name}" (needs <scad>/${name}/viewer.json)` }, 404);
    const state = model.state;

    if (route === 'state') return json(model.publicState());
    if (route === 'source') {
      const name = url.searchParams.get('module');
      if (name) return json(moduleSources(state.source, name));
      return new Response(state.source, { headers: { 'content-type': 'text/plain' } });
    }
    if (route === 'events') {
      let ctrl;
      const stream = new ReadableStream({
        start(c) { ctrl = c; model.clients.add(c); c.enqueue(`event: hello\ndata: {}\n\n`); },
        cancel() { model.clients.delete(ctrl); },
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });
    }
    // a built part's STL: stl?src=<state.parts[].src> (the part's name, or <folder>/<name> for a part of another
    // folder the scene uses); parts/<name>.stl is the older form, own parts only
    if (route === 'stl' || route.startsWith('parts/')) {
      const src = route === 'stl' ? url.searchParams.get('src') ?? '' : path.basename(route, '.stl');
      const file = model.stl(src);
      if (!file) return json({ error: `no built part "${src}"` }, 404);
      return new Response(Bun.file(file), { headers: { 'cache-control': 'no-store' } });
    }
    if (route === 'ref' && state.reference) return new Response(Bun.file(path.join(model.dir, state.reference)));

    // reference images
    if (route === 'refs') return json(await model.listRefs());
    if (route.startsWith('refs/')) return model.refFile(route.slice(5), req);

    // annotations: the doc, one annotation, or one overlay
    if (route === 'annotations' || route.startsWith('annotations/')) {
      const seg = route.split('/');            // ['annotations'] | ['annotations', id] | ['annotations', 'overlays', id]
      const body = async () => { try { return await req.json(); } catch { return null; } };
      const notFound = (what) => json({ error: `no ${what}` }, 404);
      if (seg.length === 1) {
        if (req.method === 'GET') return json(await model.loadNotes());
        if (req.method === 'POST') {
          const a = await body(); if (!a || typeof a !== 'object') return json({ error: 'body must be an annotation' }, 400);
          return json({ ok: true, ...(await model.mutateNotes((doc) => {
            a.id = nextId(doc.annotations, 'a'); a.created ??= new Date().toISOString(); a.status ??= 'open'; a.by ??= 'user';
            doc.annotations.push(a); return { id: a.id };
          })) });
        }
        if (req.method === 'PUT') {
          const d = await body(); if (!d || d.version !== 1) return json({ error: 'body must be a version 1 doc' }, 400);
          const cur = await model.loadNotes();
          if (d.rev !== cur.rev) return json({ error: 'rev mismatch', rev: cur.rev }, 409);
          return json({ ok: true, ...(await model.mutateNotes((doc) => { doc.annotations = d.annotations ?? []; doc.overlays = d.overlays ?? []; })) });
        }
      } else if (seg[1] === 'overlays' && seg.length === 3) {
        const id = seg[2];
        if (req.method === 'PUT') {
          const o = await body(); if (!o || typeof o !== 'object') return json({ error: 'body must be an overlay' }, 400);
          return json({ ok: true, ...(await model.mutateNotes((doc) => {
            const i = doc.overlays.findIndex((x) => x.id === id);
            if (i >= 0) { doc.overlays[i] = { ...doc.overlays[i], ...o, id }; return { id }; }
            o.id = id === 'new' ? nextId(doc.overlays, 'o') : id; o.created ??= new Date().toISOString();
            doc.overlays.push(o); return { id: o.id };
          })) });
        }
        if (req.method === 'DELETE') {
          const cur = await model.loadNotes();
          if (!cur.overlays.some((x) => x.id === id)) return notFound(`overlay ${id}`);
          return json({ ok: true, ...(await model.mutateNotes((doc) => { doc.overlays = doc.overlays.filter((x) => x.id !== id); })) });
        }
      } else if (seg.length === 2) {
        const id = seg[1];
        const cur = await model.loadNotes();
        const a = cur.annotations.find((x) => x.id === id);
        if (!a) return notFound(`annotation ${id}`);
        if (req.method === 'GET') return json(a);
        if (req.method === 'PATCH') {
          const patch = await body(); if (!patch || typeof patch !== 'object') return json({ error: 'body must be a partial annotation' }, 400);
          delete patch.id;
          if (patch.status === 'done' && a.status !== 'done') patch.done ??= new Date().toISOString();
          return json({ ok: true, ...(await model.mutateNotes((doc) => { Object.assign(doc.annotations.find((x) => x.id === id), patch); })) });
        }
        if (req.method === 'DELETE')
          return json({ ok: true, ...(await model.mutateNotes((doc) => { doc.annotations = doc.annotations.filter((x) => x.id !== id); })) });
      }
      return json({ error: 'method not allowed' }, 405);
    }

    // scene: GET the resolved scene and its hash. PUT { base, scene } replaces it; PATCH scene/<id> { base, ...fields }
    // sets fields of one instance (null clears one). A write whose base is not the file's hash any more is refused
    // with 409 and the current hash: reload and reapply. Changes go out as SSE 'scene'; nothing rebuilds.
    if (route === 'scene' || route.startsWith('scene/')) {
      const whole = route === 'scene';
      if (whole && req.method === 'GET') return json(await model.scene());
      if (!(whole ? req.method === 'PUT' : req.method === 'PATCH')) return json({ error: 'method not allowed' }, 405);
      let b; try { b = await req.json(); } catch { b = null; }
      if (!b || typeof b !== 'object' || typeof b.base !== 'string') return json({ error: 'body must carry base: the hash the edit is based on' }, 400);
      const { base, ...fields } = b;
      const write = whole ? () => writeScene(host, model.dir, b.scene, base)
        : async () => (await editScene(host, model.dir, (sc) => setFields(sc, route.slice(6), fields), base)).hash;
      try { return json({ ok: true, ...(await model.mutateScene(write)) }); }
      catch (e) {
        if (e instanceof StaleError) return json({ error: e.message, hash: e.hash }, 409);
        if (e instanceof SceneError) return json({ error: e.message, errors: e.errors }, 400);
        return json({ error: String(e.message ?? e) }, 500);
      }
    }

    // view: POST pushes a camera pose to every open browser tab (SSE 'view'); PUT is the browser reporting what it
    // shows; GET reads both, so a CLI can ask "what is on screen" and "what did I last push".
    if (route === 'view') {
      if (req.method === 'GET') return json({ camera: model.camera, last: model.view });
      if (req.method === 'PUT') { const v = await req.json(); model.camera = { camera: v.camera ?? null, hidden: v.hidden ?? [], at: new Date().toISOString() }; return json({ ok: true }); }
      if (req.method === 'POST') {
        const v = await req.json();
        let out = { camera: v.camera ?? null, hidden: v.hidden ?? null, preset: v.preset ?? null, annotation: v.annotation ?? null };
        if (v.annotation) {
          const a = (await model.loadNotes()).annotations.find((x) => x.id === v.annotation);
          if (!a) return json({ error: `no annotation ${v.annotation}` }, 404);
          if (!a.camera) return json({ error: `annotation ${v.annotation} has no camera` }, 400);
          out.camera = a.camera; out.hidden ??= a.hidden ?? null;
        }
        if (v.preset && !PRESETS.includes(v.preset)) return json({ error: `preset must be one of ${PRESETS.join(', ')}` }, 400);
        if (!out.camera && !out.preset) return json({ error: 'need camera, annotation or preset' }, 400);
        model.view = { ...out, seq: ++model.viewSeq, at: new Date().toISOString() };
        model.broadcast('view', model.view);
        return json({ ok: true, seq: model.view.seq, view: model.view, clients: model.clients.size });
      }
      return json({ error: 'method not allowed' }, 405);
    }

    if (route === 'overrides' && req.method === 'POST') {
      state.overrides = await req.json();
      model.scheduleBuild();
      return json({ ok: true });
    }
    if (route === 'build' && req.method === 'POST') { model.fresh = true; model.scheduleBuild(); return json({ ok: true }); }
    return new Response('not found', { status: 404 });
  },
});

const names = await listModelNames();
console.log(`scad-viewer api on ${HOST}:${PORT}, root ${ROOT}, models: ${names.join(', ') || '(none)'}`);
// Say so up front if OpenSCAD is missing or too old: otherwise every part just shows as failed.
const oc = await checkOpenscad();
(oc.ok ? console.log : console.error)(oc.message);
// SCAD_PROJECT is optional now: it only pre-warms that model's build.
if (process.env.SCAD_PROJECT) getModel(path.relative(ROOT, path.resolve(process.env.SCAD_PROJECT)));
