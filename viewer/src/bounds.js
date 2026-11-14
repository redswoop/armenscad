// Size: the axis-aligned bounding box of what is current — the selected part, the selected group, or every
// visible part — as a readout at the foot of the render (its triangle count, and its build time with each build
// counted once) and, when Box (on the left rail) is on, as a wire box in the scene with the three
// edge lengths labelled. The labels sit on the edges that meet at the box corner nearest the camera, so
// they stay in front. Recomputed after every rebuild, placement, hide/show and selection change; re-projected on every
// camera move. `b` toggles the box; remembered per model.
import * as THREE from 'three';
import { MODEL } from './api.js';
import { scene, stage, bus, project, view } from './scene.js';
import { meshes, getSelection, groupMembers, labelOf } from './parts.js';

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
  if (part && meshes.has(part)) return { name: labelOf(part), list: [meshes.get(part)] };
  const vis = [...meshes.values()].filter((m) => m.visible);
  if (group) {   // the shown members; if the whole group is hidden, measure it anyway
    const all = groupMembers(group).map((n) => meshes.get(n)).filter(Boolean);
    const shown = all.filter((m) => m.visible);
    return shown.length ? { name: `${group} (${shown.length} of ${all.length})`, list: shown } : { name: `${group} (hidden)`, list: all };
  }
  return { name: `all visible (${vis.length})`, list: vis };
}

export function update() {
  const t = target();
  st.box.makeEmpty();
  for (const m of t.list) st.box.union(worldBox(m));
  st.empty = st.box.isEmpty(); st.target = t.name;
  const size = st.empty ? [0, 0, 0] : st.box.getSize(new THREE.Vector3()).toArray();
  $('#size-target').textContent = t.name;
  const parts = t.list.map((m) => m.userData.part).filter(Boolean);
  const tris = parts.reduce((n, p) => n + (p.tris ?? 0), 0);
  // the time: each build once (instances of one part, parts with one harness share it), as long as it took even
  // when it came from the cache; null for a cache entry from before build times were kept
  const builds = new Map(parts.map((p) => [p.key ?? p.name, p.ms]));
  const known = [...builds.values()].filter((v) => v != null), ms = known.reduce((n, v) => n + v, 0);
  const time = known.length ? `${ms.toLocaleString()} ms` : '';
  $('#size-stats').textContent = parts.length ? `${tris.toLocaleString()} △${time ? ` · ${time}` : ''}` : '';
  $('#size-stats').title = `${tris.toLocaleString()} triangles; ${builds.size} build${builds.size === 1 ? '' : 's'}` +
    (known.length ? `, ${time} in OpenSCAD${known.length < builds.size ? ` (${builds.size - known.length} without a recorded time)` : ''}` : ', build time not recorded');
  $('#size-rows').innerHTML = AXES.map((a, i) => `<div class="size-row" style="color:${COLORS[i]}"><span class="ax">${a}</span><b>${st.empty ? '–' : fmt(size[i])}</b><span class="muted">${st.empty ? '' : `${fmt(st.box.min.getComponent(i))} … ${fmt(st.box.max.getComponent(i))}`}</span></div>`).join('');
  helper.visible = st.on && !st.empty;
  place();
  bus.dispatchEvent(new Event('bounds'));     // grid.js checks the measured box against the printer
}

// A placed part's box in world mm, exact: its STL's box through the placement when that only moves, scales,
// mirrors or turns by quarter turns (axes stay axes), else every vertex through it (a box of the turned box would
// be bigger than the part). Cached until the geometry or the placement changes.
const v = new THREE.Vector3();
function worldBox(m) {
  const key = m.matrixWorld.elements.join(','), c = m.userData.worldBox;
  if (c?.geo === m.geometry && c.key === key) return c.box;
  const geo = m.geometry, e = m.matrixWorld.elements, box = new THREE.Box3();
  if (!geo.boundingBox) geo.computeBoundingBox();
  const axial = [0, 4, 8].every((k) => [e[k], e[k + 1], e[k + 2]].filter((x) => Math.abs(x) > 1e-12).length === 1);
  if (axial) box.copy(geo.boundingBox).applyMatrix4(m.matrixWorld);
  else {
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
  }
  m.userData.worldBox = { geo, key, box };
  return box;
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

for (const ev of ['parts', 'placed', 'visibility', 'select']) bus.addEventListener(ev, update);
for (const ev of ['camera', 'resize']) bus.addEventListener(ev, place);

// for window.viewer: { target, size, min, max }
export const bounds = () => st.empty ? { target: st.target, size: null } : { target: st.target, size: st.box.getSize(new THREE.Vector3()).toArray(), min: st.box.min.toArray(), max: st.box.max.toArray() };
