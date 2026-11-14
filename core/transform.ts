// Moving and turning a placement by hand (the viewer's gizmo and typed values), on top of placement.ts.
// Pure arithmetic, no three.js. docs/SPEC-components-2026-11-14.md, "Transforms and looks".
//
// A placement is translate(at) rotate(rot) mirror(mirror) scale(scale), so rot pivots about the .scad origin. The
// gizmo turns a part about its own centre instead: turnAbout() works out the rot that the turn gives and folds the
// difference into at, so the saved placement is still OpenSCAD's form and the centre does not move.
// Saved numbers are rounded (MM, DEG) so scene.json stays readable; the turn is solved after rounding rot, so the
// rounding never moves the pivot, only (by under DEG / 2) the angle.
import { rotation3 } from './placement.ts';
import type { Placement } from './placement.ts';
import type { Vec3 } from './scene.ts';

export const MM = 0.01;       // at: hundredths of a mm
export const DEG = 0.1;       // rot: tenths of a degree
export const SCALE = 0.001;

// v to the nearest step; -0 and float dust (0.30000000000000004) come out clean
export function roundTo(v: number, step: number): number {
  const n = Math.round(v / step);
  const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const r = +(n * step).toFixed(digits);
  return Object.is(r, -0) ? 0 : r;
}
export const snap = (v: number, step: number) => (step > 0 ? roundTo(v, step) : v);
export const roundVec = (v: Vec3, step: number): Vec3 => v.map((x) => roundTo(x, step)) as Vec3;

// The step a drag snaps to: 1, 2 or 5 times a power of ten, the smallest at least minPx on screen (mmPerPx: mm per
// CSS pixel at the gizmo). The gizmo's ruler draws its ticks at this step, so a snapped move lands on a tick.
export function niceStep(mmPerPx: number, minPx = 8): number {
  const want = mmPerPx * minPx;
  let p = 10 ** Math.floor(Math.log10(want));
  for (;;) { for (const k of [1, 2, 5]) if (k * p >= want * (1 - 1e-9)) return +(k * p).toPrecision(12); p *= 10; }
}

type M3 = number[];       // row-major 3x3, as placement.ts
const mul3 = (a: M3, b: M3): M3 => {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
};
const T = (m: M3): M3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
const mulV = (m: M3, v: Vec3): Vec3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const R2D = 180 / Math.PI;
// the angle nearest `near` that is a whole number of turns from a
const unwrap = (a: number, near: number) => a + 360 * Math.round((near - a) / 360);

// OpenSCAD's rotate([x, y, z]) angles (degrees) of a rotation matrix R = Rz · Ry · Rx. Every rotation has two such
// triples (and gimbal lock has a line of them); the one nearest `near` (the angles before the turn) is taken, each
// angle unwrapped toward it, so turning about Z from [0, 0, 170] by 15° gives [0, 0, 185], not [0, 0, -175].
export function eulerZYX(R: M3, near: Vec3 = [0, 0, 0]): Vec3 {
  const sy = -R[6], cy = Math.hypot(R[0], R[3]);
  let sols: Vec3[];
  if (cy < 1e-9) {      // y = ±90°: only x - z (or x + z) is fixed; keep x where it was
    const y = sy > 0 ? 90 : -90, x = near[0];
    const z = Math.atan2(-R[1], R[4]) * R2D;          // with x = 0
    sols = [[x, y, z + (sy > 0 ? x : -x)]];
  } else {
    const y = Math.atan2(sy, cy) * R2D, x = Math.atan2(R[7], R[8]) * R2D, z = Math.atan2(R[3], R[0]) * R2D;
    sols = [[x, y, z], [x + 180, 180 - y, z + 180]];
  }
  const fit = (s: Vec3) => s.map((a, i) => unwrap(a, near[i])) as Vec3;
  const cost = (s: Vec3) => s.reduce((n, a, i) => n + Math.abs(a - near[i]), 0);
  return sols.map(fit).sort((a, b) => cost(a) - cost(b))[0];
}

// Turn a placement by deg about world axis `axis` (0 X, 1 Y, 2 Z) through the world point `pivot`. Returns the new
// at and rot (rot rounded to DEG, at to MM unless round is false); mirror and scale are unchanged, since a turn of
// the whole multiplies the rotation from the left: T(p) Ra T(-p) T(at) R M S = T(at') (Ra R) M S.
export function turnAbout(p: Placement, axis: 0 | 1 | 2, deg: number, pivot: Vec3, { round = true } = {}): { at: Vec3; rot: Vec3 } {
  const at = p.at ?? [0, 0, 0], rot = p.rot ?? [0, 0, 0];
  const turn: Vec3 = [0, 0, 0]; turn[axis] = deg;
  const R0 = rotation3(rot);
  let rot1 = eulerZYX(mul3(rotation3(turn), R0), rot);
  if (axis === 2) rot1 = [rot[0], rot[1], rot[2] + deg];       // about Z it is exact: Rz is the outermost turn
  if (round) rot1 = roundVec(rot1, DEG);
  // the pivot, seen from the placement's own frame before rotation (M S c_local): R0^T (pivot - at)
  const L = mulV(T(R0), [pivot[0] - at[0], pivot[1] - at[1], pivot[2] - at[2]]);
  const RL = mulV(rotation3(rot1), L);
  const at1: Vec3 = [pivot[0] - RL[0], pivot[1] - RL[1], pivot[2] - RL[2]];
  return { at: round ? roundVec(at1, MM) : at1, rot: rot1 };
}

// a move by a world delta
export function moveBy(p: Placement, by: Vec3, { round = true } = {}): Vec3 {
  const at = p.at ?? [0, 0, 0];
  const v: Vec3 = [at[0] + by[0], at[1] + by[1], at[2] + by[2]];
  return round ? roundVec(v, MM) : v;
}
