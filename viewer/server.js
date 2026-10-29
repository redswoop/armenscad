// scad-viewer API: serves every model folder under a workspace root that has a viewer.json.
// The root is SCAD_ROOT (tools/browse sets it from the folder you point it at), default the
// workbench folder above viewer/. Models are found up to MAX_DEPTH folders down, so a workspace
// may hold <name>/viewer.json, <toy>/<name>/viewer.json or <group>/<toy>/<name>/viewer.json;
// the model name is the relative path ("toy/name").
// Each model gets its own state, file watcher, render cache and SSE clients,
// created lazily on first request. Routes are /api/models and /api/<model>/....
import { watch } from 'node:fs';
import { readFile, writeFile, mkdir, stat, readdir, access, rename } from 'node:fs/promises';
import path from 'node:path';

const PORT = parseInt(process.env.PORT ?? '3003', 10);
const HOST = process.env.HOST ?? '127.0.0.1';   // the API is unauthenticated: HOST=0.0.0.0 to reach it from the LAN
const OPENSCAD = process.env.OPENSCAD ?? Bun.which('openscad') ?? '/opt/homebrew/bin/openscad';
const ROOT = path.resolve(process.env.SCAD_ROOT ?? path.join(import.meta.dir, '..'));
const MAX_DEPTH = 3;
const CACHE = path.join(import.meta.dir, '.cache');
// use <armenscad/...> resolves against the workbench's lib/ wherever the workspace is
const LIB = path.join(import.meta.dir, '..', 'lib');
const OPENSCAD_ENV = { ...process.env, OPENSCADPATH: process.env.OPENSCADPATH ? `${LIB}:${process.env.OPENSCADPATH}` : LIB };
const SKIP = new Set(['template', 'viewer', 'lib', 'tools', 'node_modules', 'stl', 'renders', 'ref']);

const fmt = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
const exists = (p) => access(p).then(() => true, () => false);

// ---- models ----------------------------------------------------------
const models = new Map();   // name -> Model

const MODEL_RE = /^[\w.-]+(\/[\w.-]+){0,2}$/;   // "name", "toy/name", up to MAX_DEPTH segments
const REF_NAME = /^[\w][\w .()-]*\.(jpe?g|png|webp|gif)$/i;   // what counts as a reference image in <model>/ref/
const PRESETS = ['iso', 'top', 'front', 'side', 'under'];

