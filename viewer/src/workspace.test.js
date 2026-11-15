import { expect, test } from 'bun:test';
import { workspaceTree, shortFor } from './workspace.js';

const m = (name, extra = {}) => ({ name, file: 'x.scad', ...extra });
const tree = workspaceTree([
  m('arcee_stand'),
  m('dev/hip'), m('dev/knee'),
  m('dev/legs'),
  m('dev/ports/thigh'), m('dev/ports/torso'),
  m('dev/robot', { file: null, assembly: true, uses: ['dev/hip', 'dev/knee', 'dev/toys/hook'] }),
  m('dev/toys/hook', { reference: true }),
  m('gi_joe/whale/hatch'), m('gi_joe/whale/shroud'),
  m('matx_case'), m('matx_case/modcase'),
]);
const by = Object.fromEntries(tree.map((p) => [p.name, p]));

test('projects are the top-level folders; one model alone is just that model', () => {
  expect(tree.map((p) => [p.name, p.count])).toEqual([['arcee_stand', 1], ['dev', 7], ['gi_joe', 2], ['matx_case', 2]]);
  expect(by.arcee_stand.single.name).toBe('arcee_stand');
  expect(by.dev.single).toBeNull();
});
test('assemblies first, then the rest in order; who uses what', () => {
  expect(by.dev.direct.map((x) => x.short)).toEqual(['robot', 'hip', 'knee', 'legs']);
  expect(by.dev.direct[1].usedBy).toEqual(['dev/robot']);
  expect(by.dev.direct[3].usedBy).toEqual([]);
});
test('subfolders are groups: folded beside direct models, open when they are all there is', () => {
  expect(by.dev.groups.map((g) => [g.name, g.path, g.models.map((x) => x.short), g.folded, g.reference])).toEqual([
    ['ports', 'dev/ports', ['thigh', 'torso'], true, false], ['toys', 'dev/toys', ['hook'], true, true]]);
  expect(by.dev.groups[1].models[0].usedBy).toEqual(['dev/robot']);
  expect(by.gi_joe.groups.map((g) => [g.name, g.folded])).toEqual([['whale', false]]);
  expect(by.matx_case.direct.map((x) => x.short)).toEqual(['matx_case', 'modcase']);
});
test('names inside a project drop the project', () => {
  expect(shortFor('dev/toys/hook', 'dev')).toBe('toys/hook');
  expect(shortFor('gi_joe/whale/shroud', 'dev')).toBe('gi_joe/whale/shroud');
});
