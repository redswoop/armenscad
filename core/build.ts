// Building a model's parts: read viewer.json and the .scad, render one harness per part, cache the STLs.
// The cache is keyed by content: the harness text (file path, defines and overrides, the call) plus the content
// of every file the .scad pulls in, plus the OpenSCAD binary. Two identical builds share one STL; an instance's
// override set (phase 1) will just be more assignments in its harness, so it keys the same way.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { type Host, readText } from './io.ts';
import { harness } from './scad.ts';
import { parseParams, dependencies, type Param } from './source.ts';

// viewer.json: the .scad file, its defines, its parts (module calls)
export interface ManifestPart { name: string; call: string; color?: string; group?: string | null; reference?: boolean }
// An assembly folder has no file and no parts of its own: everything it shows comes from its scene.json.
export interface Manifest { file?: string; defines?: Record<string, unknown>; parts: ManifestPart[]; reference?: string }

export interface LoadedModel {
  dir: string;
  manifest: Manifest;
  scadPath: string | null;   // null: no .scad of its own (an assembly)
  source: string;
  params: Param[];
}

export async function loadManifest(host: Host, dir: string): Promise<Manifest> {
  const text = await readText(host.files, path.join(dir, 'viewer.json'));
  if (text == null) throw new Error(`no viewer.json in ${dir}`);
  const m = JSON.parse(text);
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error(`viewer.json in ${dir} must be an object`);
  m.parts ??= [];
  if (m.parts.length && !m.file) throw new Error(`viewer.json in ${dir} lists parts but names no "file"`);
  return m;
}

export async function loadModel(host: Host, dir: string): Promise<LoadedModel> {
  const manifest = await loadManifest(host, dir);
  if (!manifest.file) return { dir, manifest, scadPath: null, source: '', params: [] };
  const scadPath = path.join(dir, manifest.file);
  const source = await readText(host.files, scadPath);
  if (source == null) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${scadPath}'`), { code: 'ENOENT' });
  // switches the viewer drives itself are not user parameters
  const params = parseParams(source).filter((p) => !(p.name in (manifest.defines ?? {})));
  return { dir, manifest, scadPath, source, params };
}

// What the viewer's state.parts holds for one part. src: what a placed part names to find it (the part's name
// here; the viewer's server lists another folder's parts as <folder>/<name>, core/scene.ts Placed.src). ms: how long its OpenSCAD run took, also when it came from the
// cache (null for a cache entry from before build times were kept); key: the cache key, shared by every part
// that renders the same harness, so a readout can count one build once.
export interface BuiltPart {
  name: string; src: string; call: string; color: string; group: string | null; reference: boolean; module: string | null;
  ok: boolean; empty: boolean; tris: number; ms: number | null; key: string; log: string; version: number;
}
interface CacheEntry { code: number; output: string; tris: number; ms?: number }

const sha = (...parts: (string | Uint8Array)[]) => { const h = createHash('sha256'); for (const p of parts) h.update(p); return h.digest('hex'); };

export async function sourceDigest(host: Host, scadPath: string): Promise<string> {
  const deps = await dependencies(host.files, scadPath, host.libPath);
  const h = createHash('sha256');
  for (const d of deps) { h.update(d.path + '\0'); h.update(d.data ?? '\u0001missing'); h.update('\0'); }
  return h.digest('hex');
}
export const cacheKey = (builder: string, digest: string, harnessText: string) => sha(builder, '\0', digest, '\0', harnessText).slice(0, 24);

// OpenSCAD's lines worth showing: errors, warnings, deprecations.
export const buildLog = (output: string) =>
  output.split('\n').filter((l) => /error|warning|deprecated/i.test(l) && !/NoError/.test(l)).join('\n');

