// Move / Rotate: the light-pipe gizmo (gizmo.js, look 'pipe' as approved in the lab) on the selected instance, after
// Shapr3D's Move/Rotate tool: selecting a body brings the gizmo up; m hides or shows it.
//
//   rods      drag along X, Y or Z
//   rings     turn about X, Y or Z, about the instance's visual centre (the middle of its parts' box, in its own
//             frame, so it stays put as it turns); turnAbout (core/transform.ts) folds the difference into at, so
//             scene.json keeps OpenSCAD's translate(at) rotate(rot) form
//   orb       drag in the XY plane (the dashed ring shows that plane)
// Snap: a move goes in the ruler's step (1, 2 or 5 x 10^n mm, at least 8 px on screen at the gizmo; the trace's ticks
// are that step), a turn in 15°; alt held is free (0.1 mm, 0.1°). Saved at to 0.01 mm, rot to 0.1°; a field that
// comes back to zero is cleared. Live while dragging (parts.js previewInstance), one save on release (edits.js, one
// undo step); Esc mid-drag puts it back.
//
// gizmo.js draws one slide axis and rings about two in-plane axes per Gizmo, so three of them share the centre,
// turned so their slide axes are X, Y and Z; the second one's second ring turns about Z. Only the first keeps its
// plane marker (the XY plane its orb moves in).
//
// With the other tools: picking the gizmo comes first (pointer events in the capture phase on the stage, before the
// section gizmo's and the part picker's on the canvas, and before OrbitControls); anywhere else the camera, the
// part picker and the section gizmo get the pointer as before. A drawing tool (annotate) or the section's plane
// picker hides the gizmo and leaves the pointer alone.
import * as THREE from 'three';
import { Gizmo } from './gizmo.js';
import { scene, stage, canvas, view, controls, bus, frameHooks, toNDC, canvasSize } from './scene.js';
import { meshes, previewInstance, setScene, sceneState } from './parts.js';
import { token } from './tokens.js';
import { turnAbout, moveBy, niceStep, snap } from '../../core/transform.ts';
import { history, selectedInstance, instanceData, sceneOk, say } from './edits.js';
import { getTool } from './annotate.js';
import { sectionUI } from './section.js';
import './move.css';

const $ = (s) => document.querySelector(s);
const PX = 128;            // ring radius on screen; the lab's light pipe read best at 128-192 (64 makes its rims sub-pixel)
const TURN = 15;           // degrees per snapped step
const AX = 'XYZ';
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const frame = (x, y, z) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
const GIZMOS = [
  { handles: ['move', 'slide', 'turnX', 'turnY'], q: new THREE.Quaternion(),
    act: { move: { kind: 'plane' }, slide: { kind: 'move', axis: 2 }, turnX: { kind: 'turn', axis: 0 }, turnY: { kind: 'turn', axis: 1 } } },
  { handles: ['slide', 'turnY'], q: frame(V(0, 1, 0), V(0, 0, 1), V(1, 0, 0)),          // local z = X, local y = Z
    act: { slide: { kind: 'move', axis: 0 }, turnY: { kind: 'turn', axis: 2 } } },
  { handles: ['slide'], q: frame(V(0, 0, 1), V(1, 0, 0), V(0, 1, 0)),                   // local z = Y
    act: { slide: { kind: 'move', axis: 1 } } },
].map((d, i) => {
  const g = new Gizmo({ handles: d.handles, px: PX, look: 'pipe' });
  if (i) for (const m of g.marker ?? []) m.visible = false;
  g.visible = false; scene.add(g.object);
  return { ...d, g };
});
function paint() {
  for (const { g } of GIZMOS) g.setColors(token('--live', '#00e5ff').hex, {}, token('--gizmo-accent', '#9a5cff').hex);
}
bus.addEventListener('skin', paint); paint();

// ---------- state ----------
let on = true;
try { on = localStorage.getItem('armenscad.move') !== '0'; } catch {}
let drag = null;           // { id, d, handle, act, p0, pivot, pos0, pos, step, fields, last }
export const moveUI = () => ({ on, dragging: !!drag });
export function toggleMove(v = !on) {
  on = v; try { localStorage.setItem('armenscad.move', on ? '1' : '0'); } catch {}
  bus.dispatchEvent(new Event('ui'));
}
// the drag in progress, for the panel's live numbers: { id, fields } or null
export const dragPreview = () => (drag?.fields ? { id: drag.id, fields: drag.fields } : null);
// where the gizmo is ({ centre: world mm, scale: mm per gizmo unit }), or null when hidden: for tests and debugging
export const gizmoAt = () => (GIZMOS[0].g.visible ? { centre: GIZMOS[0].g.body.position.toArray(), scale: GIZMOS[0].g.scale } : null);

