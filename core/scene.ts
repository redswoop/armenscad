// scene.json: what a model shows, and where. Pure: validation, the default scene, resolution to placed parts,
// edits, the file's text and its hash. Reading and writing the file is model.ts.
//
// Phase 0 shape (docs/SPEC-components-2026-11-14.md): instances of the model's own component only.
//   { "version": 1, "instances": [ { "id": "box2", "parts": ["box"], "at": [70, 0, 0], "mirror": [1, 0, 0] } ] }
// A placement means translate(at) rotate(rot) mirror(mirror) scale(scale) <call>, a move from where the .scad
// draws the part. A part is addressed instance.part, so ids and part names carry no dots.
import { createHash } from 'node:crypto';
import type { Manifest } from './build.ts';

export const SCENE_FILE = 'scene.json';
export const SCENE_SCAD = '_scene.scad';

export type Vec3 = [number, number, number];
export interface Instance {
  id: string;
  use?: string;
  parts?: string[];
  at?: Vec3;
  rot?: Vec3;
  scale?: number | Vec3;
  mirror?: Vec3;
  color?: string;
  material?: string;
  scratch?: boolean;
}
export interface Scene { version: 1; instances: Instance[] }

// one part of one instance, as placed
export interface Placed {
  path: string;            // instance.part
  instance: string;
  part: string;
  call: string;
  color: string;
  material: string | null;
  group: string | null;
  reference: boolean;
  scratch: boolean;
  at: Vec3; rot: Vec3; scale: Vec3; mirror: Vec3;
}

export class SceneError extends Error {
  constructor(public errors: string[]) { super(errors.join('\n')); }
}
// A write based on a hash that is no longer the file's: someone else wrote in between. Reload and reapply.
export class StaleError extends Error {
  constructor(public base: string, public hash: string) { super(`scene.json changed (now ${hash}, the edit was based on ${base}): reload and reapply`); }
}

export const FIELDS = ['id', 'use', 'parts', 'at', 'rot', 'scale', 'mirror', 'color', 'material', 'scratch'] as const;
const ID = /^[A-Za-z0-9_-]+$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

