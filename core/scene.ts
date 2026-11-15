// scene.json: what a model shows, and where. Pure: validation, the default scene, resolution to placed parts,
// edits and the file's text. No Node imports, so the viewer imports it too (the split it offers is this file's).
// Reading and writing the file, and its hash, are model.ts.
//
// Shape (docs/SPEC-components-2026-11-14.md): instances of the model's own parts, and of other folders ("use").
//   { "version": 1, "instances": [ { "id": "box2", "parts": ["box"], "at": [70, 0, 0], "mirror": [1, 0, 0] },
//                                  { "id": "knee_L", "use": "../knee", "at": [16.8, 0, -66] } ] }
// A placement means translate(at) rotate(rot) mirror(mirror) scale(scale) <call>, a move from where the .scad
// draws the part. A part is addressed instance.part, so ids and part names carry no dots.
// Another folder is a component: it offers its parts as its .scad draws them, or, when it has a scene.json of its
// own, what that scene places (scratch instances left out), addressed instance.inner.part.
// "set" gives an instance its own values of what its component's .scad exports (core/source.ts parseExports):
//   { "id": "knee_L", "use": "../knee", "set": { "who": "mixmaster", "bend": 45 } }
// Plain values only (numbers, true/false, strings, lists of those): no expressions. A set reaches the parts built
// from that component's own .scad, also through its own scene; not the folders that scene uses in turn.
import type { Manifest } from './build.ts';
import type { Exports } from './source.ts';
import { placementMatrix, mulMatrix } from './placement.ts';

export const SCENE_FILE = 'scene.json';
export const SCENE_SCAD = '_scene.scad';

export type Vec3 = [number, number, number];
export interface Instance {
  id: string;
  use?: string;
  parts?: string[];
  set?: Record<string, unknown>;
  at?: Vec3;
  rot?: Vec3;
  scale?: number | Vec3;
  mirror?: Vec3;
  color?: string;
  material?: string;
  scratch?: boolean;
}
export interface Scene { version: 1; instances: Instance[] }

// Another folder as a scene sees it. model.ts loads the tree (viewer.json, scene.json and what that uses in turn).
export interface Component {
  rel: string;                       // the folder, relative to the folder of the scene being resolved ("../knee")
  dir: string;                       // the folder itself
  manifest: Manifest;
  scene: Scene | null;               // its own scene.json; null: it has none, and offers its parts as drawn
  uses: Uses;
  exports: Exports | null;           // what its .scad lets a scene set; null: it has no .scad of its own
  error?: string;                    // why it cannot be used (no viewer.json, a broken scene.json, a loop)
}
export type Uses = Record<string, Component>;   // by the "use" string as the scene writes it

