// A model folder's scene: read, resolve, write (the only writer of scene.json), and _scene.scad.
// The CLI and the viewer's server both come through here, so they cannot disagree about what a scene is.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { type Host, readText } from './io.ts';
import { loadManifest, type Manifest } from './build.ts';
import { sceneScad } from './scad.ts';
import { parseExports, type Exports } from './source.ts';
import {
  SCENE_FILE, SCENE_SCAD, SceneError, StaleError, defaultScene, formatScene, resolveScene, validateScene,
  sceneOffers, components,
  type Placed, type Scene, type Uses, type Component,
} from './scene.ts';

// Content hash of the file's text; 'none' while there is no file. No counter in the file, so nothing churns in git.
// (Here, not in scene.ts, which the viewer imports and which so stays free of Node modules.)
export function sceneHash(text: string | null): string {
  return text == null ? 'none' : createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export interface SceneState {
  hash: string;            // of scene.json's text, 'none' when there is no file; a write names it as its base
  exists: boolean;         // false: the default scene
  scene: Scene | null;     // null when the file is not JSON
  parts: Placed[];         // empty while there are errors
  errors: string[];
  offers: Record<string, string[]>;            // instance id -> the names it can show (its "parts" choices)
  targets: Record<string, string>;             // instance id -> the folder it is an instance of ("." or "../knee")
  components: { rel: string; dir: string }[];  // the other folders the scene builds from, each once, however deep
}

// The other folders a scene uses, loaded: each one's viewer.json, its scene.json if it has one, and what that
// uses in turn. A folder that cannot be used comes back with an error (the scene's validation reports it); a
// folder that uses itself, straight or through others, is one of those. top: the folder whose scene is being
// resolved (a component's rel is from there); chain: the folders on the way down, to catch a loop.
export async function loadUses(host: Host, dir: string, scene: unknown, top = dir, chain: string[] = [dir]): Promise<Uses> {
  const uses: Uses = {};
  const list = Array.isArray((scene as any)?.instances) ? (scene as any).instances : [];
  for (const inst of list) {
    const use = inst?.use;
    if (typeof use !== 'string' || !use || use === '.' || use in uses) continue;
    if (path.isAbsolute(use) || use.includes('\\')) continue;      // not a folder beside this one: validation says so
    const target = path.resolve(dir, use);
    const c: Component = { rel: path.relative(top, target).split(path.sep).join('/') || '.', dir: target, manifest: { parts: [] }, scene: null, uses: {}, exports: null };
    uses[use] = c;
    if (chain.includes(target)) { c.error = `a loop: ${[...chain.slice(chain.indexOf(target)), target].map((d) => path.basename(d)).join(' uses ')}`; continue; }
    try { c.manifest = await loadManifest(host, target); }
    catch (e: any) { c.error = (await host.files.size(path.join(target, 'viewer.json'))) == null ? 'no viewer.json there' : String(e.message ?? e); continue; }
    c.exports = await exportsOf(host, target, c.manifest);
    const text = await readText(host.files, path.join(target, SCENE_FILE));
    if (text == null) continue;
    try { c.scene = JSON.parse(text); } catch (e: any) { c.error = `its scene.json is not JSON: ${e.message}`; continue; }
    c.uses = await loadUses(host, target, c.scene, top, [...chain, target]);
    const errs = validateScene(c.scene, c.manifest, c.uses, c.exports);
    if (errs.length) c.error = `its scene.json has ${errs.length === 1 ? 'an error' : `${errs.length} errors`}: ${errs[0]}`;
  }
  return uses;
}

// What a folder's .scad lets a scene set; null when the folder has no .scad of its own. The viewer's own switches
// (viewer.json defines) are not values.
export async function exportsOf(host: Host, dir: string, manifest: Manifest): Promise<Exports | null> {
  if (!manifest.file) return null;
  const src = await readText(host.files, path.join(dir, manifest.file));
  return src == null ? null : parseExports(src, Object.keys(manifest.defines ?? {}));
}
// For the panel and the CLI: each folder the scene's instances are instances of, with what it exports.
export async function sceneExports(host: Host, dir: string): Promise<{ targets: Record<string, string>; components: Record<string, Exports | null> }> {
  const manifest = await loadManifest(host, dir);
  const st = await readScene(host, dir, manifest);
  const uses = st.scene ? await loadUses(host, dir, st.scene) : {};
  const components: Record<string, Exports | null> = { '.': await exportsOf(host, dir, manifest) };
  for (const c of Object.values(uses)) if (!c.error) components[c.rel] = c.exports;
  return { targets: st.targets, components };
}

export async function readScene(host: Host, dir: string, manifest?: Manifest): Promise<SceneState> {
  manifest ??= await loadManifest(host, dir);
  const text = await readText(host.files, path.join(dir, SCENE_FILE));
  const hash = sceneHash(text);
  let scene: any = null;
  let errors: string[], uses: Uses = {};
  if (text == null) scene = defaultScene(path.basename(dir));
  try { scene ??= JSON.parse(text!); uses = await loadUses(host, dir, scene); errors = validateScene(scene, manifest, uses, await exportsOf(host, dir, manifest)); }
  catch (e: any) { errors = [`scene.json is not JSON: ${e.message}`]; }
  const ok = !errors.length;
  return {
    hash, exists: text != null, scene, errors,
    parts: ok ? resolveScene(scene, manifest, { uses }) : [],
    offers: ok ? sceneOffers(scene, manifest, uses) : {},
    targets: ok ? Object.fromEntries(scene.instances.map((i: any) => [i.id, i.use && i.use !== '.' ? uses[i.use].rel : '.'])) : {},
    components: ok ? components(uses).map((c) => ({ rel: c.rel, dir: c.dir })) : [],
  };
}

// Write a whole scene, if the file is still what the caller last read (base). Refused with StaleError when it
// is not, with SceneError when the scene is invalid. Resolves with the new hash.
export async function writeScene(host: Host, dir: string, scene: Scene, base: string, manifest?: Manifest): Promise<string> {
  manifest ??= await loadManifest(host, dir);
  const file = path.join(dir, SCENE_FILE);
  const hash = sceneHash(await readText(host.files, file));
  if (hash !== base) throw new StaleError(base, hash);
  const errors = validateScene(scene, manifest, await loadUses(host, dir, scene), await exportsOf(host, dir, manifest));
  if (errors.length) throw new SceneError(errors);
  const text = formatScene(scene);
  await host.files.write(file, text);
  return sceneHash(text);
}

// Apply one edit (scene.ts addInstance, setFields, ...) to the scene as it is on disk. base: the hash the edit
// was based on (the viewer's), or omitted to edit whatever is there now (the CLI, which reads and writes at once).
export async function editScene(host: Host, dir: string, edit: (s: Scene) => Scene, base?: string): Promise<{ hash: string; scene: Scene }> {
  const manifest = await loadManifest(host, dir);
  const cur = await readScene(host, dir, manifest);
  if (base !== undefined && base !== cur.hash) throw new StaleError(base, cur.hash);
  if (cur.errors.length) throw new SceneError(cur.errors);
  const scene = edit(cur.scene!);
  return { hash: await writeScene(host, dir, scene, cur.hash, manifest), scene };
}

// _scene.scad beside scene.json: the arrangement as plain OpenSCAD, scratch instances left out unless asked for.
export async function writeSceneScad(host: Host, dir: string, { scratch = false } = {}): Promise<{ path: string; text: string }> {
  const manifest = await loadManifest(host, dir);
  const st = await readScene(host, dir, manifest);
  if (st.errors.length) throw new SceneError(st.errors);
  // Parts of other folders cannot be module calls here: no generated file includes two components. They will
  // come in as import() of each built STL (the spec's phase 2).
  const shown = st.parts.filter((p) => scratch || !p.scratch);
  const other = [...new Set(shown.filter((p) => p.component !== '.').map((p) => p.instance))];
  if (other.length) throw new SceneError([`_scene.scad is not written yet for a scene that uses other folders (${other.join(', ')}); the viewer shows it`]);
  // a value is file-global in OpenSCAD, so two sets cannot share one file either
  const valued = [...new Set(shown.filter((p) => p.set).map((p) => p.instance))];
  if (valued.length) throw new SceneError([`_scene.scad is not written yet for instances with values of their own (${valued.join(', ')}); the viewer shows them`]);
  if (!manifest.file) throw new SceneError(['this model has no .scad of its own, so there is nothing for _scene.scad to include']);
  const text = sceneScad(manifest, resolveScene(st.scene!, manifest, { scratch }));
  const out = path.join(dir, SCENE_SCAD);
  await host.files.write(out, text);
  return { path: out, text };
}
