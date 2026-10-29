// Size: the axis-aligned bounding box of what is current — the selected part, the selected group, or every
// visible part — as a readout at the foot of the render and, when Box (on the left rail) is on, as a wire box in the scene with the three
// edge lengths labelled. The labels sit on the edges that meet at the box corner nearest the camera, so
// they stay in front. Recomputed after every rebuild, hide/show and selection change; re-projected on every
// camera move. `b` toggles the box; remembered per model.
import * as THREE from 'three';
import { MODEL } from './api.js';
import { scene, stage, bus, project, view } from './scene.js';
import { meshes, getSelection } from './parts.js';

const $ = (s) => document.querySelector(s);
const AXES = ['X', 'Y', 'Z'];
const COLORS = ['var(--axis-x)', 'var(--axis-y)', 'var(--axis-z)'];
const fmt = (v) => (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, '');

export const st = { on: localStorage.getItem(`box:${MODEL}`) === '1', box: new THREE.Box3(), target: '', empty: true };

const helper = new THREE.Box3Helper(st.box, 0xffd166);
helper.visible = false; helper.renderOrder = 2; scene.add(helper);
const labels = AXES.map((a, i) => {
  const d = document.createElement('div');
  d.className = 'dim-label'; d.style.color = COLORS[i]; d.hidden = true; stage.appendChild(d);
  return d;
});

// which meshes the box is of, and a name for the readout
function target() {
  const { part, group } = getSelection();
  if (part && meshes.has(part)) return { name: part, list: [meshes.get(part)] };
  const vis = [...meshes.values()].filter((m) => m.visible);
  if (group) {   // the shown members; if the whole group is hidden, measure it anyway
    const all = [...meshes.values()].filter((m) => m.userData.part.group === group);
    const shown = all.filter((m) => m.visible);
    return shown.length ? { name: `${group} (${shown.length} of ${all.length})`, list: shown } : { name: `${group} (hidden)`, list: all };
  }
  return { name: `all visible (${vis.length})`, list: vis };
}

export function update() {
  const t = target();
  st.box.makeEmpty();
  for (const m of t.list) { m.geometry.computeBoundingBox(); st.box.union(m.geometry.boundingBox); }   // parts have no transform
  st.empty = st.box.isEmpty(); st.target = t.name;
  const size = st.empty ? [0, 0, 0] : st.box.getSize(new THREE.Vector3()).toArray();
  $('#size-target').textContent = t.name;
  $('#size-rows').innerHTML = AXES.map((a, i) => `<div class="size-row" style="color:${COLORS[i]}"><span class="ax">${a}</span><b>${st.empty ? '–' : fmt(size[i])}</b><span class="muted">${st.empty ? '' : `${fmt(st.box.min.getComponent(i))} … ${fmt(st.box.max.getComponent(i))}`}</span></div>`).join('');
  helper.visible = st.on && !st.empty;
  place();
  bus.dispatchEvent(new Event('bounds'));     // grid.js checks the measured box against the printer
}

// labels at the midpoints of the three edges leaving the corner nearest the camera
function place() {
  const show = st.on && !st.empty;
  if (!show) { for (const l of labels) l.hidden = true; return; }
  const { min, max } = st.box;
  const cam = view.camera.position;
  let best = null, bestD = Infinity;
  for (let k = 0; k < 8; k++) {
    const c = new THREE.Vector3(k & 1 ? max.x : min.x, k & 2 ? max.y : min.y, k & 4 ? max.z : min.z);
    const d = c.distanceToSquared(cam);
    if (d < bestD) { bestD = d; best = c; }
  }
  const r = stage.getBoundingClientRect();
  AXES.forEach((a, i) => {
    const mid = best.clone(); mid.setComponent(i, (min.getComponent(i) + max.getComponent(i)) / 2);
    const p = project(mid);
    const l = labels[i];
    l.hidden = !p.inFront;
    l.textContent = `${a} ${fmt(max.getComponent(i) - min.getComponent(i))}`;
    l.style.left = p.u * r.width + 'px'; l.style.top = p.v * r.height + 'px';
  });
}

export function setBox(on) {
  st.on = on;
  localStorage.setItem(`box:${MODEL}`, on ? '1' : '0');
  bus.dispatchEvent(new Event('ui'));
  helper.visible = on && !st.empty;
  place();
}
export const toggleBox = () => setBox(!st.on);

for (const ev of ['parts', 'visibility', 'select']) bus.addEventListener(ev, update);
for (const ev of ['camera', 'resize']) bus.addEventListener(ev, place);

// for window.viewer: { target, size, min, max }
export const bounds = () => st.empty ? { target: st.target, size: null } : { target: st.target, size: st.box.getSize(new THREE.Vector3()).toArray(), min: st.box.min.toArray(), max: st.box.max.toArray() };
