// The view cube, top right of the render (Shapr3D's orientation cube): a bevelled cube that turns with the
// camera. Its 6 faces, 12 bevelled edges and 8 corner facets are the 26 targets, each looking along the sum of
// the face normals it touches: a face gives the straight-on view, an edge an oblique one, a corner an iso one.
// Click one to orbit there (scene.orbitTo), drag the cube to orbit freely, double-click it for home. The arrows
// round it (shown on hover) turn the view 90°; the buttons under it: home (iso and fit), fit, ortho, zoom.
//
// It is a second, tiny WebGL renderer with its own scene and an orthographic camera that copies the main
// camera's rotation, redrawn only when the camera moves or the hover changes. Colours and the label face come
// from CSS tokens (--cube-face --cube-text --cube-edge --cube-hot --cube-font), so the skin dresses it; theme.js
// fires 'skin' on the bus when they change.
import * as THREE from 'three';
import { token, fontToken } from './tokens.js';
import { view, controls, bus, frameHooks, orbitTo, orbitBy, orbitDir, fit, setOrtho, isOrtho, zoomBy, VIEWS } from './scene.js';

const $ = (s) => document.querySelector(s);
const el = $('#cube');
const renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 20);

// n: outward normal; up: which way the label reads upright (sides: +Z; top: +Y so it reads from the front;
// bottom: -Y so it reads from below with the front at the bottom)
const FACES = [
  { n: [0, 0, 1], up: [0, 1, 0], label: 'TOP' }, { n: [0, 0, -1], up: [0, -1, 0], label: 'BOTTOM' },
  { n: [0, -1, 0], up: [0, 0, 1], label: 'FRONT' }, { n: [0, 1, 0], up: [0, 0, 1], label: 'BACK' },
  { n: [1, 0, 0], up: [0, 0, 1], label: 'RIGHT' }, { n: [-1, 0, 0], up: [0, 0, 1], label: 'LEFT' },
];
const K = 0.7;                     // a face is the square ±K; the bevels take the rest of the ±1 cube
const pieces = [], labels = [];    // pieces: the pickable faces, bevels and corners
function piece(pts, dir, kind) {
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  g.setIndex(pts.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2]);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  m.userData = { dir: dir.toArray(), key: dir.toArray().join(','), kind };
  pieces.push(m); scene.add(m);
}
const v3 = (...a) => new THREE.Vector3(...a);
for (const f of FACES) {
  const n = v3(...f.n), up = v3(...f.up), right = up.clone().cross(n);
  const at = (x, y) => n.clone().addScaledVector(right, x * K).addScaledVector(up, y * K);
  piece([at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)], n, 'face');
  const label = new THREE.Mesh(new THREE.PlaneGeometry(2 * K, 2 * K), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
  label.applyMatrix4(new THREE.Matrix4().makeBasis(right, up, n)); label.position.copy(n).multiplyScalar(1.002);
  label.userData.label = f.label; label.raycast = () => {};
  labels.push(label); scene.add(label);
}
for (let i = 0; i < 3; i++) for (const si of [-1, 1]) for (const sj of [-1, 1]) {     // edges: faces i and j meet, running along k
  const j = (i + 1) % 3, k = (i + 2) % 3;
  const pt = (a, b, c) => { const p = v3(); p.setComponent(i, a); p.setComponent(j, b); p.setComponent(k, c); return p; };
  piece([pt(si, sj * K, -K), pt(si, sj * K, K), pt(si * K, sj, K), pt(si * K, sj, -K)], pt(si, sj, 0), 'edge');
}
for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
  piece([v3(sx, sy * K, sz * K), v3(sx * K, sy, sz * K), v3(sx * K, sy * K, sz)], v3(sx, sy, sz), 'corner');
