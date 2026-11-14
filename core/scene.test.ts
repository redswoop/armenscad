import { describe, expect, test } from 'bun:test';
import {
  validateScene, defaultScene, resolveScene, formatScene, sceneHash, parseField,
  addInstance, copyInstance, moveInstance, removeInstance, setFields, SceneError,
  readScene, writeScene, editScene, writeSceneScad, StaleError, sceneScad,
  type Manifest, type Scene,
} from './index.ts';
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
const scene = (...instances: any[]) => ({ version: 1, instances });

describe('validation', () => {
  test('a good scene has no errors', () => {
    expect(validateScene(scene({ id: 'a' }, { id: 'b', use: '.', parts: ['box'], at: [1, 2, 3], rot: [0, 0, 90], scale: 2,
      mirror: [1, 0, 0], color: '#c8823a', material: 'petg', scratch: true }), manifest)).toEqual([]);
  });
  test('ids: unique, no dots, present', () => {
    const e = validateScene(scene({ id: 'a' }, { id: 'a' }, { id: 'k.l' }, {}), manifest);
    expect(e).toEqual([
      'instances[1] (a): id "a" is used twice',
      'instances[2] (k.l): id "k.l" cannot contain a dot (parts are addressed instance.part)',
      'instances[3]: needs an id',
    ]);
  });
  test('part names: unknown, duplicated, dotted in viewer.json', () => {
    expect(validateScene(scene({ id: 'a', parts: ['box', 'hinge', 'box'] }), manifest)).toEqual([
      'instances[0] (a): unknown part "hinge" (viewer.json has box, lid, brick)',
      'instances[0] (a): parts lists a part twice',
    ]);
    const dotted = { ...manifest, parts: [{ name: 'a.b', call: 'x();' }] };
    expect(validateScene(scene(), dotted)[0]).toContain('part "a.b": a part name cannot contain a dot');
  });
  test('set and cross-folder use are refused as not supported yet', () => {
    const e = validateScene(scene({ id: 'k', use: '../knee', set: { arm_t: 1.3 } }), manifest);
    expect(e).toHaveLength(2);
    expect(e[0]).toContain('"set" (value overrides) is not supported yet');
    expect(e[1]).toContain('"use": "../knee": only "." (this model) is supported yet');
  });
  test('bad shapes', () => {
    const e = validateScene(scene({ id: 'a', at: [1, 2], rot: 'x', mirror: [1, 0, NaN], scale: -1, color: 'red', scratch: 1, pos: [0, 0, 0], parts: [] }), manifest);
    expect(e).toEqual([
      'instances[0] (a): parts must be a non-empty list of part names (leave it out for all of them)',
      'instances[0] (a): at must be [x, y, z] numbers',
      'instances[0] (a): rot must be [x, y, z] numbers',
      'instances[0] (a): mirror must be [x, y, z] numbers',
      'instances[0] (a): scale must be a positive number or [x, y, z] of them (flip with mirror, not a negative scale)',
      'instances[0] (a): color must be "#rrggbb"',
      'instances[0] (a): scratch must be true or false',
      'instances[0] (a): unknown field "pos" (an instance has id, use, parts, at, rot, scale, mirror, color, material, scratch)',
    ]);
    expect(validateScene({ version: 2, instances: {}, rev: 3 }, manifest)).toEqual([
      'version must be 1, not 2', 'unknown key "rev" (a scene has version and instances)', 'instances must be a list',
    ]);
    expect(validateScene([], manifest)).toEqual(['scene.json must be an object: { "version": 1, "instances": [...] }']);
  });
});

