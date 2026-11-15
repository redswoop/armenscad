import { describe, expect, test } from 'bun:test';
import {
  validateScene, defaultScene, resolveScene, formatScene, sceneHash, parseField,
  addInstance, copyInstance, moveInstance, removeInstance, setFields, splitInstance, freeId, placementMatrix, SceneError,
  readScene, writeScene, editScene, writeSceneScad, StaleError, sceneScad,
  type Manifest, type Scene,
} from './index.ts';
import { memHost } from './mem.ts';
import { placedMatrix, applyMatrix } from './placement.ts';

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
  test('set is refused as not supported yet; a use that names no folder says how to write one', () => {
    const e = validateScene(scene({ id: 'k', use: '../knee', set: { arm_t: 1.3 } }, { id: 'j', use: 7 }), manifest);
    expect(e).toHaveLength(3);
    expect(e[0]).toContain('"set" (value overrides) is not supported yet');
    expect(e[1]).toContain('"use": "../knee": not a folder beside this one');
    expect(e[2]).toContain('"use" must be a folder, relative to this one');
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
    expect(placed[0]).toEqual({ path: 'm.box', instance: 'm', part: 'box', component: '.', src: 'box', inner: null, call: 'box();', color: '#4682b4', material: null, group: null,
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

describe('split', () => {
  // every placed part's world matrix, by part name, for one resolved scene
  const where = (s: Scene) => Object.fromEntries(resolveScene(s, manifest).map((p) => [p.part, placementMatrix(p)]));
  const looks = { at: [12.5, -3, 40], rot: [0, 30, 90], mirror: [1, 0, 0], scale: [1, 2, 0.5], color: '#c8823a', material: 'petg', scratch: true };

  test('from an instance showing every part: the source gets a list of the others, in viewer.json order', () => {
    const before = scene({ id: 'm', ...looks }, { id: 'n' }) as Scene;
    const after = splitInstance(before, manifest, 'm', 'lid');
    expect(after.instances).toEqual([
      { id: 'm', ...looks, parts: ['box', 'brick'] },
      { id: 'lid', ...looks, parts: ['lid'] },
      { id: 'n' },
    ]);
    expect(before.instances[0]).toEqual({ id: 'm', ...looks });           // the input is untouched
    expect(validateScene(after, manifest)).toEqual([]);
    // the same parts at the same world placements, only under other paths
    expect(resolveScene(after, manifest).map((p) => p.path)).toEqual(['m.box', 'm.brick', 'lid.lid', 'n.box', 'n.lid', 'n.brick']);
    const was = resolveScene(before, manifest).filter((p) => p.instance === 'm'), now = resolveScene(after, manifest).filter((p) => p.instance !== 'n');
    expect(now.length).toBe(was.length);
    for (const p of was) {
      const q = now.find((x) => x.part === p.part)!;
      expect(placementMatrix(q)).toEqual(placementMatrix(p));
      expect({ ...q, path: '', instance: '' }).toEqual({ ...p, path: '', instance: '' });   // colour, material, scratch too
    }
  });
  test('from an instance with a parts list: that list loses the part, in its own order', () => {
    const before = scene({ id: 'a', parts: ['lid', 'brick', 'box'], at: [5, 0, 0] }) as Scene;
    const after = splitInstance(before, manifest, 'a', 'brick', 'held');
    expect(after.instances).toEqual([{ id: 'a', parts: ['lid', 'box'], at: [5, 0, 0] }, { id: 'held', parts: ['brick'], at: [5, 0, 0] }]);
    expect(where(after)).toEqual(where(before));
    expect(validateScene(after, manifest)).toEqual([]);
  });
  test('ids: the part name, then name_2, name_3; an id given is used or refused', () => {
    let s = defaultScene('m');
    s = splitInstance(s, manifest, 'm', 'lid');
    s = copyInstance(s, 'm', 'm2', { parts: null });
    s = splitInstance(s, manifest, 'm2', 'lid');
    s = copyInstance(s, 'm', 'm3', { parts: null });
    s = splitInstance(s, manifest, 'm3', 'lid');
    expect(s.instances.map((x) => x.id)).toEqual(['m', 'm3', 'lid_3', 'm2', 'lid_2', 'lid']);   // a copy goes after its source
    expect(validateScene(s, manifest)).toEqual([]);
    expect(freeId(s, 'lid')).toBe('lid_4');
    expect(freeId(s, 'box')).toBe('box');
    expect(freeId(s, 'odd name.v2')).toBe('odd_name_v2');
    expect(() => splitInstance(defaultScene('m'), manifest, 'm', 'box', 'm')).toThrow('there is already an instance "m"');
  });
  test('refusals: a one-part instance, a part it does not show, an unknown part or instance', () => {
    const s = scene({ id: 'a', parts: ['lid'] }, { id: 'b', parts: ['box', 'lid'] }) as Scene;
    expect(() => splitInstance(s, manifest, 'a', 'lid')).toThrow('a shows only "lid": nothing to split it from');
    expect(() => splitInstance(s, manifest, 'b', 'brick')).toThrow('b does not show "brick" (it shows box, lid)');
    expect(() => splitInstance(s, manifest, 'b', 'hinge')).toThrow('no part "hinge" (b has box, lid, brick)');
    expect(() => splitInstance(s, manifest, 'c', 'box')).toThrow('no instance "c" (the scene has a, b)');
    expect(() => splitInstance(s, manifest, 'a', 'lid')).toThrow(SceneError);
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
  test('split through editScene: the file is created from the default scene and validates', async () => {
    const { host } = setup();
    await editScene(host, '/w/m', (s) => splitInstance(s, manifest, 'm', 'lid'));
    const st = await readScene(host, '/w/m');
    expect(st.errors).toEqual([]);
    expect(st.scene!.instances).toEqual([{ id: 'm', parts: ['box', 'brick'] }, { id: 'lid', parts: ['lid'] }]);
    expect(st.parts.map((p) => p.path)).toEqual(['m.box', 'm.brick', 'lid.lid']);
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

// A toy with two leaf folders and two assemblies: leg uses knee twice and its own part; robot uses leg and a toy scan.
describe('other folders', () => {
  const knee = JSON.stringify({ file: 'knee.scad', parts: [{ name: 'thigh', call: 'thigh();', color: '#e8902a' }, { name: 'connector', call: 'connector();' }] });
  const world = (extra: Record<string, string> = {}) => memHost({
    '/w/knee/viewer.json': knee, '/w/knee/knee.scad': '',
    '/w/toys/hook/viewer.json': JSON.stringify({ file: 'hook.scad', parts: [{ name: 'hook', call: 'hook();', reference: true }] }),
    '/w/leg/viewer.json': JSON.stringify({ file: 'leg.scad', parts: [{ name: 'shin', call: 'shin();' }] }),
    '/w/leg/scene.json': JSON.stringify(scene({ id: 'shin' }, { id: 'knee', use: '../knee', at: [0, 0, 10], color: '#112233' },
      { id: 'spare', use: '../knee', parts: ['thigh'], at: [50, 0, 0], scratch: true })),
    '/w/robot/viewer.json': '{}',
    ...extra,
  });
  const robot = (...instances: any[]) => ({ '/w/robot/scene.json': JSON.stringify(scene(...instances)) });

  test('a folder with no scene.json offers its parts as drawn: instance.part, built there', async () => {
    const { host } = world(robot({ id: 'knee_L', use: '../knee', at: [16, 0, 0] }, { id: 'hook', use: '../toys/hook' }));
    const st = await readScene(host, '/w/robot');
    expect(st.errors).toEqual([]);
    expect(st.parts.map((p) => [p.path, p.component, p.src])).toEqual([
      ['knee_L.thigh', '../knee', '../knee/thigh'], ['knee_L.connector', '../knee', '../knee/connector'], ['hook.hook', '../toys/hook', '../toys/hook/hook']]);
    expect(st.parts[0]).toMatchObject({ at: [16, 0, 0], inner: null, color: '#e8902a', part: 'thigh' });
    expect(st.parts[2].reference).toBe(true);
    expect(st.offers).toEqual({ knee_L: ['thigh', 'connector'], hook: ['hook'] });
    expect(st.components).toEqual([{ rel: '../knee', dir: '/w/knee' }, { rel: '../toys/hook', dir: '/w/toys/hook' }]);
  });
  test('a folder with a scene.json offers what it places, scratch left out, under instance.inner.part', async () => {
    const { host } = world(robot({ id: 'leg_L', use: '../leg', at: [5, 0, 0], rot: [0, 0, 90] }));
    const st = await readScene(host, '/w/robot');
    expect(st.errors).toEqual([]);
    expect(st.parts.map((p) => [p.path, p.src])).toEqual([
      ['leg_L.shin.shin', '../leg/shin'], ['leg_L.knee.thigh', '../knee/thigh'], ['leg_L.knee.connector', '../knee/connector']]);
    // the knee's colour is the leg's choice; the robot's instance says none
    expect(st.parts[1].color).toBe('#112233');
    // where a point of the thigh ends up: up 10 in the leg, then turned a quarter about Z and moved 5 in the robot
    expect(applyMatrix(placedMatrix(st.parts[1]), [1, 0, 0])).toEqual([5, 1, 10]);
    expect(st.components.map((c) => c.rel)).toEqual(['../leg', '../knee']);
    expect(st.offers.leg_L).toEqual(['shin.shin', 'knee.thigh', 'knee.connector']);
  });
  test('parts picks from what the folder offers, and says what that is', async () => {
    const { host } = world(robot({ id: 'a', use: '../leg', parts: ['knee.thigh'] }, { id: 'b', use: '../knee', parts: ['shin'] }));
    const st = await readScene(host, '/w/robot');
    expect(st.errors).toEqual(['instances[1] (b): unknown part "shin" (../knee offers thigh, connector)']);
    const ok = await readScene(world(robot({ id: 'a', use: '../leg', parts: ['knee.thigh'] })).host, '/w/robot');
    expect(ok.parts.map((p) => p.path)).toEqual(['a.knee.thigh']);
  });
  test('a folder that cannot be used: missing, broken, or a loop', async () => {
    const { host } = world({
      ...robot({ id: 'a', use: '../nope' }, { id: 'b', use: '../bad' }, { id: 'c', use: '../loop' }),
      '/w/bad/viewer.json': '{}', '/w/bad/scene.json': JSON.stringify(scene({ id: 'x', parts: ['gone'] })),
      '/w/loop/viewer.json': '{}', '/w/loop/scene.json': JSON.stringify(scene({ id: 'r', use: '../robot' })),
    });
    const st = await readScene(host, '/w/robot');
    expect(st.errors).toEqual([
      'instances[0] (a): "use": "../nope": no viewer.json there',
      'instances[1] (b): "use": "../bad": its scene.json has an error: instances[0] (x): unknown part "gone" (viewer.json has no parts)',
      'instances[2] (c): "use": "../loop": its scene.json has an error: instances[0] (r): "use": "../robot": a loop: robot uses loop uses robot',
    ]);
    expect(st.parts).toEqual([]);
  });
  test('writes validate against the folders; split works on what an instance offers; _scene.scad says it cannot yet', async () => {
    const { host } = world();
    await editScene(host, '/w/robot', (s) => ({ ...s, instances: [{ id: 'k', use: '../knee' }] }));
    const bad = await editScene(host, '/w/robot', (s) => ({ ...s, instances: [{ id: 'k', use: '../nope' }] })).catch((e) => e);
    expect(bad).toBeInstanceOf(SceneError);
    const st = await readScene(host, '/w/robot');
    await editScene(host, '/w/robot', (s) => splitInstance(s, st.offers, 'k', 'thigh'));
    expect((await readScene(host, '/w/robot')).scene!.instances).toEqual([
      { id: 'k', use: '../knee', parts: ['connector'] }, { id: 'thigh', use: '../knee', parts: ['thigh'] }]);
    const e = await writeSceneScad(host, '/w/robot').catch((e) => e);
    expect(e.message).toContain('_scene.scad is not written yet for a scene that uses other folders (k, thigh)');
  });
});
