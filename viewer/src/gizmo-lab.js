// The gizmo lab (gizmo.html): three looks of src/gizmo.js side by side over a real model, to pick one by eye.
// One camera and one section plane are shared; each cell (side by side, or 2x2 for four) renders the model plus
// its own gizmo (three layers).
import '@redswoop/cyberdos/web/cyber.css';
import './gizmo-lab.css';
import { DEFAULT_PALETTE, GOOGLE_FONTS_URL, applyPalette, setSkin, mix } from '@redswoop/cyberdos/web';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { Gizmo } from './gizmo.js';
import { token } from './tokens.js';

const $ = (s) => document.querySelector(s);
const MODEL = new URLSearchParams(location.search).get('model') ?? 'bones';
const LOOKS = [
  { id: 'pipe', name: 'E1 · light pipe', note: 'as it was: cyan and violet glass, full glow' },
  { id: 'pipe', name: 'E2 · a touch crisper', note: 'E1 with the glow and halo cut back' },
  { id: 'pipe', name: 'E3 · axis edges', note: 'E2 with each axis colour on its lit edges only', axisEdges: true },
];

// ---------- skin ----------
setSkin(true); applyPalette(DEFAULT_PALETTE.stock ? {} : DEFAULT_PALETTE.colors);
document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: GOOGLE_FONTS_URL }));
const pal = DEFAULT_PALETTE.colors;

// ---------- the stage ----------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.max(2, Math.min(devicePixelRatio, 2))); renderer.localClippingEnabled = true; renderer.setScissorTest(true);
const scene = new THREE.Scene();
scene.background = new THREE.Color(pal.bg);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
camera.up.set(0, 0, 1); camera.position.set(120, -140, 90);
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true;
const grid = new THREE.GridHelper(200, 20, new THREE.Color(mix(pal.bg, pal.chrome, 0.4)), new THREE.Color(mix(pal.bg, pal.chrome, 0.16)));
grid.rotation.x = Math.PI / 2; scene.add(grid);
scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(80, -60, 120); scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-80, 60, -40); scene.add(fill);

// the section: the plane through `pivot` with normal = the frame's z; the frame's x, y lie in it
const sec = { pivot: new THREE.Vector3(), quat: new THREE.Quaternion() };
const plane = new THREE.Plane();
const syncPlane = () => plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1).applyQuaternion(sec.quat), sec.pivot);

// ---------- the model: each part twice, its outside lit and its inside a dark tint, so the cut reads solid ----------
const parts = new THREE.Group(); scene.add(parts);
const byName = new Map();
const state = await fetch(`/api/${MODEL}/state`).then((r) => r.json());
const loader = new STLLoader();
await Promise.all(state.parts.filter((p) => p.ok && !p.empty).map(async (p) => {
  const geo = await loader.loadAsync(`/api/${MODEL}/parts/${p.name}.stl?v=${p.version}`); geo.computeVertexNormals();
  const out = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.55, metalness: 0.05, clippingPlanes: [plane] }));
  const inside = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color).multiplyScalar(0.35), side: THREE.BackSide, clippingPlanes: [plane] }));
  parts.add(out, inside); byName.set(p.name, out);
}));
// frame the first part, cut through its middle, tilted a little so both dials read as dials
const first = new THREE.Box3().setFromObject(byName.get(state.parts.find((p) => byName.has(p.name)).name)), centre = first.getCenter(new THREE.Vector3());
const span = Math.max(first.getSize(new THREE.Vector3()).length(), 20);
controls.target.copy(centre); camera.position.copy(centre).add(new THREE.Vector3(0.8, -1, 0.55).multiplyScalar(span * 1.2));
sec.pivot.copy(centre);
sec.quat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0)))
  .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(-25)));
syncPlane();

// ---------- the gizmos, one per look, each on its own layer ----------
// stand-ins for a themed red, green, blue (the CyberDOS 16-colour palette, when it exists); x, y, z as in CAD
const [ax, ay, az] = [0xff7a93, 0x7cf2b8, 0x7fa6ff];      // lighter and softer than raw RGB: lit, not painted
const gizmos = LOOKS.map((l, i) => {
  const g = new Gizmo({ look: l.id, layer: i + 1, crisp: i > 0, axisEdges: !!l.axisEdges });
  g.setColors(token('--live', '#00e5ff').hex, { slide: ax, turnX: ay, turnY: az, move: token('--text', '#ddd').hex }, 0x9a5cff);
  scene.add(g.object);
  return g;
});
const cols = $('#cols');
const gridCss = () => { cols.style.gridTemplate = solo === null ? `repeat(${GRID[1]}, 1fr) / repeat(${GRID[0]}, 1fr)` : '1fr / 1fr'; };
LOOKS.forEach((l, i) => {
  const d = document.createElement('div'); d.innerHTML = `<b>${l.name}<span>${l.note}</span></b>`;
  d.querySelector('b').onclick = () => setSolo(solo === i ? null : i);
  cols.append(d);
});
let solo = null;
function setSolo(i) {
  solo = i; gridCss();
  [...cols.children].forEach((c, j) => { c.style.display = i === null || i === j ? '' : 'none'; });
}
addEventListener('keydown', (e) => {
  if (e.key >= '1' && e.key <= String(LOOKS.length)) setSolo(+e.key - 1);
  if (e.key === '0') setSolo(null);
  if (e.key === '=' || e.key === '+' || e.key === '-') for (const g of gizmos) g.px = Math.max(32, Math.min(240, g.px + (e.key === '-' ? -16 : 16)));
});