describe('resolution', () => {
  test('the default scene is one instance at identity, named after the folder', () => {
    expect(defaultScene('hinge_box')).toEqual({ version: 1, instances: [{ id: 'hinge_box' }] });
    expect(defaultScene('my.model').instances[0].id).toBe('my_model');
    const placed = resolveScene(defaultScene('m'), manifest);
    expect(placed.map((p) => p.path)).toEqual(['m.box', 'm.lid', 'm.brick']);
    expect(placed[0]).toEqual({ path: 'm.box', instance: 'm', part: 'box', call: 'box();', color: '#4682b4', material: null, group: null,
      reference: false, scratch: false, at: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], mirror: [0, 0, 0] });
    expect(placed[2].color).toBe('#999999');
  });
  test('parts subset in viewer.json order, colour and scale per instance, scratch left out on request', () => {
    const s = scene({ id: 'a', parts: ['lid', 'box'], color: '#112233', scale: 2 }, { id: 't', parts: ['box'], scratch: true, scale: [1, 2, 3] });
    const all = resolveScene(s as Scene, manifest);
    expect(all.map((p) => p.path)).toEqual(['a.box', 'a.lid', 't.box']);
    expect(all[0].color).toBe('#112233');
    expect(all[0].scale).toEqual([2, 2, 2]);
    expect(all[2].scale).toEqual([1, 2, 3]);
    expect(resolveScene(s as Scene, manifest, { scratch: false }).map((p) => p.path)).toEqual(['a.box', 'a.lid']);
  });
});

describe('edits', () => {
  const base = defaultScene('m');
  test('add, copy, move, set, remove', () => {
    let s = addInstance(base, 'b', { parts: ['box'], at: [10, 0, 0] });
    s = copyInstance(s, 'b', 'c', { mirror: [1, 0, 0] });
    s = moveInstance(s, 'c', [0, 0, 5]);
    s = moveInstance(s, 'm', [1, 1, 1]);
    s = setFields(s, 'b', { at: null, color: '#ffffff' });
    expect(s.instances).toEqual([
      { id: 'm', at: [1, 1, 1] },
      { id: 'b', parts: ['box'], color: '#ffffff' },
      { id: 'c', parts: ['box'], at: [10, 0, 5], mirror: [1, 0, 0] },
    ]);
    expect(removeInstance(s, 'b').instances.map((x) => x.id)).toEqual(['m', 'c']);
    expect(base.instances).toEqual([{ id: 'm' }]);   // edits do not touch their input
  });
  test('refusals', () => {
    expect(() => addInstance(base, 'm')).toThrow('there is already an instance "m"');
    expect(() => removeInstance(base, 'x')).toThrow('no instance "x" (the scene has m)');
    expect(() => setFields(base, 'm', { id: 'n' } as any)).toThrow(SceneError);
  });
  test('command-line fields', () => {
    expect(parseField('at=1,2.5,-3')).toEqual(['at', [1, 2.5, -3]]);
    expect(parseField('rot=[0, 0, 90]')).toEqual(['rot', [0, 0, 90]]);
    expect(parseField('scale=2')).toEqual(['scale', 2]);
    expect(parseField('parts=box,lid')).toEqual(['parts', ['box', 'lid']]);
    expect(parseField('scratch=true')).toEqual(['scratch', true]);
    expect(parseField('color=')).toEqual(['color', null]);
    expect(() => parseField('at=1,2')).toThrow('at wants x,y,z');
    expect(() => parseField('set=1')).toThrow('not supported yet');
    expect(() => parseField('pos=1,2,3')).toThrow('unknown field "pos"');
  });
});

describe('the file', () => {
  test('one instance per line, fields in one order', () => {
    const s = scene({ scratch: true, at: [1, 0, 0], id: 'b', parts: ['box', 'lid'] }, { id: 'a' }) as Scene;
    expect(formatScene(s)).toBe(
      '{\n  "version": 1,\n  "instances": [\n' +
      '    { "id": "b", "parts": ["box", "lid"], "at": [1, 0, 0], "scratch": true },\n' +
      '    { "id": "a" }\n  ]\n}\n');
    expect(JSON.parse(formatScene(s))).toEqual({ version: 1, instances: [{ id: 'b', parts: ['box', 'lid'], at: [1, 0, 0], scratch: true }, { id: 'a' }] });
    expect(formatScene({ version: 1, instances: [] })).toBe('{\n  "version": 1,\n  "instances": []\n}\n');
  });
  test('hash: of the text, none without a file', () => {
    expect(sceneHash(null)).toBe('none');
    expect(sceneHash('a')).toMatch(/^[0-9a-f]{16}$/);
    expect(sceneHash('a')).not.toBe(sceneHash('b'));
  });
});

