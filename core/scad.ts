// The OpenSCAD the core writes: the per-part harness it builds from, and _scene.scad. Both are plain files a
// person could have typed; no generated file ever includes two components.
import type { Manifest } from './build.ts';
import type { Placed, Vec3 } from './scene.ts';

// A define's value as OpenSCAD source: a string is taken as written (an expression), anything else as JSON.
export const fmt = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
export const assignments = (defines: Record<string, unknown>) =>
  Object.entries(defines).map(([k, v]) => `${k} = ${fmt(v)};`).join('\n');

// include <file>; <assignments>; <call>. The last assignment wins file-wide in OpenSCAD, so values computed from
// an overridden one recompute.
export function harness(scadPath: string, defines: Record<string, unknown>, call: string): string {
  return `include <${scadPath}>\n${assignments(defines)}\n${call}\n`;
}

const v3 = (v: Vec3) => `[${v.join(', ')}]`;
const same = (v: Vec3, d: number) => v.every((n) => n === d);

// One placed part: translate(at) rotate(rot) mirror(mirror) scale(scale) { call }, leaving out the steps that
// are identity. A reference part (a presence mesh the design is fitted to) gets %: shown, not rendered.
export function placedStatement(p: Placed): string {
  const ops: string[] = [];
  if (!same(p.at, 0)) ops.push(`translate(${v3(p.at)})`);
  if (!same(p.rot, 0)) ops.push(`rotate(${v3(p.rot)})`);
  if (!same(p.mirror, 0)) ops.push(`mirror(${v3(p.mirror)})`);
  if (!same(p.scale, 1)) ops.push(`scale(${v3(p.scale)})`);
  const call = p.call.trim();
  if (!ops.length) return p.reference ? `%union() { ${call} }` : call;   // % cannot prefix a bare { } block
  return `${p.reference ? '%' : ''}${ops.join(' ')} { ${call} }`;
}

// _scene.scad, module-call form (phase 0: one component, no overrides): the model's file once, its defines, then
// every placed part. Lives in the model folder, so the include is the bare file name.
export function sceneScad(manifest: Manifest, placed: Placed[]): string {
  const lines = [
    '// _scene.scad: generated from scene.json by `armenscad scene <model> scad`; edits here are lost.',
    `include <${manifest.file}>`,
  ];
  const defs = assignments(manifest.defines ?? {});
  if (defs) lines.push(defs);
  lines.push('');
  for (const p of placed) lines.push(`${placedStatement(p)}   // ${p.path}${p.scratch ? ' (scratch)' : ''}`);
  return lines.join('\n') + '\n';
}