// Pretty JSON, but arrays of numbers (points, poses, colours) stay on one line so a coordinate is one greppable
// line and the file stays short. Applied to the innermost arrays first, then to arrays of those.
function notesJson(doc) {
  let s = JSON.stringify(doc, null, 2);
  const scalar = /\[\s*((?:-?\d+(?:\.\d+)?(?:e[-+]?\d+)?|null|true|false)(?:,\s*(?:-?\d+(?:\.\d+)?(?:e[-+]?\d+)?|null|true|false))*)\s*\]/g;
  s = s.replace(scalar, (m, inner) => `[${inner.replace(/\s+/g, ' ').replace(/ ,/g, ',')}]`);
  const nested = /\[\s*(\[[^\[\]]*\](?:,\s*\[[^\[\]]*\])*)\s*\]/g;      // [[1, 2], [3, 4]] on one line when short
  s = s.replace(nested, (m, inner) => { const one = `[${inner.replace(/\s+/g, ' ')}]`; return one.length <= 100 ? one : m; });
  // flat objects (a hit, a pose) on one line when short
  const flat = /\{\s*("[^"\n]*":\s*(?:"[^"\n]*"|-?\d[\d.e+-]*|null|true|false|\[[^\[\]{}]*\])(?:,\s*"[^"\n]*":\s*(?:"[^"\n]*"|-?\d[\d.e+-]*|null|true|false|\[[^\[\]{}]*\]))*)\s*\}/g;
  s = s.replace(flat, (m, inner) => { const one = `{ ${inner.replace(/\s*\n\s*/g, ' ')} }`; return one.length <= 100 ? one : m; });
  return s + '\n';
}

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
    // Only the .scad files and viewer.json affect the build. annotations.json changes are reloaded, not rebuilt.
    this.watcher = watch(dir, (ev, file) => {
      if (!file) return;
      if (file === 'viewer.json' || file.endsWith('.scad')) this.scheduleBuild();
      else if (file === 'annotations.json') this.reloadNotes();
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
      const text = notesJson(doc);
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

  scheduleBuild() { clearTimeout(this.buildTimer); this.buildTimer = setTimeout(() => this.build(), 250); }

  async build() {
    const state = this.state;
    if (state.building) { this.buildQueued = true; return; }
    state.building = true; state.error = null;
    this.broadcast('building', {});
    const t0 = performance.now();
    try {
      const manifest = JSON.parse(await readFile(path.join(this.dir, 'viewer.json'), 'utf8'));
      const scadPath = path.join(this.dir, manifest.file);
      const src = await readFile(scadPath, 'utf8');
      state.file = manifest.file;
      state.reference = manifest.reference ?? null;
      state.source = src;
      const defines = { ...(manifest.defines ?? {}), ...state.overrides };
      // switches the viewer drives itself are not user parameters
      state.params = parseParams(src).filter((p) => !(p.name in (manifest.defines ?? {})));
      const assigns = Object.entries(defines).map(([k, v]) => `${k} = ${fmt(v)};`).join('\n');
      await mkdir(this.cache, { recursive: true });

      state.parts = await Promise.all(manifest.parts.map(async (p) => {
        const harness = `include <${scadPath}>\n${assigns}\n${p.call}\n`;
        const hp = path.join(this.cache, `${p.name}.scad`);
        const out = path.join(this.cache, `${p.name}.stl`);
        await writeFile(hp, harness);
        const t = performance.now();
        const proc = Bun.spawn([OPENSCAD, '--backend', 'Manifold', '--export-format', 'binstl', '-o', out, hp], { stderr: 'pipe', stdout: 'pipe', env: OPENSCAD_ENV });
        const [err, outp] = await Promise.all([new Response(proc.stderr).text(), new Response(proc.stdout).text()]);
        const code = await proc.exited;
        const log = (err + outp).split('\n').filter((l) => /error|warning|deprecated/i.test(l) && !/NoError/.test(l)).join('\n');
        let tris = 0;
        try { tris = Math.max(0, ((await stat(out)).size - 84) / 50); } catch {}
        const mod = p.call.match(/^\s*(\w+)\s*\(/);
        return { name: p.name, call: p.call, color: p.color ?? '#999999', group: p.group ?? null, reference: !!p.reference, module: mod?.[1] ?? null,
                 ok: code === 0 && tris > 0, empty: /top level object is empty/i.test(err + outp), tris, ms: Math.round(performance.now() - t), log, version: Date.now() };   // empty: built fine but produced nothing (a part that is off in this configuration)
      }));
    } catch (e) {
      state.error = String(e.message ?? e);
    }
    state.building = false;
    state.builtAt = new Date().toISOString();
    state.buildMs = Math.round(performance.now() - t0);
    this.broadcast('built', this.publicState());
    if (this.buildQueued) { this.buildQueued = false; this.build(); }
  }
}

// ---- source analysis -------------------------------------------------
function parseParams(src) {
  const params = [];
  let section = 'parameters';
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*module\s+\w+\s*\(/.test(line)) break;   // only the top-of-file block
    const sec = line.match(/^\/\/\s*-{3,}\s*(.+?)\s*-{3,}/);
    if (sec) { section = sec[1]; continue; }
    if (!/^\w+\s*=/.test(line)) continue;
    const comment = (line.match(/\/\/\s*(.*)$/)?.[1] ?? '').trim();
    const code = line.replace(/\/\/.*$/, '');
    for (const m of code.matchAll(/(\w+)\s*=\s*([^;]+);/g))
      if (m[1] !== '$fn') params.push({ section, name: m[1], value: m[2].trim(), comment, line: i + 1 });
  }
  return params;
}

const BUILTIN = new Set('translate rotate mirror scale cube cylinder sphere polygon circle square linear_extrude rotate_extrude hull minkowski difference union intersection offset import color for if let echo children projection resize multmatrix render surface text polyhedron'.split(' '));
// the module plus every user module it calls, depth-first, each once
function moduleSources(src, name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const m = moduleSource(src, name);
  if (!m) return [];
  const out = [{ name, ...m }];
  for (const c of m.code.matchAll(/\b([a-zA-Z_]\w*)\s*\(/g))
    if (!BUILTIN.has(c[1]) && c[1] !== name) out.push(...moduleSources(src, c[1], seen));
  return out;
}
function moduleSource(src, name) {
  const re = new RegExp(`^[ \\t]*module\\s+${name}\\s*\\(`, 'm');
  const m = re.exec(src);
  if (!m) return null;
  // pull leading comment lines
  let start = m.index;
  const before = src.slice(0, start).split('\n');
  let k = before.length - 2;
  while (k >= 0 && /^\s*\/\//.test(before[k])) k--;
  const commentStart = before.slice(0, k + 1).join('\n').length + (k >= 0 ? 1 : 0);
  // brace match
  let i = src.indexOf('{', m.index), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  const startLine = src.slice(0, commentStart).split('\n').length;
  return { code: src.slice(commentStart, i + 1), line: startLine };
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

    // /api/<model>/<route>, where <model> is one or two path segments
    const mm = p.match(/^\/api\/([^/]+)(?:\/([^/]+))?\/(.*)$/);
    if (!mm) return new Response('not found', { status: 404 });
    // a sub-model (<toy>/<name>/viewer.json) wins over a route of the same name on the parent
    let name, route, model = null;
    if (mm[2] && await exists(path.join(ROOT, mm[1], mm[2], 'viewer.json'))) {
      name = `${mm[1]}/${mm[2]}`; route = mm[3]; model = await getModel(name);
    }
    if (!model) { name = mm[1]; route = mm[2] ? `${mm[2]}/${mm[3]}` : mm[3]; model = await getModel(name); }
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
    if (route.startsWith('parts/')) {
      const name = path.basename(route, '.stl');
      return new Response(Bun.file(path.join(model.cache, `${name}.stl`)), { headers: { 'cache-control': 'no-store' } });
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
    if (route === 'build' && req.method === 'POST') { model.scheduleBuild(); return json({ ok: true }); }
    return new Response('not found', { status: 404 });
  },
});

const names = await listModelNames();
console.log(`scad-viewer api on ${HOST}:${PORT}, root ${ROOT}, models: ${names.join(', ') || '(none)'}`);
// Say so up front if OpenSCAD is missing or too old: otherwise every part just shows as failed.
try {
  const p = Bun.spawn([OPENSCAD, '--version'], { stderr: 'pipe', stdout: 'pipe' });
  const v = ((await new Response(p.stderr).text()) + (await new Response(p.stdout).text())).trim();
  const year = +(v.match(/(\d{4})\.\d+/)?.[1] ?? 0);
  if (year && year < 2024) console.error(`[openscad] ${OPENSCAD} is ${v}: too old for --backend Manifold. Install a development snapshot (macOS: brew install --cask openscad@snapshot) or point OPENSCAD at one.`);
  else console.log(`[openscad] ${OPENSCAD} (${v})`);
} catch {
  console.error(`[openscad] cannot run "${OPENSCAD}". Install an OpenSCAD development snapshot and put it on PATH, or set OPENSCAD=/path/to/openscad.`);
}
// SCAD_PROJECT is optional now: it only pre-warms that model's build.
if (process.env.SCAD_PROJECT) getModel(path.relative(ROOT, path.resolve(process.env.SCAD_PROJECT)));
