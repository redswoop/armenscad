// Against the real OpenSCAD: the example model builds through the core, and a generated _scene.scad renders
// with stock openscad, its instances where scene.json put them. Skipped when OpenSCAD is not installed.
import { expect, test } from 'bun:test';
import { mkdtemp, cp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addInstance, editScene, writeScene, writeSceneScad, loadModel, buildParts, placementMatrix, applyMatrix, type Instance, type Vec3 } from './index.ts';
import { bunHost, checkOpenscad, OPENSCAD, OPENSCADPATH } from './bun.ts';

const have = (await checkOpenscad()).ok;
const example = path.join(import.meta.dir, '..', 'examples', 'hinge_box');

// the vertices of a binary STL
async function vertices(file: string): Promise<Vec3[]> {
  const b = await readFile(file);
  const n = b.readUInt32LE(80), out: Vec3[] = [];
  for (let t = 0; t < n; t++) for (let v = 0; v < 3; v++) {
    const o = 84 + t * 50 + 12 + v * 12;
    out.push([b.readFloatLE(o), b.readFloatLE(o + 4), b.readFloatLE(o + 8)]);
  }
  return out;
}
// [min, max] per axis
function box(pts: Vec3[]): [Vec3, Vec3] {
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
  return [lo, hi];
}
// x extent of a binary STL
const xRange = async (file: string): Promise<[number, number]> => { const [lo, hi] = box(await vertices(file)); return [lo[0], hi[0]]; };
async function renderScad(scad: string, out: string) {
  const proc = Bun.spawn([OPENSCAD, '--backend', 'Manifold', '--export-format', 'binstl', '-o', out, scad],
    { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, OPENSCADPATH } });
  const log = (await new Response(proc.stderr).text()) + (await new Response(proc.stdout).text());
  return { code: await proc.exited, log };
}

test.skipIf(!have)('hinge_box: parts build through the core, _scene.scad renders with a moved and a mirrored instance', async () => {
  const dir = path.join(await mkdtemp(path.join(tmpdir(), 'armenscad-')), 'hinge_box');
  try {
    await cp(example, dir, { recursive: true });
    const host = bunHost();

    const built = await buildParts(host, await loadModel(host, dir), path.join(dir, '.cache'));
    expect(built.parts.map((p) => [p.name, p.ok, p.log])).toEqual([['box', true, ''], ['lid', true, ''], ['pin', true, '']]);

    // the box is 60 wide from x = 0; moved: 100..160; mirrored about x = 0 then moved -10: -70..-10
    await editScene(host, dir, (s) => addInstance(addInstance(s, 'moved', { parts: ['box'], at: [100, 0, 0] }),
      'flipped', { parts: ['box'], mirror: [1, 0, 0], at: [-10, 0, 0] }));
    const { path: scad, text } = await writeSceneScad(host, dir);
    expect(text).toContain('translate([100, 0, 0]) { box(); }   // moved.box');
    expect(text).toContain('translate([-10, 0, 0]) mirror([1, 0, 0]) { box(); }   // flipped.box');

    const out = path.join(dir, 'scene.stl');
    const { code, log } = await renderScad(scad, out);
    expect(code).toBe(0);
    expect(log).not.toMatch(/ERROR|WARNING/);
    const [lo, hi] = await xRange(out);
    expect(lo).toBeCloseTo(-70, 3);
    expect(hi).toBeCloseTo(160, 3);
  } finally {
    await rm(path.dirname(dir), { recursive: true, force: true });
  }
}, 180_000);

// The viewer places meshes with placementMatrix; OpenSCAD places them with the generated _scene.scad. For each kind
// of placement, the box of the part's own STL through the matrix must be the box OpenSCAD renders.
test.skipIf(!have)('placementMatrix agrees with OpenSCAD: moved, rotated about all three axes, mirrored, scaled', async () => {
  const dir = path.join(await mkdtemp(path.join(tmpdir(), 'armenscad-')), 'hinge_box');
  try {
    await cp(example, dir, { recursive: true });
    const host = bunHost();
    const built = await buildParts(host, await loadModel(host, dir), path.join(dir, '.cache'));
    const parts = Object.fromEntries(await Promise.all(['box', 'lid'].map(async (n) => [n, await vertices(built.stl(n)!)])));
    const cases: Instance[] = [
      { id: 'moved', parts: ['box'], at: [100, -20, 7.5] },
      { id: 'turned', parts: ['box', 'lid'], at: [5, 6, 7], rot: [30, -50, 70] },
      { id: 'flipped', parts: ['lid'], at: [-10, 0, 0], rot: [0, 0, 15], mirror: [1, 1, 0] },
      { id: 'scaled', parts: ['box'], scale: [1.5, 0.75, 2], rot: [0, 90, 0] },
    ];
    let hash = 'none';
    for (const inst of cases) {
      hash = await writeScene(host, dir, { version: 1, instances: [inst] }, hash);
      const { path: scad } = await writeSceneScad(host, dir);
      const out = path.join(dir, `${inst.id}.stl`);
      const r = await renderScad(scad, out);
      expect(r.code).toBe(0);
      const want = box(await vertices(out));
      const m = placementMatrix(inst);
      const got = box(inst.parts!.flatMap((n) => parts[n].map((p) => applyMatrix(m, p))));
      for (let k = 0; k < 2; k++) for (let i = 0; i < 3; i++) expect(Math.abs(got[k][i] - want[k][i])).toBeLessThan(1e-3);
    }
  } finally {
    await rm(path.dirname(dir), { recursive: true, force: true });
  }
}, 300_000);