// Content hash of the file's text; 'none' while there is no file. No counter in the file, so nothing churns in git.
export function sceneHash(text: string | null): string {
  return text == null ? 'none' : createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// No scene.json = today: one instance of the model's own component, every part where the .scad draws it.
// Its id is the model folder's name, so its parts read hinge_box.box.
export function defaultScene(folder: string): Scene {
  return { version: 1, instances: [{ id: folder.replace(/[^A-Za-z0-9_-]/g, '_') || 'model' }] };
}

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const isVec3 = (x: unknown) => Array.isArray(x) && x.length === 3 && x.every((n) => typeof n === 'number' && Number.isFinite(n));

// Every problem at once, each naming the instance, so one hand edit can fix them all.
export function validateScene(doc: unknown, manifest: Manifest): string[] {
  const errs: string[] = [];
  const names = manifest.parts.map((p) => p.name);
  for (const n of names) if (n.includes('.')) errs.push(`viewer.json part "${n}": a part name cannot contain a dot (parts are addressed instance.part)`);
  if (!isObj(doc)) return [...errs, 'scene.json must be an object: { "version": 1, "instances": [...] }'];
  if (doc.version !== 1) errs.push(`version must be 1, not ${JSON.stringify(doc.version)}`);
  for (const k of Object.keys(doc)) if (k !== 'version' && k !== 'instances') errs.push(`unknown key "${k}" (a scene has version and instances)`);
  if (!Array.isArray(doc.instances)) return [...errs, 'instances must be a list'];
  const seen = new Set<string>();
  doc.instances.forEach((inst: unknown, i: number) => {
    if (!isObj(inst)) { errs.push(`instances[${i}] must be an object`); return; }
    const at = `instances[${i}]${typeof inst.id === 'string' ? ` (${inst.id})` : ''}`;
    const bad = (msg: string) => errs.push(`${at}: ${msg}`);
    if (typeof inst.id !== 'string' || !inst.id) bad('needs an id');
    else if (inst.id.includes('.')) bad(`id "${inst.id}" cannot contain a dot (parts are addressed instance.part)`);
    else if (!ID.test(inst.id)) bad(`id "${inst.id}" may use only letters, digits, _ and -`);
    else if (seen.has(inst.id)) bad(`id "${inst.id}" is used twice`);
    else seen.add(inst.id);
    if ('set' in inst) bad('"set" (value overrides) is not supported yet; it comes with @export (phase 1)');
    if (inst.use !== undefined && inst.use !== '.') {
      if (typeof inst.use === 'string') bad(`"use": "${inst.use}": only "." (this model) is supported yet; other folders come with assemblies (phase 3)`);
      else bad('"use" must be "." or left out');
    }
    if (inst.parts !== undefined) {
      if (!Array.isArray(inst.parts) || !inst.parts.length || !inst.parts.every((p: unknown) => typeof p === 'string'))
        bad('parts must be a non-empty list of part names (leave it out for all of them)');
      else {
        for (const p of inst.parts) if (!names.includes(p)) bad(`unknown part "${p}" (viewer.json has ${names.join(', ')})`);
        if (new Set(inst.parts).size !== inst.parts.length) bad('parts lists a part twice');
      }
    }
    for (const k of ['at', 'rot', 'mirror'] as const)
      if (inst[k] !== undefined && !isVec3(inst[k])) bad(`${k} must be [x, y, z] numbers`);
    if (inst.scale !== undefined) {
      const s = inst.scale;
      const ok = (typeof s === 'number' && Number.isFinite(s) && s > 0) || (isVec3(s) && s.every((n: number) => n > 0));
      if (!ok) bad('scale must be a positive number or [x, y, z] of them (flip with mirror, not a negative scale)');
    }
    if (inst.color !== undefined && !(typeof inst.color === 'string' && COLOR.test(inst.color))) bad('color must be "#rrggbb"');
    if (inst.material !== undefined && !(typeof inst.material === 'string' && inst.material)) bad('material must be a name');
    if (inst.scratch !== undefined && typeof inst.scratch !== 'boolean') bad('scratch must be true or false');
    for (const k of Object.keys(inst))
      if (!(FIELDS as readonly string[]).includes(k) && k !== 'set') bad(`unknown field "${k}" (an instance has ${FIELDS.join(', ')})`);
  });
  return errs;
}

const vec = (v: Vec3 | undefined, d: number): Vec3 => (v ? [...v] as Vec3 : [d, d, d]);

// The flat list of placed parts, instance by instance, parts in viewer.json order. Scratch instances are left
// out when scratch is false (the generated .scad, later the check and the export); the viewer shows them.
export function resolveScene(scene: Scene, manifest: Manifest, { scratch = true } = {}): Placed[] {
  const out: Placed[] = [];
  for (const inst of scene.instances) {
    if (inst.scratch && !scratch) continue;
    for (const p of manifest.parts) {
      if (inst.parts && !inst.parts.includes(p.name)) continue;
      out.push({
        path: `${inst.id}.${p.name}`, instance: inst.id, part: p.name, call: p.call,
        color: inst.color ?? p.color ?? '#999999', material: inst.material ?? null, group: p.group ?? null,
        reference: !!p.reference, scratch: !!inst.scratch,
        at: vec(inst.at, 0), rot: vec(inst.rot, 0), mirror: vec(inst.mirror, 0),
        scale: typeof inst.scale === 'number' ? [inst.scale, inst.scale, inst.scale] : vec(inst.scale, 1),
      });
    }
  }
  return out;
}

// The file's text: fields in one order, one instance per line, so a drag is a one-line diff.
export function formatScene(scene: Scene): string {
  const val = (v: unknown) => (Array.isArray(v) ? `[${v.map((x) => JSON.stringify(x)).join(', ')}]` : JSON.stringify(v));
  const lines = scene.instances.map((inst) =>
    `    { ${FIELDS.filter((k) => inst[k] !== undefined).map((k) => `"${k}": ${val(inst[k])}`).join(', ')} }`);
  return `{\n  "version": 1,\n  "instances": [${lines.length ? `\n${lines.join(',\n')}\n  ` : ''}]\n}\n`;
}

// ---- edits: each returns a new scene; the write validates the result ----
const clone = (s: Scene): Scene => structuredClone(s);
function find(scene: Scene, id: string): Instance {
  const inst = scene.instances.find((x) => x.id === id);
  if (!inst) throw new SceneError([`no instance "${id}" (the scene has ${scene.instances.map((x) => x.id).join(', ') || 'none'})`]);
  return inst;
}
function taken(scene: Scene, id: string) {
  if (scene.instances.some((x) => x.id === id)) throw new SceneError([`there is already an instance "${id}"`]);
}

// fields: a value sets the field, null clears it back to the default. The id is not a field you can set.
export type Fields = { [K in Exclude<keyof Instance, 'id'>]?: Instance[K] | null };
function apply(inst: Instance, fields: Fields) {
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'id') throw new SceneError(['an instance id cannot be changed; copy it to the new id and remove the old one']);
    if (v === null || v === undefined) delete (inst as any)[k]; else (inst as any)[k] = v;
  }
}