const blocked = () => getTool() !== 'select' || sectionUI().picking;
// the instance the gizmo is on, or null when it is hidden
function target() {
  if (!on || blocked() || !sceneOk()) return null;
  const id = selectedInstance();
  if (!id || !instanceData(id)) return null;
  return [...meshes.values()].some((m) => m.userData.placed?.instance === id && m.visible) ? id : null;
}
// the instance's visual centre: the middle of its parts' box in its own frame (every part shares the placement),
// then placed; a turn about it leaves it where it is
function centre(id) {
  const box = new THREE.Box3(); let m0 = null;
  for (const m of meshes.values()) {
    if (m.userData.placed?.instance !== id || !m.userData.part?.ok) continue;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    box.union(m.geometry.boundingBox); m0 = m;
  }
  if (!m0 || box.isEmpty()) return null;
  return box.getCenter(new THREE.Vector3()).applyMatrix4(m0.matrixWorld);
}
const placedOf = (id) => [...meshes.values()].find((m) => m.userData.placed?.instance === id)?.userData.placed;

frameHooks.add(() => {
  const id = drag ? drag.id : target();
  const pos = drag ? drag.pos : id && centre(id);
  const show = !!pos;
  for (const { g } of GIZMOS) g.visible = show;
  if (!show) return;
  const [w, h] = canvasSize();
  for (const { g, q } of GIZMOS) { g.place(pos, q); g.update(view.camera, w, h); }
});

// ---------- picking ----------
const ray = new THREE.Raycaster(); ray.layers.enableAll();
function handleAt(ndc) {
  if (!GIZMOS[0].g.visible) return null;
  ray.setFromCamera(ndc, view.camera);
  // the nearest, except that the orb wins wherever it is under the pointer: the rods' pick cylinders run through it
  const hits = ray.intersectObjects(GIZMOS.flatMap((d) => d.g.picks), false);
  const hit = hits.find((h) => h.object.userData.handle === 'move') ?? hits[0];
  if (!hit) return null;
  const d = GIZMOS.find((x) => x.g.picks.includes(hit.object));
  return { d, handle: hit.object.userData.handle, act: d.act[hit.object.userData.handle] };
}
const what = (a) => (a.kind === 'plane' ? 'move in the XY plane' : a.kind === 'move' ? `move along ${AX[a.axis]}` : `turn about ${AX[a.axis]}`);
const HINT = 'alt: free';

// ---------- the readout beside the pointer ----------
const label = document.createElement('div'); label.id = 'move-label'; label.hidden = true; stage.appendChild(label);
function showLabel(ev, text) {
  const r = stage.getBoundingClientRect();
  label.hidden = false; label.textContent = text;
  label.style.left = ev.clientX - r.left + 16 + 'px'; label.style.top = ev.clientY - r.top - 34 + 'px';
}
const sgn = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±');
const num = (v, d) => `${sgn(v)}${Math.abs(v).toFixed(d)}`;
const dec = (step) => Math.max(0, -Math.floor(Math.log10(step) + 1e-9));

// ---------- gestures ----------
let hover = null;
function setHover(h) {
  for (const { g } of GIZMOS) g.hover = h && h.d.g === g ? h.handle : null;
  hover = h;
}
stage.addEventListener('pointerdown', (ev) => {
  if (drag || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.target !== canvas || blocked()) return;
  const id = target(); if (!id) return;
  const ndc = toNDC(ev).clone(), h = handleAt(ndc);
  if (!h || !h.d.g.begin(h.handle, ndc, view.camera)) return;
  ev.stopPropagation(); ev.preventDefault();
  try { stage.setPointerCapture(ev.pointerId); } catch {}
  controls.enabled = false;
  const pl = placedOf(id), pos0 = h.d.g.body.position.clone();
  drag = { id, ...h, p0: { at: [...pl.at], rot: [...pl.rot], mirror: [...pl.mirror], scale: [...pl.scale] }, pivot: pos0.toArray(),
           pos0, pos: pos0.clone(), step: niceStep(h.d.g.mmPerPixel(view.camera, canvasSize()[1])), fields: null, last: ev };
  for (const { g } of GIZMOS) if (g !== h.d.g) g.active = '-';        // the others dim while one drags
  canvas.style.cursor = 'grabbing'; $('#tip').hidden = true;
}, { capture: true });