// the cells on screen: [{ i, x, y, w, h }] in CSS px, y from the top; one cell when soloed, a row of up to
// three, else 2x2
const GRID = LOOKS.length <= 3 ? [LOOKS.length, 1] : [2, 2];
gridCss();
const columns = () => {
  const W = innerWidth, H = innerHeight, [nx, ny] = GRID;
  if (solo !== null) return [{ i: solo, x: 0, y: 0, w: W, h: H }];
  return LOOKS.map((_, i) => ({ i, x: (i % nx) * W / nx, y: Math.floor(i / nx) * H / ny, w: W / nx, h: H / ny }));
};
const ndcIn = (c, ev) => new THREE.Vector2(((ev.clientX - c.x) / c.w) * 2 - 1, -((ev.clientY - c.y) / c.h) * 2 + 1);
function colAt(ev) {
  const c = columns().find((c) => ev.clientX >= c.x && ev.clientX < c.x + c.w && ev.clientY >= c.y && ev.clientY < c.y + c.h);
  return c && { ...c, ndc: ndcIn(c, ev) };
}

// ---------- gestures ----------
let drag = null;     // { g, col, p0, q0 }
const val = $('#val');
canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  const c = colAt(ev); if (!c) return;
  const g = gizmos[c.i], h = g.pick(c.ndc, camAt(c));
  if (!h || !g.begin(h, c.ndc, camAt(c))) return;
  ev.stopImmediatePropagation(); controls.enabled = false; canvas.setPointerCapture(ev.pointerId);
  drag = { g, col: c, p0: sec.pivot.clone(), q0: sec.quat.clone() };
  for (const o of gizmos) if (o !== g) { o.active = h; }      // the others light the same handle
}, true);
canvas.addEventListener('pointermove', (ev) => {
  if (drag) {
    ev.stopImmediatePropagation();
    const c = { ...drag.col, ndc: ndcIn(drag.col, ev) };
    const r = drag.g.move(c.ndc, camAt(c), { alt: ev.altKey, ctrl: ev.ctrlKey }, c.h); if (!r) return;
    const d = drag.g.drag;
    if (r.handle === 'slide') sec.pivot.copy(drag.p0).addScaledVector(d.z, r.t);
    else if (r.handle === 'move') sec.pivot.copy(drag.p0).addScaledVector(d.x, r.du).addScaledVector(d.y, r.dv);
    else sec.quat.copy(new THREE.Quaternion().setFromAxisAngle(r.axis, THREE.MathUtils.degToRad(r.deg)).multiply(drag.q0));
    syncPlane();
    val.hidden = false; val.textContent = r.text; val.style.left = ev.clientX + 16 + 'px'; val.style.top = ev.clientY - 30 + 'px';
    return;
  }
  if (ev.buttons) return;
  const c = colAt(ev);
  for (const [i, g] of gizmos.entries()) g.hover = c && c.i === i ? g.pick(c.ndc, camAt(c)) : null;
  canvas.style.cursor = c && gizmos[c.i].hover ? (gizmos[c.i].hover === 'move' ? 'move' : 'grab') : '';
}, true);
const end = () => {
  if (!drag) return;
  for (const g of gizmos) { g.end(); g.active = null; }
  drag = null; controls.enabled = true; val.hidden = true;
};
canvas.addEventListener('pointerup', end, true);
canvas.addEventListener('pointercancel', end, true);

// ---------- render: each cell with the shared camera, its aspect, its gizmo's layer ----------
function camAt(c) {
  camera.aspect = c.w / c.h; camera.updateProjectionMatrix();
  camera.layers.set(0); camera.layers.enable(c.i + 1);
  return camera;
}
function size() { renderer.setSize(innerWidth, innerHeight, false); }
addEventListener('resize', size); size();
renderer.setAnimationLoop(() => {
  controls.update();
  for (const c of columns()) {
    const cam = camAt(c), g = gizmos[c.i];
    g.place(sec.pivot, sec.quat); g.update(cam, c.w, c.h);
    const y = innerHeight - c.y - c.h;      // GL counts from the bottom
    renderer.setViewport(c.x, y, c.w, c.h); renderer.setScissor(c.x, y, c.w, c.h);
    renderer.render(scene, cam);
  }
});
window.lab = { gizmos, sec, camera, controls };
