// A model folder's scene: read, resolve, write (the only writer of scene.json), and _scene.scad.
// The CLI and the viewer's server both come through here, so they cannot disagree about what a scene is.
import path from 'node:path';
import { type Host, readText } from './io.ts';
import { loadManifest, type Manifest } from './build.ts';
import { sceneScad } from './scad.ts';
import {
  SCENE_FILE, SCENE_SCAD, SceneError, StaleError, defaultScene, formatScene, resolveScene, sceneHash, validateScene,
  type Placed, type Scene,
} from './scene.ts';

export interface SceneState {
  hash: string;            // of scene.json's text, 'none' when there is no file; a write names it as its base
  exists: boolean;         // false: the default scene
  scene: Scene | null;     // null when the file is not JSON
  parts: Placed[];         // empty while there are errors
  errors: string[];
}

export async function readScene(host: Host, dir: string, manifest?: Manifest): Promise<SceneState> {
  manifest ??= await loadManifest(host, dir);
  const text = await readText(host.files, path.join(dir, SCENE_FILE));
  const hash = sceneHash(text);
  let scene: any = null;
  let errors: string[];
  if (text == null) scene = defaultScene(path.basename(dir));
  try { scene ??= JSON.parse(text!); errors = validateScene(scene, manifest); }
  catch (e: any) { errors = [`scene.json is not JSON: ${e.message}`]; }
  return { hash, exists: text != null, scene, parts: errors.length ? [] : resolveScene(scene, manifest), errors };
}

// Write a whole scene, if the file is still what the caller last read (base). Refused with StaleError when it
// is not, with SceneError when the scene is invalid. Resolves with the new hash.
export async function writeScene(host: Host, dir: string, scene: Scene, base: string, manifest?: Manifest): Promise<string> {
  manifest ??= await loadManifest(host, dir);
  const file = path.join(dir, SCENE_FILE);
  const hash = sceneHash(await readText(host.files, file));
  if (hash !== base) throw new StaleError(base, hash);
  const errors = validateScene(scene, manifest);
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
  const text = sceneScad(manifest, resolveScene(st.scene!, manifest, { scratch }));
  const out = path.join(dir, SCENE_SCAD);
  await host.files.write(out, text);
  return { path: out, text };
}