stage.addEventListener('pointermove', (ev) => {
  if (drag) { ev.stopPropagation(); drag.last = ev; follow(ev); return; }
  if (ev.buttons || ev.target !== canvas || blocked()) { if (hover) setHover(null); return; }
  const h = target() ? handleAt(toNDC(ev)) : null;
  const was = hover; setHover(h);
  if (h) {
    ev.stopPropagation();            // ours: the part picker would restyle the cursor and its tip
    canvas.style.cursor = h.act.kind === 'plane' ? 'move' : 'grab';
    const tip = $('#tip'); tip.hidden = false; tip.textContent = `${what(h.act)} · ${HINT}`;
    tip.style.left = ev.offsetX + 14 + 'px'; tip.style.top = ev.offsetY + 14 + 'px';
  } else if (was) { canvas.style.cursor = ''; $('#tip').hidden = true; }
}, { capture: true });

// the placement for the pointer now: snapped, rounded, previewed
function follow(ev) {
  const { g } = drag.d, alt = ev.altKey, [, H] = canvasSize();
  const r = g.move(toNDC(ev).clone(), view.camera, { alt: true }, H);      // 0.1 mm / 0.1°: the snapping is ours
  if (!r) return;
  const a = drag.act, p0 = drag.p0, step = alt ? 0.1 : drag.step;
  let fields, text, trace;
  if (a.kind === 'move') {
    const t = snap(r.t, step), by = [0, 0, 0]; by[a.axis] = t;
    fields = { at: moveBy(p0, by) }; trace = { ...r, t };
    drag.pos.copy(drag.pos0).setComponent(a.axis, drag.pos0.getComponent(a.axis) + t);
    text = `${AX[a.axis]} ${num(t, dec(step))} mm`;
  } else if (a.kind === 'plane') {
    const du = snap(r.du, step), dv = snap(r.dv, step);
    fields = { at: moveBy(p0, [du, dv, 0]) }; trace = { ...r, du, dv };
    drag.pos.copy(drag.pos0).add(V(du, dv, 0));
    text = `X ${num(du, dec(step))}  Y ${num(dv, dec(step))} mm`;
  } else {
    // the pointer's angle is -180..180 from the grab; keep it continuous with the last one, so a turn goes on past a half
    const raw = r.deg + 360 * Math.round(((drag.raw ?? 0) - r.deg) / 360); drag.raw = raw;
    const deg = alt ? raw : snap(raw, TURN);
    fields = turnAbout(p0, a.axis, deg, drag.pivot); trace = { ...r, deg };
    text = `${AX[a.axis]} ${num(deg, alt ? 1 : 0)}°`;
  }
  g.drawTrace(trace, view.camera, H);
  drag.fields = fields;
  previewInstance(drag.id, fields);
  showLabel(ev, `${text}${alt ? '  free' : ''}`);
}

const same3 = (a, b) => a.every((v, i) => v === b[i]);
async function finish(commit) {
  const d = drag; if (!d) return;
  drag = null; controls.enabled = true; label.hidden = true; canvas.style.cursor = '';
  for (const { g } of GIZMOS) { g.end(); g.active = null; }
  if (!commit || !d.fields || Object.entries(d.fields).every(([k, v]) => same3(v, d.p0[k]))) {
    previewInstance(d.id, { at: d.p0.at, rot: d.p0.rot });
    bus.dispatchEvent(new Event('placed'));
    return;
  }
  // a field back at zero is left out of scene.json
  const fields = Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, v.every((x) => x === 0) ? null : v]));
  const r = await history.setFields(d.id, fields, `${what(d.act).replace(/^move in the XY plane/, 'move in XY')} ${d.id}`);
  if (!r.ok) { say(`${d.id}: not saved: ${r.error}`, true); setScene(sceneState()); }
}
const up = (ev) => {
  if (!drag) return;
  ev.stopPropagation();
  try { stage.releasePointerCapture(ev.pointerId); } catch {}
  finish(ev.type === 'pointerup');
};
stage.addEventListener('pointerup', up, { capture: true });
stage.addEventListener('pointercancel', up, { capture: true });

// Esc mid-drag puts the instance back; alt pressed or let go mid-drag re-snaps at once
addEventListener('keydown', (e) => {
  if (!drag) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(false); return; }
  if (e.key === 'Alt') { e.preventDefault(); follow({ clientX: drag.last.clientX, clientY: drag.last.clientY, altKey: true }); }
}, { capture: true });
addEventListener('keyup', (e) => {
  if (drag && e.key === 'Alt') follow({ clientX: drag.last.clientX, clientY: drag.last.clientY, altKey: false });
}, { capture: true });
