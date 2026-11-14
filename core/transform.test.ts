import { describe, expect, test } from 'bun:test';
import { placementMatrix, applyMatrix, rotation3, type Placement } from './placement.ts';
import { turnAbout, moveBy, eulerZYX, roundTo, snap, niceStep } from './transform.ts';
import type { Vec3 } from './scene.ts';

const close = (a: number[], b: number[], digits = 9) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], digits));
// the world matrix of turning p by deg about axis through pivot, done the long way: T(c) Ra T(-c) M
function turned(p: Placement, axis: 0 | 1 | 2, deg: number, c: Vec3): (v: Vec3) => Vec3 {
  const M = placementMatrix(p), t: Vec3 = [0, 0, 0]; t[axis] = deg;
  const R = rotation3(t);
  return (v) => {
    const w = applyMatrix(M, v), d = [w[0] - c[0], w[1] - c[1], w[2] - c[2]];
    return [0, 1, 2].map((r) => c[r] + R[r * 3] * d[0] + R[r * 3 + 1] * d[1] + R[r * 3 + 2] * d[2]) as Vec3;
  };
}
const probes: Vec3[] = [[0, 0, 0], [10, 0, 0], [0, 20, 0], [0, 0, 30], [7, -3, 12]];

describe('eulerZYX: OpenSCAD rotate() angles back from a matrix', () => {
  test('round trips, general and near the previous angles', () => {
    for (const r of [[10, 20, 30], [-75, 40, 170], [123, -10, -45], [0, 0, 185]] as Vec3[]) {
      const e = eulerZYX(rotation3(r), r);
      close(rotation3(e), rotation3(r));
      close(e, r);                       // the same triple back when it is the nearest
    }
  });
  test('the other triple, when nearer', () => {
    const r: Vec3 = [190, 160, 200];     // same rotation as [10, 20, 20]
    close(rotation3(eulerZYX(rotation3(r), r)), rotation3(r));
    close(eulerZYX(rotation3(r), r), r);
  });
  test('gimbal lock (y = ±90) keeps x and solves z', () => {
    for (const r of [[30, 90, 10], [-20, -90, 45]] as Vec3[]) {
      const e = eulerZYX(rotation3(r), r);
      close(rotation3(e), rotation3(r));
      expect(e[0]).toBeCloseTo(r[0], 9);
    }
  });
});

describe('turnAbout: a turn about the centre, folded into at', () => {
  // a placement that already has rot, mirror and (non-uniform) scale
  const p: Placement = { at: [12.5, -4, 3], rot: [20, -35, 110], mirror: [1, 0, 0], scale: [1.5, 1, 2] };
  const pivot: Vec3 = [20, 5, 11];
  for (const axis of [0, 1, 2] as const) for (const deg of [15, -90, 37.3]) {
    test(`axis ${'XYZ'[axis]} ${deg}°: the saved placement draws what the preview drew`, () => {
      const exact = turnAbout(p, axis, deg, pivot, { round: false });
      const saved = turnAbout(p, axis, deg, pivot);
      const want = turned(p, axis, deg, pivot);
      for (const v of probes) {
        close(applyMatrix(placementMatrix({ ...p, ...exact }), v), want(v), 6);     // preview: exact
        // saved: rot to 0.1°, at to 0.01 mm; a point ~80 mm from the pivot moves under 0.15 mm for that
        const got = applyMatrix(placementMatrix({ ...p, ...saved }), v), w = want(v);
        expect(Math.hypot(got[0] - w[0], got[1] - w[1], got[2] - w[2])).toBeLessThan(0.15);
      }
      // saved numbers are rounded
      saved.at.forEach((x) => expect(x).toBe(roundTo(x, 0.01)));
      saved.rot.forEach((x) => expect(x).toBe(roundTo(x, 0.1)));
    });
  }
  test('the pivot stays put after rounding (any rot)', () => {
    const saved = turnAbout(p, 0, 15, pivot, { round: false });
    // pivot in the part's frame is fixed: M' L = pivot with L from the old placement
    const inv = (P: Placement, w: Vec3) => {      // solve M v = w for v by the frame's columns (3x3 solve)
      const m = placementMatrix(P), A = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]], b = [w[0] - m[12], w[1] - m[13], w[2] - m[14]];
      const det = (M: number[][]) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
      const D = det(A);
      return [0, 1, 2].map((k) => det(A.map((row, r) => row.map((x, c) => (c === k ? b[r] : x)))) / D) as Vec3;
    };
    const L = inv(p, pivot);
    close(applyMatrix(placementMatrix({ ...p, ...saved }), L), pivot, 9);
    const r = turnAbout(p, 1, 22.5, pivot);
    const q = applyMatrix(placementMatrix({ ...p, ...r }), L);      // rounding rot never moves the pivot; at's 0.01 mm may
    expect(Math.hypot(q[0] - pivot[0], q[1] - pivot[1], q[2] - pivot[2])).toBeLessThan(0.01);
  });
  test('about Z adds to rot z exactly, unwrapped', () => {
    expect(turnAbout({ rot: [0, 0, 170] }, 2, 15, [0, 0, 0]).rot).toEqual([0, 0, 185]);
    expect(turnAbout({ rot: [10, 20, 30] }, 2, -45, [5, 5, 5]).rot).toEqual([10, 20, -15]);
  });
  test('about X from no rotation is just rot x; the at swings round the pivot', () => {
    const r = turnAbout({}, 0, 90, [0, 10, 0]);
    expect(r.rot).toEqual([90, 0, 0]);
    expect(r.at).toEqual([0, 10, -10]);       // the origin, 10 below the pivot in y, turns to 10 below in z
  });
  test('15° steps from a turned placement come out on clean tenths', () => {
    let q: Placement = { rot: [0, 0, 45] };
    for (let i = 0; i < 4; i++) q = { ...q, ...turnAbout(q, 0, 15, [3, 4, 5]) };
    q.rot!.forEach((x) => expect(x).toBe(roundTo(x, 0.1)));
  });
});

describe('snapping and rounding', () => {
  test('roundTo cleans dust and -0', () => {
    expect(roundTo(0.1 + 0.2, 0.01)).toBe(0.3);
    expect(roundTo(-0.004, 0.01)).toBe(0);
    expect(Object.is(roundTo(-0.004, 0.01), -0)).toBe(false);
    expect(roundTo(12.345678, 0.1)).toBe(12.3);
    expect(roundTo(184.99999999, 0.1)).toBe(185);
  });
  test('snap to a step; 0 means free', () => {
    expect(snap(7.4, 5)).toBe(5);
    expect(snap(7.6, 5)).toBe(10);
    expect(snap(22, 15)).toBe(15);
    expect(snap(23, 15)).toBe(30);
    expect(snap(1.2345, 0)).toBe(1.2345);
    expect(snap(-0.04, 0.1)).toBe(0);
  });
  test('niceStep: 1, 2, 5 x 10^n, at least 8 px', () => {
    expect(niceStep(0.1)).toBe(1);      // 0.8 mm wanted
    expect(niceStep(0.2)).toBe(2);
    expect(niceStep(0.5)).toBe(5);
    expect(niceStep(1)).toBe(10);
    expect(niceStep(0.01)).toBe(0.1);
    expect(niceStep(0.03)).toBe(0.5);
    expect(niceStep(3)).toBe(50);
  });
  test('moveBy rounds at', () => {
    expect(moveBy({ at: [0.1, 0, 0] }, [0.2, 1 / 3, -0.001])).toEqual([0.3, 0.33, 0]);
    expect(moveBy({}, [5, 0, 0])).toEqual([5, 0, 0]);
  });
});