// one part of one instance, as placed
export interface Placed {
  path: string;            // instance.part, or instance.inner.part through a component with its own scene
  instance: string;
  part: string;
  component: string;       // the folder the part is built in, relative to this scene's: "." is this model
  src: string;             // what to ask the build for: the part's name, or <component>/<name> for another folder's,
                           // then ?<its set as JSON, names in order> when it is built with values of its own
  set: Record<string, unknown> | null;   // those values: every "set" on the way down to it, the outermost winning
  inner: number[] | null;  // the matrix below the instance's own placement (a component's own scene), column-major
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

export const FIELDS = ['id', 'use', 'parts', 'set', 'at', 'rot', 'scale', 'mirror', 'color', 'material', 'scratch'] as const;
const ID = /^[A-Za-z0-9_-]+$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

// No scene.json = today: one instance of the model's own component, every part where the .scad draws it.
// Its id is the model folder's name, so its parts read hinge_box.box.
export function defaultScene(folder: string): Scene {
  return { version: 1, instances: [{ id: folder.replace(/[^A-Za-z0-9_-]/g, '_') || 'model' }] };
}

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const isVec3 = (x: unknown) => Array.isArray(x) && x.length === 3 && x.every((n) => typeof n === 'number' && Number.isFinite(n));

// Every problem at once, each naming the instance, so one hand edit can fix them all.
const plain = (v: unknown): boolean => (typeof v === 'number' ? Number.isFinite(v) : typeof v === 'boolean' || typeof v === 'string' || (Array.isArray(v) && v.every(plain)));
// own: what this model's own .scad exports (null: it has none, or the caller does not know: then no instance of
// its own parts can take a set).
export function validateScene(doc: unknown, manifest: Manifest, uses: Uses = {}, own: Exports | null = null): string[] {
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
    let offered: string[] | null = names, where = 'viewer.json has';
    let exp: Exports | null | undefined = own, who = 'this model';       // undefined: the folder could not be read
    if (inst.use !== undefined && inst.use !== '.') {
      offered = null; exp = undefined; who = String(inst.use);
      const c = typeof inst.use === 'string' ? uses[inst.use] : undefined;
      if (typeof inst.use !== 'string' || !inst.use) bad('"use" must be a folder, relative to this one ("../knee"), or "." for this model');
      else if (!c) bad(`"use": "${inst.use}": not a folder beside this one (write it relative to this folder, like "../knee")`);
      else if (c.error) bad(`"use": "${inst.use}": ${c.error}`);
      else { offered = offers(c); where = `${inst.use} offers`; exp = c.exports; }
    }
    if (inst.set !== undefined) {
      if (!isObj(inst.set)) bad('set must be an object of values: { "arm_t": 1.3 }');
      else if (exp === null) bad(`set: ${who} has no .scad of its own, so no values to set (set them on the instances inside it)`);
      else if (exp) for (const [k, v] of Object.entries(inst.set)) {
        const has = exp.values.map((x) => x.name);
        if (exp.internal.includes(k)) bad(`set: "${k}" is internal to ${who} (its .scad has @exports-only and does not mark it @export)`);
        else if (!has.includes(k)) bad(`set: ${who} has no value "${k}" (it exports ${has.slice(0, 12).join(', ') || 'nothing'}${has.length > 12 ? `, and ${has.length - 12} more` : ''})`);
        else if (!plain(v)) bad(`set: "${k}" must be a number, true or false, a string, or a list of those (no expressions)`);
      }
    }
    if (inst.parts !== undefined) {
      if (!Array.isArray(inst.parts) || !inst.parts.length || !inst.parts.every((p: unknown) => typeof p === 'string'))
        bad('parts must be a non-empty list of part names (leave it out for all of them)');
      else {
        if (offered) for (const p of inst.parts) if (!offered.includes(p)) bad(`unknown part "${p}" (${where} ${offered.join(', ') || 'no parts'})`);
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
      if (!(FIELDS as readonly string[]).includes(k)) bad(`unknown field "${k}" (an instance has ${FIELDS.join(', ')})`);
  });
  return errs;
}

const vec = (v: Vec3 | undefined, d: number): Vec3 => (v ? [...v] as Vec3 : [d, d, d]);

// One part as a component offers it: its name there (a path through the component's own scene, if it has one),
// and the matrix that scene gives it.
interface Offer {
  name: string; part: string; component: string; call: string; color: string; material: string | null;
  group: string | null; reference: boolean; inner: number[] | null; set: Record<string, unknown> | null;
}
const own = (manifest: Manifest, rel: string): Offer[] => manifest.parts.map((p) => ({
  name: p.name, part: p.name, component: rel, call: p.call, color: p.color ?? '#999999', material: null,
  group: p.group ?? null, reference: !!p.reference, inner: null, set: null,
}));
// what one instance shows, before its own placement: its component's offers, cut down to "parts", with its "set"
// on the parts that are built from that component's own .scad (over any set from further in)
function shown(inst: Instance, manifest: Manifest, rel: string, uses: Uses): Offer[] {
  const c = inst.use !== undefined && inst.use !== '.' ? uses[inst.use] : null;
  let all = c ? (c.error ? [] : offered(c)) : own(manifest, rel);
  if (inst.parts) all = all.filter((o) => inst.parts!.includes(o.name));
  const set = inst.set && Object.keys(inst.set).length ? inst.set : null, target = c ? c.rel : rel;
  return set ? all.map((o) => (o.component === target ? { ...o, set: { ...(o.set ?? {}), ...set } } : o)) : all;
}
// a set's identity in a part's src: its entries in name order, as JSON (the same text as core/build.ts setKey)
const setKey = (set: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(set).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
// A component with no scene.json offers its parts where its .scad draws them. One with a scene.json offers what
// that scene places, scratch left out: "a component's scene is what it contributes when used".
function offered(c: Component): Offer[] {
  if (!c.scene) return own(c.manifest, c.rel);
  const out: Offer[] = [];
  for (const inst of c.scene.instances) {
    if (inst.scratch) continue;
    const m = placementMatrix(inst);
    for (const o of shown(inst, c.manifest, c.rel, c.uses))
      out.push({ ...o, name: `${inst.id}.${o.name}`, color: inst.color ?? o.color, material: inst.material ?? o.material,
                 inner: o.inner ? mulMatrix(m, o.inner) : m });
  }
  return out;
}
// the names an instance of this component can list in "parts"
export const offers = (c: Component): string[] => offered(c).map((o) => o.name);
// the same for each instance of a scene: instance id -> names (the viewer's split, the CLI's)
export function sceneOffers(scene: Scene, manifest: Manifest, uses: Uses = {}): Record<string, string[]> {
  return Object.fromEntries(scene.instances.map((inst) => [inst.id, shown({ ...inst, parts: undefined, set: undefined }, manifest, '.', uses).map((o) => o.name)]));
}

// The flat list of placed parts, instance by instance, parts in viewer.json order. Scratch instances are left
// out when scratch is false (the generated .scad, later the check and the export); the viewer shows them.
export function resolveScene(scene: Scene, manifest: Manifest, { scratch = true, uses = {} as Uses } = {}): Placed[] {
  const out: Placed[] = [];
  for (const inst of scene.instances) {
    if (inst.scratch && !scratch) continue;
    for (const o of shown(inst, manifest, '.', uses)) {
      out.push({
        path: `${inst.id}.${o.name}`, instance: inst.id, part: o.part, component: o.component,
        src: (o.component === '.' ? o.part : `${o.component}/${o.part}`) + (o.set ? `?${setKey(o.set)}` : ''), set: o.set, inner: o.inner, call: o.call,
        color: inst.color ?? o.color, material: inst.material ?? o.material, group: o.group,
        reference: o.reference, scratch: !!inst.scratch,
        at: vec(inst.at, 0), rot: vec(inst.rot, 0), mirror: vec(inst.mirror, 0),
        scale: typeof inst.scale === 'number' ? [inst.scale, inst.scale, inst.scale] : vec(inst.scale, 1),
      });
    }
  }
  return out;
}
// every other folder a scene builds from, each once, however deep
export function components(uses: Uses, out = new Map<string, Component>()): Component[] {
  for (const c of Object.values(uses)) if (!c.error && !out.has(c.dir)) { out.set(c.dir, c); components(c.uses, out); }
  return [...out.values()];
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

// One value of one instance: v sets it, undefined clears it (the component's default holds again). An instance
// left with no values loses its "set".
export function setValue(scene: Scene, id: string, name: string, v: unknown): Scene {
  const s = clone(scene), inst = find(s, id);
  const set = { ...(inst.set ?? {}) };
  if (v === undefined) delete set[name]; else set[name] = v;
  if (Object.keys(set).length) inst.set = set; else delete inst.set;
  return s;
}
// A value typed on a command line or in a field: JSON where it parses (1.3, true, [1, 2], "a b"), else the text
// itself as a string (mixmaster).
export function parseValue(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return raw; }
}

// A free instance id made from a name: the name itself (characters an id cannot have made _), else name_2, name_3...
export function freeId(scene: Scene, name: string): string {
  const base = name.replace(/[^A-Za-z0-9_-]/g, '_') || 'part';
  const ids = new Set(scene.instances.map((x) => x.id));
  if (!ids.has(base)) return base;
  let n = 2; while (ids.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
// Split one part out of an instance into an instance of its own (exploded views, print layouts, one piece set
// aside): the new one shows only that part, right after the source, with the source's placement and looks, so
// nothing moves; the source stops showing it (a source showing every part gets a parts list of the others, in
// viewer.json order). The new id is `to`, else one made from the part's name (lid, lid_2, ...). Refused for a part
// the instance does not show, and for an instance showing only that part (there is nothing to split it from).
// has: the model's own parts, or (a scene with other folders) each instance's names, as sceneOffers gives them.
export function splitInstance(scene: Scene, has: Pick<Manifest, 'parts'> | Record<string, string[]>, id: string, part: string, to?: string): Scene {
  const s = clone(scene), src = find(s, id);
  const names: string[] = Array.isArray((has as any).parts) ? (has as any).parts.map((p: any) => p.name) : (has as Record<string, string[]>)[id] ?? [];
  if (!names.includes(part)) throw new SceneError([`no part "${part}" (${id} has ${names.join(', ') || 'none'})`]);
  const shown = src.parts ?? names;
  if (!shown.includes(part)) throw new SceneError([`${id} does not show "${part}" (it shows ${shown.join(', ')})`]);
  if (shown.length < 2) throw new SceneError([`${id} shows only "${part}": nothing to split it from (move ${id} itself)`]);
  to ??= freeId(s, part.split('.').pop()!);
  taken(s, to);
  const inst: Instance = { ...structuredClone(src), id: to, parts: [part] };
  src.parts = shown.filter((p) => p !== part);
  s.instances.splice(s.instances.indexOf(src) + 1, 0, inst);
  return s;
}

// A field typed on the command line: at=1,2,3 (or [1, 2, 3]), scale=2, parts=box,lid, scratch=true;
// an empty value (at=) clears the field.
export function parseField(arg: string): [keyof Fields, unknown] {
  const m = arg.match(/^(\w+)=(.*)$/s);
  if (!m) throw new SceneError([`"${arg}" is not field=value`]);
  const [, k, raw] = m;
  if (k === 'id') throw new SceneError(['an instance id cannot be changed; copy it to the new id and remove the old one']);
  if (k === 'set') throw new SceneError(['a value is set as <id>.<name> <value> (armenscad scene <model> set knee_L.arm_t 1.3), not as a field']);
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