describe('reading and writing through a host', () => {
  const setup = (sceneText?: string) => memHost({
    '/w/m/viewer.json': JSON.stringify(manifest), '/w/m/box.scad': 'module box() {}',
    ...(sceneText ? { '/w/m/scene.json': sceneText } : {}),
  });

  test('no file: the default scene, hash none', async () => {
    const { host } = setup();
    const st = await readScene(host, '/w/m');
    expect(st).toMatchObject({ hash: 'none', exists: false, errors: [], scene: { version: 1, instances: [{ id: 'm' }] } });
    expect(st.parts.map((p) => p.path)).toEqual(['m.box', 'm.lid', 'm.brick']);
  });
  test('a bad file reports errors and places nothing', async () => {
    const st = await readScene(setup('{ nope').host, '/w/m');
    expect(st.errors[0]).toStartWith('scene.json is not JSON');
    expect(st.parts).toEqual([]);
    const st2 = await readScene(setup('{"version":1,"instances":[{"id":"a","set":{}}]}').host, '/w/m');
    expect(st2.errors[0]).toContain('not supported yet');
  });
  test('a write names its base hash; a stale one is refused and nothing is written', async () => {
    const { host, files } = setup();
    const h1 = await writeScene(host, '/w/m', addInstance(defaultScene('m'), 'b'), 'none');
    expect(h1).toBe(sceneHash(new TextDecoder().decode(await files.read('/w/m/scene.json')!)));
    const h2 = (await editScene(host, '/w/m', (s) => moveInstance(s, 'b', [5, 0, 0]), h1)).hash;
    const before = new TextDecoder().decode(await files.read('/w/m/scene.json')!);
    const stale = await writeScene(host, '/w/m', defaultScene('m'), h1).catch((e) => e);
    expect(stale).toBeInstanceOf(StaleError);
    expect(stale.hash).toBe(h2);
    expect(await editScene(host, '/w/m', (s) => s, 'none').catch((e) => e)).toBeInstanceOf(StaleError);
    expect(new TextDecoder().decode(await files.read('/w/m/scene.json')!)).toBe(before);
  });
  test('an invalid scene is refused', async () => {
    const { host, files } = setup();
    const e = await writeScene(host, '/w/m', scene({ id: 'a.b' }) as Scene, 'none').catch((e) => e);
    expect(e).toBeInstanceOf(SceneError);
    expect(await files.read('/w/m/scene.json')).toBeNull();
  });
  test('_scene.scad: scratch left out unless asked for', async () => {
    const { host } = setup(formatScene(scene({ id: 'm' }, { id: 't', parts: ['box'], at: [9, 0, 0], scratch: true }) as Scene));
    expect((await writeSceneScad(host, '/w/m')).text).not.toContain('t.box');
    expect((await writeSceneScad(host, '/w/m', { scratch: true })).text).toContain('translate([9, 0, 0]) { box(); }   // t.box (scratch)');
  });
});

describe('generated OpenSCAD', () => {
  test('_scene.scad: module calls, identity steps left out, reference parts as %', () => {
    const s = scene({ id: 'm' }, { id: 'b', parts: ['box', 'brick'], at: [70, 0, 0], rot: [0, 0, 90], mirror: [1, 0, 0], scale: [1, 1, 2] }) as Scene;
    expect(sceneScad(manifest, resolveScene(s, manifest))).toBe([
      '// _scene.scad: generated from scene.json by `armenscad scene <model> scad`; edits here are lost.',
      'include <box.scad>',
      'show_all = false;',
      '',
      'box();   // m.box',
      'lid_at(lid_deg);   // m.lid',
      '%union() { brick(); }   // m.brick',
      'translate([70, 0, 0]) rotate([0, 0, 90]) mirror([1, 0, 0]) scale([1, 1, 2]) { box(); }   // b.box',
      '%translate([70, 0, 0]) rotate([0, 0, 90]) mirror([1, 0, 0]) scale([1, 1, 2]) { brick(); }   // b.brick',
      '',
    ].join('\n'));
  });
});
