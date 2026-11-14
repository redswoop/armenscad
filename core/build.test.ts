import { describe, expect, test } from 'bun:test';
import { harness, buildParts, loadModel, type Manifest } from './index.ts';
import { memHost } from './mem.ts';

const manifest: Manifest = {
  file: 'box.scad',
  defines: { show_all: false },
  parts: [
    { name: 'box', call: 'box();', color: '#4682b4' },
    { name: 'lid', call: 'lid_at(lid_deg);', color: '#daa520' },
    { name: 'brick', call: 'brick();', reference: true },
  ],
};

describe('harness', () => {
  test('harness: include, assignments, call (byte for byte what the server always wrote)', () => {
    expect(harness('/w/m/box.scad', { show_all: false, name: '"x"', n: 2 }, 'box();')).toBe('include </w/m/box.scad>\nshow_all = false;\nname = "x";\nn = 2;\nbox();\n');
    expect(harness('/w/m/box.scad', {}, 'box();')).toBe('include </w/m/box.scad>\n\nbox();\n');
  });
});

describe('build cache', () => {
  const files = { '/w/m/viewer.json': JSON.stringify(manifest), '/w/m/box.scad': 'use <armenscad/fit.scad>\nmodule box() {}', '/lib/armenscad/fit.scad': 'x = 1;' };
  const tris = (scad: string) => (scad.includes('brick') ? 0 : 3);

  test('same content builds once; an edit to an included file rebuilds; old keys are pruned', async () => {
    const { host, files: fs, builder } = memHost(files, tris);
    const m = await loadModel(host, '/w/m');
    const a = await buildParts(host, m, '/cache/m');
    expect(builder.runs).toHaveLength(3);
    expect(a.parts.map((p) => [p.name, p.ok, p.empty, p.tris])).toEqual([['box', true, false, 3], ['lid', true, false, 3], ['brick', false, true, 0]]);
    expect(a.stl('box')).toBe(`/cache/m/${a.keys.get('box')}.stl`);
    const b = await buildParts(host, m, '/cache/m', { keep: new Set(a.keys.values()) });
    expect(builder.runs).toHaveLength(3);                       // every part a cache hit
    expect(b.keys).toEqual(a.keys);
    await fs.write('/lib/armenscad/fit.scad', 'x = 2;');          // a used library file changes
    const c = await buildParts(host, m, '/cache/m', { keep: new Set(b.keys.values()) });
    expect(builder.runs).toHaveLength(6);
    expect(c.keys.get('box')).not.toBe(a.keys.get('box'));
    await buildParts(host, m, '/cache/m', { overrides: { lid_deg: 90 }, keep: new Set(c.keys.values()) });   // an override: new keys
    expect(builder.runs).toHaveLength(9);
    await buildParts(host, m, '/cache/m', { overrides: { lid_deg: 90 }, keep: new Set(c.keys.values()), fresh: true });
    expect(builder.runs).toHaveLength(12);                      // fresh: renders again though cached
    const left = new Set((await fs.list('/cache/m')).map((f) => f.split('.')[0]));
    expect(left.has(a.keys.get('box')!)).toBe(false);           // two builds back: gone
    expect(left.has(c.keys.get('box')!)).toBe(true);            // the previous build: kept
  });
  test('two parts with the same call build once', async () => {
    const { host, builder } = memHost({ ...files, '/w/m/viewer.json': JSON.stringify({ file: 'box.scad', parts: [{ name: 'a', call: 'box();' }, { name: 'b', call: 'box();' }] }) });
    const r = await buildParts(host, await loadModel(host, '/w/m'), '/cache/m');
    expect(builder.runs).toHaveLength(1);
    expect(r.parts.every((p) => p.ok)).toBe(true);
  });
});
