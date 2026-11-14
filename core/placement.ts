// A placement as a matrix: exactly OpenSCAD's translate(at) rotate(rot) mirror(mirror) scale(scale) part();
// Pure arithmetic, no three.js, so the core (the collision check, later) and the viewer (Matrix4.fromArray) share
// one definition and cannot disagree about where a part is.
//
//   rotate([x, y, z])  about X first, then Y, then Z: Rz · Ry · Rx (three.js Euler order 'ZYX'), degrees
//   mirror(n)          reflection across the plane through the origin with normal n; [0, 0, 0] is no mirror
//   scale(s)           per axis
// M = T(at) · Rz · Ry · Rx · Mirror(n) · S(scale). A mirror (or an odd number of them) makes det(M) < 0, which
// flips triangle winding: whoever draws the mesh must know (mirrored()).
import type { Vec3 } from './scene.ts';

export interface Placement { at?: Vec3; rot?: Vec3; mirror?: Vec3; scale?: number | Vec3 }
type M3 = number[];   // row-major 3x3

const mul3 = (a: M3, b: M3): M3 => {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
};
// cos and sin of whole quarter turns come out exact, as OpenSCAD's own rotate() does, so 90° leaves no 6e-17 dust
function cosSin(deg: number): [number, number] {
  const q = deg / 90;
  if (Number.isInteger(q)) return [[1, 0, -1, 0][((q % 4) + 4) % 4], [0, 1, 0, -1][((q % 4) + 4) % 4]];
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}
export function rotation3(rot: Vec3 = [0, 0, 0]): M3 {
  const [cx, sx] = cosSin(rot[0]), [cy, sy] = cosSin(rot[1]), [cz, sz] = cosSin(rot[2]);
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul3(Rz, mul3(Ry, Rx));
}
export function mirror3(n: Vec3 = [0, 0, 0]): M3 {
  const l2 = n[0] * n[0] + n[1] * n[1] + n[2] * n[2];
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (!l2) return I;
  return I.map((v, i) => v - (2 * n[Math.floor(i / 3)] * n[i % 3]) / l2);
}
const scaleVec = (s: number | Vec3 | undefined): Vec3 => (s == null ? [1, 1, 1] : typeof s === 'number' ? [s, s, s] : s);

// The 4x4 matrix, column-major (three.js Matrix4.fromArray, WebGL order): element [c * 4 + r] is row r, column c.
export function placementMatrix(p: Placement): number[] {
  const s = scaleVec(p.scale), at = p.at ?? [0, 0, 0];
  const m = mul3(rotation3(p.rot), mirror3(p.mirror));
  const l = m.map((v, i) => v * s[i % 3]);          // · S: scales column c
  const out = new Array(16).fill(0);
  for (let r = 0; r < 3; r++) { for (let c = 0; c < 3; c++) out[c * 4 + r] = l[r * 3 + c]; out[12 + r] = at[r]; }
  out[15] = 1;
  return out.map((v) => (Object.is(v, -0) ? 0 : v));
}

// a point through a column-major 4x4 (affine)
export function applyMatrix(m: number[], [x, y, z]: Vec3): Vec3 {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}
export function determinant3(m: number[]): number {
  return m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
}
// does this placement turn the part inside out (winding flipped)?
export const mirrored = (p: Placement) => determinant3(placementMatrix(p)) < 0;
// scale other than 1: clearances scale too (the spec's "scale: allowed, flagged")
export const scaled = (p: Placement) => scaleVec(p.scale).some((v) => v !== 1);