export function addInstance(scene: Scene, id: string, fields: Fields = {}): Scene {
  const s = clone(scene); taken(s, id);
  const inst: Instance = { id }; apply(inst, fields);
  s.instances.push(inst); return s;
}
export function copyInstance(scene: Scene, from: string, id: string, fields: Fields = {}): Scene {
  const s = clone(scene); taken(s, id);
  const inst = { ...structuredClone(find(s, from)), id }; apply(inst, fields);
  s.instances.splice(s.instances.indexOf(find(s, from)) + 1, 0, inst); return s;
}
// by a delta, from wherever it is now
export function moveInstance(scene: Scene, id: string, by: Vec3): Scene {
  const s = clone(scene); const inst = find(s, id);
  const at = vec(inst.at, 0);
  inst.at = [at[0] + by[0], at[1] + by[1], at[2] + by[2]]; return s;
}
export function removeInstance(scene: Scene, id: string): Scene {
  const s = clone(scene); const inst = find(s, id);
  s.instances.splice(s.instances.indexOf(inst), 1); return s;
}
export function setFields(scene: Scene, id: string, fields: Fields): Scene {
  const s = clone(scene); apply(find(s, id), fields); return s;
}

// A field typed on the command line: at=1,2,3 (or [1, 2, 3]), scale=2, parts=box,lid, scratch=true;
// an empty value (at=) clears the field.
export function parseField(arg: string): [keyof Fields, unknown] {
  const m = arg.match(/^(\w+)=(.*)$/s);
  if (!m) throw new SceneError([`"${arg}" is not field=value`]);
  const [, k, raw] = m;
  if (k === 'id') throw new SceneError(['an instance id cannot be changed; copy it to the new id and remove the old one']);
  if (k === 'set') throw new SceneError(['"set" (value overrides) is not supported yet; it comes with @export (phase 1)']);
  if (!(FIELDS as readonly string[]).includes(k)) throw new SceneError([`unknown field "${k}" (an instance has ${FIELDS.slice(1).join(', ')})`]);
  if (raw === '') return [k as keyof Fields, null];
  const list = () => raw.replace(/^\[|\]$/g, '').split(',').map((x) => x.trim());
  const nums = () => list().map((x) => (x === '' ? NaN : Number(x)));
  switch (k) {
    case 'at': case 'rot': case 'mirror': {
      const v = nums();
      if (v.length !== 3 || v.some((n) => !Number.isFinite(n))) throw new SceneError([`${k} wants x,y,z (got "${raw}")`]);
      return [k, v];
    }
    case 'scale': {
      const v = nums();
      if (!(v.length === 1 || v.length === 3) || v.some((n) => !Number.isFinite(n))) throw new SceneError([`scale wants one number or x,y,z (got "${raw}")`]);
      return [k, v.length === 1 ? v[0] : v];
    }
    case 'parts': return [k, list()];
    case 'scratch':
      if (!/^(true|false)$/.test(raw)) throw new SceneError([`scratch wants true or false (got "${raw}")`]);
      return [k, raw === 'true'];
    default: return [k as keyof Fields, raw];
  }
}