// crisp seams between the pieces
const seams = new THREE.LineSegments(new THREE.EdgesGeometry(soup(), 1), new THREE.LineBasicMaterial());
scene.add(seams);
function soup() {         // every piece's triangles in one geometry, so EdgesGeometry finds the creases between them
  const pos = [];
  for (const m of pieces) { const p = m.geometry.attributes.position, idx = m.geometry.index.array; for (const t of idx) pos.push(p.getX(t), p.getY(t), p.getZ(t)); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// ---------- the skin's colours ----------
const colors = { face: 0, edge: 0, corner: 0, hot: 0 };
function dress() {
  const face = token('--cube-face', '#262a33'), edge = token('--cube-edge', '#6ea8fe'), text = token('--cube-text', '#d8dbe2'), font = fontToken('--cube-font', 'system-ui');
  const fc = new THREE.Color(face.hex);
  colors.face = face.hex;
  colors.edge = fc.clone().lerp(new THREE.Color(edge.hex), 0.28).getHex();
  colors.corner = fc.clone().lerp(new THREE.Color(edge.hex), 0.45).getHex();
  colors.hot = token('--cube-hot', '#6ea8fe').hex;
  seams.material.color.setHex(edge.hex);
  for (const l of labels) {
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d');
    g.fillStyle = text.css; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${l.userData.label.length > 5 ? 50 : 60}px ${font}`;
    g.fillText(l.userData.label, S / 2, S / 2 + 3, S - 16);
    l.material.map?.dispose();
    l.material.map = new THREE.CanvasTexture(cv); l.material.map.colorSpace = THREE.SRGBColorSpace; l.material.map.anisotropy = 4;
    l.material.needsUpdate = true;
  }
  dirty = true;
}
bus.addEventListener('skin', dress);
document.fonts?.ready.then(dress);
document.fonts?.addEventListener('loadingdone', dress);

// ---------- drawing ----------
let dirty = true, hover = null;
function size() {
  const w = el.clientWidth, h = el.clientHeight;
  if (w && h) renderer.setSize(w, h, false);
  dirty = true;
}
new ResizeObserver(size).observe(el);
bus.addEventListener('camera', () => { dirty = true; });
frameHooks.add(() => {
  if (!dirty) return;
  dirty = false;
  const off = view.camera.position.clone().sub(controls.target).normalize();
  cam.position.copy(off).multiplyScalar(5); cam.quaternion.copy(view.camera.quaternion);
  for (const m of pieces) m.material.color.setHex(m.userData.key === hover ? colors.hot : colors[m.userData.kind]);
  renderer.render(scene, cam);
});

// ---------- pointer ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function cellAt(ev) {
  const r = el.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, 1 - ((ev.clientY - r.top) / r.height) * 2);
  ray.setFromCamera(ndc, cam);
  return ray.intersectObjects(pieces, false)[0]?.object ?? null;
}
let press = null;
el.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  press = { x: ev.clientX, y: ev.clientY, lx: ev.clientX, ly: ev.clientY, moved: false };
  el.setPointerCapture(ev.pointerId);
});
el.addEventListener('pointermove', (ev) => {
  if (press) {
    if (Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 3) press.moved = true;
    if (press.moved) { orbitBy(-(ev.clientX - press.lx) * 0.012, -(ev.clientY - press.ly) * 0.012); el.style.cursor = 'grabbing'; }
    press.lx = ev.clientX; press.ly = ev.clientY;
    return;
  }
  const key = cellAt(ev)?.userData.key ?? null;
  el.style.cursor = key ? 'pointer' : 'grab';
  if (key !== hover) { hover = key; dirty = true; }
});
el.addEventListener('pointerup', (ev) => {
  if (!press) return;
  const click = !press.moved; press = null; el.style.cursor = '';
  try { el.releasePointerCapture(ev.pointerId); } catch {}
  if (!click) { controls.dispatchEvent({ type: 'end' }); return; }
  const c = cellAt(ev);
  if (c) orbitTo(c.userData.dir);
});
el.addEventListener('pointerleave', () => { if (!press && hover) { hover = null; dirty = true; } });
el.addEventListener('dblclick', () => home());

// ---------- the buttons under it ----------
export const home = () => orbitTo(VIEWS.iso, { fit: true });
$('#home').onclick = home;
$('#fit').onclick = () => fit();
$('#ortho').onclick = () => setOrtho(!isOrtho());
$('#zoom-in').onclick = () => zoomBy(0.8);
$('#zoom-out').onclick = () => zoomBy(1.25);
// the arrows: 90° about the vertical (left / right) or over the top (up / down)
const QUARTER = Math.PI / 2;
const ROT = { left: [QUARTER, 0], right: [-QUARTER, 0], up: [0, QUARTER], down: [0, -QUARTER] };
for (const b of document.querySelectorAll('#cube-wrap [data-rot]')) b.onclick = () => orbitTo(orbitDir(...ROT[b.dataset.rot]));

dress();
