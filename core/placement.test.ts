import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { placementMatrix, applyMatrix, mirrored, scaled, determinant3, type Placement } from './placement.ts';
import type { Vec3 } from './scene.ts';

const at = (p: Placement, v: Vec3) => applyMatrix(placementMatrix(p), v);
const close = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 9));

describe('placementMatrix: translate(at) rotate(rot) mirror(mirror) scale(scale)', () => {
  test('identity', () => {
    expect(placementMatrix({})).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });
  test('translate', () => expect(at({ at: [1, 2, 3] }, [10, 0, 0])).toEqual([11, 2, 3]));
  test('rotate about one axis, right-handed, degrees, quarter turns exact', () => {
    expect(at({ rot: [90, 0, 0] }, [0, 1, 0])).toEqual([0, 0, 1]);     // y -> z
    expect(at({ rot: [0, 90, 0] }, [0, 0, 1])).toEqual([1, 0, 0]);     // z -> x
    expect(at({ rot: [0, 0, 90] }, [1, 0, 0])).toEqual([0, 1, 0]);     // x -> y
    expect(at({ rot: [0, 0, -270] }, [1, 0, 0])).toEqual([0, 1, 0]);
    close(at({ rot: [0, 0, 30] }, [1, 0, 0]), [Math.sqrt(3) / 2, 0.5, 0]);
  });
  test('rotate([x, y, z]) turns about X first, then Y, then Z', () => {
    // x then y: z-axis -> (X 90) -y -> (Y 90) -y ; y-axis -> z -> x
    expect(at({ rot: [90, 90, 0] }, [0, 1, 0])).toEqual([1, 0, 0]);
    // y then z: x-axis -> (Y 90) -z -> (Z 90) -z
    expect(at({ rot: [0, 90, 90] }, [1, 0, 0])).toEqual([0, 0, -1]);
    // x then z: y-axis -> (X 90) z -> (Z 90) z; x-axis -> x -> y
    expect(at({ rot: [90, 0, 90] }, [0, 1, 0])).toEqual([0, 0, 1]);
    expect(at({ rot: [90, 0, 90] }, [1, 0, 0])).toEqual([0, 1, 0]);
  });
  test('mirror: across the plane through the origin with normal n, any length', () => {
    expect(at({ mirror: [1, 0, 0] }, [1, 2, 3])).toEqual([-1, 2, 3]);
    expect(at({ mirror: [0, 0, 5] }, [1, 2, 3])).toEqual([1, 2, -3]);
    close(at({ mirror: [1, 1, 0] }, [1, 0, 0]), [0, -1, 0]);
    expect(at({ mirror: [0, 0, 0] }, [1, 2, 3])).toEqual([1, 2, 3]);   // OpenSCAD: no-op
  });
  test('scale: one number or per axis', () => {
    expect(at({ scale: 2 }, [1, 2, 3])).toEqual([2, 4, 6]);
    expect(at({ scale: [1, 2, 3] }, [1, 1, 1])).toEqual([1, 2, 3]);
  });
  test('order: scale, then mirror, then rotate, then translate', () => {
    // [1,0,0] scale [2,1,1] -> [2,0,0]; mirror x -> [-2,0,0]; rot z 90 -> [0,-2,0]; at -> [10,-2,0]
    expect(at({ at: [10, 0, 0], rot: [0, 0, 90], mirror: [1, 0, 0], scale: [2, 1, 1] }, [1, 0, 0])).toEqual([10, -2, 0]);
  });
  test('mirrored and scaled flags', () => {
    expect(mirrored({ mirror: [1, 0, 0] })).toBe(true);
    expect(mirrored({ mirror: [1, 0, 0], rot: [0, 0, 180] })).toBe(true);
    expect(mirrored({ rot: [180, 0, 0], scale: [1, 2, 3] })).toBe(false);
    expect(determinant3(placementMatrix({ scale: 2 }))).toBeCloseTo(8, 12);
    expect(scaled({ scale: 1 })).toBe(false);
    expect(scaled({ scale: [1, 1, 1] })).toBe(false);
    expect(scaled({ scale: [1, 1, 1.01] })).toBe(true);
    expect(scaled({})).toBe(false);
  });
});

// The viewer turns the array into a three.js Matrix4; three's own Euler 'ZYX' must agree (skipped before the
// viewer's bun install)
const threePath = path.join(import.meta.dir, '..', 'viewer', 'node_modules', 'three', 'build', 'three.module.js');
test.skipIf(!existsSync(threePath))('agrees with three.js: Euler ZYX, Matrix4.fromArray', async () => {
  const THREE = await import(threePath);
  const d = THREE.MathUtils.degToRad;
  for (const rot of [[10, 20, 30], [-45, 120, 7.5], [90, 0, 33]] as Vec3[]) {
    const ref = new THREE.Matrix4().compose(new THREE.Vector3(1, 2, 3), new THREE.Quaternion().setFromEuler(new THREE.Euler(d(rot[0]), d(rot[1]), d(rot[2]), 'ZYX')), new THREE.Vector3(2, 3, 4));
    close(placementMatrix({ at: [1, 2, 3], rot, scale: [2, 3, 4] }), ref.elements);
    const m = new THREE.Matrix4().fromArray(placementMatrix({ rot, mirror: [0, 1, 0] }));
    expect(m.determinant()).toBeCloseTo(-1, 9);
  }
});