// Build every part of the model into cacheDir (<key>.scad, <key>.stl, <key>.json for the result and how long it
// took), reusing any earlier build with the same key unless fresh. A failed build is not cached, so the next build
// tries again.
// Afterwards the folder keeps only this build's keys and the previous build's (keep), so a reset to the last
// values is instant and the cache cannot grow without bound.
// overrides: the Parameters panel's try-out values, each a piece of OpenSCAD source. set: an instance's values
// from scene.json, plain JSON (a string there is an OpenSCAD string); the parts built with one are named
// <name>?<setKey>. only: build just these parts. prune: false leaves the cache alone (the caller prunes, when
// several builds share the folder).
export interface BuildOptions { overrides?: Record<string, unknown>; set?: Record<string, unknown> | null; only?: Set<string>; keep?: Set<string>; fresh?: boolean; prune?: boolean }
// a set's identity: its entries in name order, as JSON
export const setKey = (set: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(set).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
// scene.json values as harness assignments: fmt() takes a string as source, so a string value gets its quotes here
const literals = (set: Record<string, unknown>) => Object.fromEntries(Object.entries(set).map(([k, v]) => [k, typeof v === 'string' ? JSON.stringify(v) : v]));
export async function pruneCache(host: Host, cacheDir: string, keep: Set<string>) {
  for (const f of await host.files.list(cacheDir)) {
    const stem = f.replace(/\.(scad|stl|json)$/, '');
    if (!keep.has(stem)) await host.files.remove(path.join(cacheDir, f));
  }
}
export async function buildParts(host: Host, m: LoadedModel, cacheDir: string, { overrides = {}, set = null, only, keep = new Set(), fresh = false, prune = true }: BuildOptions = {}) {
  const { files, builder } = host;
  const defines = { ...(m.manifest.defines ?? {}), ...overrides, ...(set ? literals(set) : {}) };
  const suffix = set && Object.keys(set).length ? `?${setKey(set)}` : '';
  const digest = m.scadPath ? await sourceDigest(host, m.scadPath) : '';
  const running = new Map<string, Promise<CacheEntry>>();     // two parts with the same harness build once
  const render = async (key: string, text: string): Promise<CacheEntry> => {
    const meta = path.join(cacheDir, `${key}.json`), out = path.join(cacheDir, `${key}.stl`);
    const hit = fresh ? null : await readText(files, meta);
    if (hit) {
      const e: CacheEntry = JSON.parse(hit);
      if (e.tris === 0 || (await files.size(out)) === 84 + 50 * e.tris) return e;
    }
    const hp = path.join(cacheDir, `${key}.scad`);
    await files.write(hp, text);
    await files.remove(out);                          // OpenSCAD writes nothing for an empty result: no stale file
    const t = performance.now();
    const { code, output } = await builder.render(hp, out);
    const ms = Math.round(performance.now() - t);
    const size = await files.size(out);
    const e = { code, output, tris: size == null ? 0 : Math.max(0, (size - 84) / 50), ms };
    if (code === 0) await files.write(meta, JSON.stringify(e));
    return e;
  };
  const keys = new Map<string, string>();             // part name -> key, to serve parts/<name>.stl
  const parts: BuiltPart[] = await Promise.all(m.manifest.parts.filter((p) => !only || only.has(p.name)).map(async (p) => {
    const text = harness(m.scadPath!, defines, p.call);
    const key = cacheKey(builder.id, digest, text);
    keys.set(p.name, key);
    if (!running.has(key)) running.set(key, render(key, text));
    const e = await running.get(key)!;
    const mod = p.call.match(/^\s*(\w+)\s*\(/);
    return { name: p.name, src: p.name + suffix, call: p.call, color: p.color ?? '#999999', group: p.group ?? null, reference: !!p.reference, module: mod?.[1] ?? null,
             ok: e.code === 0 && e.tris > 0, empty: /top level object is empty/i.test(e.output), tris: e.tris, ms: e.ms ?? null, key,
             log: buildLog(e.output), version: Date.now() };   // empty: built fine but produced nothing (a part that is off in this configuration)
  }));
  if (prune) await pruneCache(host, cacheDir, new Set([...keys.values(), ...keep]));
  return { parts, keys, stl: (name: string) => (keys.has(name) ? path.join(cacheDir, `${keys.get(name)}.stl`) : null) };
}
