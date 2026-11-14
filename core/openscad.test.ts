// Against the real OpenSCAD: the example model builds through the core, and a generated _scene.scad renders
// with stock openscad, its instances where scene.json put them. Skipped when OpenSCAD is not installed.
import { expect, test } from 'bun:test';
import { mkdtemp, cp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addInstance, editScene, writeSceneScad, loadModel, buildParts } from './index.ts';
import { bunHost, checkOpenscad, OPENSCAD, OPENSCADPATH } from './bun.ts';

const have = (await checkOpenscad()).ok;
const example = path.join(import.meta.dir, '..', 'examples', 'hinge_box');

// x extent of a binary STL
async function xRange(file: string): Promise<[number, number]> {
  const b = await readFile(file);
  const n = b.readUInt32LE(80);
  let lo = Infinity, hi = -Infinity;
  for (let t = 0; t < n; t++) for (let v = 0; v < 3; v++) {
    const x = b.readFloatLE(84 + t * 50 + 12 + v * 12);
    lo = Math.min(lo, x); hi = Math.max(hi, x);
  }
  return [lo, hi];
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
    const proc = Bun.spawn([OPENSCAD, '--backend', 'Manifold', '--export-format', 'binstl', '-o', out, scad],
      { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, OPENSCADPATH } });
    const log = (await new Response(proc.stderr).text()) + (await new Response(proc.stdout).text());
    expect(await proc.exited).toBe(0);
    expect(log).not.toMatch(/ERROR|WARNING/);
    const [lo, hi] = await xRange(out);
    expect(lo).toBeCloseTo(-70, 3);
    expect(hi).toBeCloseTo(160, 3);
  } finally {
    await rm(path.dirname(dir), { recursive: true, force: true });
  }
}, 180_000);
