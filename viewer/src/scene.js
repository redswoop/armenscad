// The three.js scene: renderer, cameras, controls, lights, grid, the part group, framing, poses, picking helpers.
// OpenSCAD is Z-up, so the cameras' up is +Z and the grid lies in XY.
//
// Two cameras share one OrbitControls: perspective for looking around, orthographic for tracing and
// straight-on comparison. `view.camera` is whichever is active; controls.object is swapped with it.
// A "pose" is the one camera description used everywhere (annotations, the view route, window.viewer):
//   { pos:[x,y,z], target:[x,y,z], up:[0,0,1], fov, ortho, zoom }
// The ortho frustum is not stored: it is ORTHO_HALF (a constant) x the viewport aspect / zoom.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { axisColors } from './tokens.js';

export const canvas = document.querySelector('#c');
export const stage = canvas.parentElement;
export const bus = new EventTarget();     // 'camera' after any camera move, 'resize' after the canvas resizes

export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true, alpha: true });   // stencil: section caps (section.js); alpha: a skin's backdrop (theme.js)
// Pixel ratio: 2 device px per CSS px when the camera is still (on a 1x display that supersamples the frame, so
// hairlines, curves and the gizmo's rims come out antialiased like the DOM chrome instead of 1 px aliased), the
// display's own ratio while the camera moves (the 4x fill of the still frame drops a 1.5 M triangle orbit from 60
// to ~43 fps at 2245 px wide; nobody sees aliasing on a moving frame). The loop switches ~0.2 s after the last move.
const RATIO_STILL = 2, RATIO_MOVING = Math.min(devicePixelRatio, 2);
let lastMove = performance.now(), ratio = RATIO_STILL;
renderer.setPixelRatio(ratio);
function setRatio(r) { if (r === ratio) return; ratio = r; renderer.setPixelRatio(r); renderer.setSize(stage.clientWidth, stage.clientHeight, false); }
export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);

const ORTHO_HALF = 100;                    // half-height of the ortho frustum in mm at zoom 1
export const persp = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
export const ortho = new THREE.OrthographicCamera(-100, 100, 100, -100, -5000, 5000);
persp.up.set(0, 0, 1); ortho.up.set(0, 0, 1);    // must match: OrbitControls bakes object.up into its quaternion once
persp.position.set(120, -140, 90);
export const view = { camera: persp };
export const controls = new OrbitControls(persp, canvas);
controls.enableDamping = true;
controls.addEventListener('change', () => bus.dispatchEvent(new Event('camera')));
bus.addEventListener('camera', () => { lastMove = performance.now(); });

// lights: sky/ground ambient, a fixed key (the one that casts shadows, shading.js), a fill (shading.js can
// turn it into a headlight that follows the camera so shadowed interiors stay readable)
export const lights = {
  hemi: new THREE.HemisphereLight(0xffffff, 0x334455, 1.1),
  key: new THREE.DirectionalLight(0xffffff, 1.4),
  fill: new THREE.DirectionalLight(0xffffff, 0.5),
};
lights.key.position.set(80, -60, 120); lights.fill.position.set(-80, 60, -40);
scene.add(lights.hemi, lights.key, lights.key.target, lights.fill, lights.fill.target);
let grid = null;
// the skin's backdrop (theme.js): a background colour, or null to let the page show through; the grid's two line colours
export function setBackdrop(bg, center = 0x3a3f4a, lines = 0x262a33) {
  scene.background = bg == null ? null : new THREE.Color(bg);
  if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
  grid = new THREE.GridHelper(200, 20, center, lines); grid.rotation.x = Math.PI / 2; scene.add(grid);
}
setBackdrop(0x14161a);
const axes = new THREE.AxesHelper(20); scene.add(axes);
// the axes take the skin's axis colours (theme.js fires 'skin' once the skin is on)
bus.addEventListener('skin', () => { const [x, y, z] = axisColors(); axes.setColors(x, y, z); });

// the parts live here; bounds()/fit() frame whatever in it is visible
export const group = new THREE.Group(); scene.add(group);

export function resize() {
  const { clientWidth: w, clientHeight: h } = stage;
  renderer.setSize(w, h, false);
  persp.aspect = w / h; persp.updateProjectionMatrix();
  ortho.left = -ORTHO_HALF * w / h; ortho.right = ORTHO_HALF * w / h; ortho.top = ORTHO_HALF; ortho.bottom = -ORTHO_HALF;
  ortho.updateProjectionMatrix();
  bus.dispatchEvent(new Event('resize'));
}
new ResizeObserver(resize).observe(stage);
resize();
export const frameHooks = new Set();       // callbacks run before every frame (section.js keeps its caps in step with the parts)
// Clip planes follow the orbit distance, so a room-sized model (metres, not a 200 mm part) is not cut off at 5 m.
function clip() {
  const far = Math.max(5000, 20 * view.camera.position.distanceTo(controls.target));
  if (far === persp.far) return;
  persp.far = far; persp.near = far / 50000; persp.updateProjectionMatrix();
  ortho.far = far; ortho.near = -far; ortho.updateProjectionMatrix();
}
(function loop() { controls.update(); clip(); for (const f of frameHooks) f(); setRatio(performance.now() - lastMove < 200 ? RATIO_MOVING : RATIO_STILL); renderer.render(scene, view.camera); requestAnimationFrame(loop); })();

const tanHalfFov = () => Math.tan(THREE.MathUtils.degToRad(persp.fov / 2));

// ---------- perspective <-> orthographic ----------
// Keeps the framing: the visible half-height at the target is dist * tan(fov/2) in perspective and
// ORTHO_HALF / zoom in ortho, so equate the two.
export function setOrtho(on) {
  const from = view.camera, to = on ? ortho : persp;
  if (from === to) return;
  const dir = from.position.clone().sub(controls.target); const dist = dir.length(); dir.normalize();
  if (on) { ortho.zoom = ORTHO_HALF / (dist * tanHalfFov()); ortho.position.copy(from.position); }
  else { persp.position.copy(controls.target).addScaledVector(dir, (ORTHO_HALF / ortho.zoom) / tanHalfFov()); }
  to.updateProjectionMatrix();
  view.camera = to; controls.object = to; controls.update();
  bus.dispatchEvent(new Event('ui'));     // the rails show the camera
  console.log(`[viewer] ortho ${on ? 'on zoom=' + ortho.zoom.toFixed(3) : 'off'}`);
  bus.dispatchEvent(new Event('camera'));
}
export const isOrtho = () => view.camera.isOrthographicCamera;

// ---------- framing ----------
export function bounds() {
  const b = new THREE.Box3();
  for (const m of group.children) if (m.visible) b.expandByObject(m);
  return b.isEmpty() ? new THREE.Box3(new THREE.Vector3(-50, -50, 0), new THREE.Vector3(50, 50, 30)) : b;
}
export function fit(dir) {
  tween = null;
  const b = bounds(), c = b.getCenter(new THREE.Vector3()), hp = b.getSize(new THREE.Vector3()).length() / 2 * 1.1;
  const cam = view.camera, d = dir ?? cam.position.clone().sub(controls.target).normalize();
  controls.target.copy(c); cam.position.copy(c).addScaledVector(d, hp / tanHalfFov());
  if (cam.isOrthographicCamera) { cam.zoom = ORTHO_HALF / hp; cam.updateProjectionMatrix(); }
  controls.update();
  bus.dispatchEvent(new Event('camera'));
}
export const VIEWS = { iso: [1, -1.2, 0.8], top: [0, 0, 1], front: [0, -1, 0], side: [1, 0, 0], under: [0.01, -0.3, -1] };
export const fitView = (name) => fit(new THREE.Vector3(...VIEWS[name]).normalize());

// ---------- animated orbits (the view cube, the view keys) ----------
// orbitTo swings the camera round the target until it looks along -dir; { fit: true } also frames the
// visible parts on the way. It interpolates azimuth and polar angle about +Z rather than slerping, so front
// to back goes round the side and Z stays up; straight down (or up) lands with the front at the bottom of
// the screen. Any drag of the controls cancels it.
const POLE = 1e-4;
const toSph = (d) => ({ th: Math.atan2(d.y, d.x), ph: Math.acos(THREE.MathUtils.clamp(d.z, -1, 1)) });
const fromSph = (th, ph) => new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.sin(ph) * Math.sin(th), Math.cos(ph));
let tween = null;
export function orbitTo(dir, { fit: framing = false, ms = 320 } = {}) {
  const cam = view.camera, d = new THREE.Vector3(...dir).normalize();
  const off = cam.position.clone().sub(controls.target), r0 = off.length();
  const a = toSph(off.normalize()), b = toSph(d);
  if (Math.hypot(d.x, d.y) < 1e-6) b.th = -Math.PI / 2;
  b.ph = THREE.MathUtils.clamp(b.ph, POLE, Math.PI - POLE);
  const dth = THREE.MathUtils.euclideanModulo(b.th - a.th + Math.PI, 2 * Math.PI) - Math.PI;
  let t1 = controls.target.clone(), r1 = r0, z1 = cam.zoom;
  if (framing) {
    const bx = bounds(), hp = bx.getSize(new THREE.Vector3()).length() / 2 * 1.1;
    t1 = bx.getCenter(new THREE.Vector3()); r1 = hp / tanHalfFov();
    if (cam.isOrthographicCamera) z1 = ORTHO_HALF / hp;
  }
  stopDamping();
  tween = { t0: performance.now(), ms, a, dth, dph: b.ph - a.ph, tA: controls.target.clone(), t1, r0, r1, z0: cam.zoom, z1 };
}
function step() {
  if (!tween) return;
  const w = tween, k = Math.min(1, (performance.now() - w.t0) / w.ms), e = 1 - (1 - k) ** 3, cam = view.camera;
  controls.target.lerpVectors(w.tA, w.t1, e);
  cam.position.copy(controls.target).addScaledVector(fromSph(w.a.th + w.dth * e, w.a.ph + w.dph * e), THREE.MathUtils.lerp(w.r0, w.r1, e));
  if (cam.isOrthographicCamera && w.z0 !== w.z1) { cam.zoom = THREE.MathUtils.lerp(w.z0, w.z1, e); cam.updateProjectionMatrix(); }
  controls.update();
  bus.dispatchEvent(new Event('camera'));
  if (k === 1) { tween = null; controls.dispatchEvent({ type: 'end' }); }
}
frameHooks.add(step);
controls.addEventListener('start', () => { tween = null; });
// the camera's direction from the target, turned by dth about Z and tilted dph off it (radians)
export function orbitDir(dth, dph) {
  const s = toSph(view.camera.position.clone().sub(controls.target).normalize());
  return fromSph(s.th + dth, THREE.MathUtils.clamp(s.ph + dph, POLE, Math.PI - POLE)).toArray();
}
export function orbitBy(dth, dph) {       // at once: a drag on the view cube
  tween = null;
  const r = view.camera.position.distanceTo(controls.target), d = new THREE.Vector3(...orbitDir(dth, dph));
  view.camera.position.copy(controls.target).addScaledVector(d, r);
  stopDamping(); controls.update();
  bus.dispatchEvent(new Event('camera'));
}
// f < 1 zooms in: closer in perspective, a bigger zoom in ortho
export function zoomBy(f) {
  const cam = view.camera;
  if (cam.isOrthographicCamera) { cam.zoom /= f; cam.updateProjectionMatrix(); }
  else cam.position.sub(controls.target).multiplyScalar(f).add(controls.target);
  stopDamping(); controls.update();
  bus.dispatchEvent(new Event('camera'));
  controls.dispatchEvent({ type: 'end' });
}
// drop damping residue so a pose lands exactly (private fields in r170; guard in case they move)
function stopDamping() { controls._sphericalDelta?.set(0, 0, 0); controls._panOffset?.set(0, 0, 0); controls._scale = 1; }

// ---------- poses ----------
export function getPose() {
  const cam = view.camera;
  return { pos: cam.position.toArray().map(r3), target: controls.target.toArray().map(r3), up: [0, 0, 1],
           fov: persp.fov, ortho: !!cam.isOrthographicCamera, zoom: cam.isOrthographicCamera ? +cam.zoom.toFixed(4) : 1 };
}
const r3 = (v) => Math.round(v * 1000) / 1000;
export function setPose(p) {
  if (!p) return;
  tween = null;
  if (!!p.ortho !== isOrtho()) setOrtho(!!p.ortho);
  const cam = view.camera;
  cam.position.fromArray(p.pos); controls.target.fromArray(p.target);
  if (cam.isPerspectiveCamera) cam.fov = p.fov ?? 40; else cam.zoom = p.zoom ?? 1;
  cam.updateProjectionMatrix();
  stopDamping(); controls.update();
  bus.dispatchEvent(new Event('camera'));
}
// how different two poses look: direction angle (deg), target offset (mm), magnification ratio
export function poseDiff(a, b) {
  const da = new THREE.Vector3().fromArray(a.pos).sub(new THREE.Vector3().fromArray(a.target));
  const db = new THREE.Vector3().fromArray(b.pos).sub(new THREE.Vector3().fromArray(b.target));
  const angle = THREE.MathUtils.radToDeg(da.angleTo(db));
  const shift = new THREE.Vector3().fromArray(a.target).distanceTo(new THREE.Vector3().fromArray(b.target));
  const mag = (p, d) => (p.ortho ? p.zoom : 1 / Math.max(d, 1e-6));
  const ratio = mag(a, da.length()) / mag(b, db.length());
  return { angle, shift, ratio, sameMode: !!a.ortho === !!b.ortho };
}

// ---------- picking / projection ----------
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
// pointer event -> { u, v } in 0..1 of the canvas's CSS box (v down) and the matching NDC vector
export function toScreen(ev) {
  const r = canvas.getBoundingClientRect();
  const u = (ev.clientX - r.left) / r.width, v = (ev.clientY - r.top) / r.height;
  return { u, v, ndc: ptr.set(u * 2 - 1, 1 - v * 2) };
}
export const toNDC = (ev) => toScreen(ev).ndc;
export const uvToNDC = (u, v) => new THREE.Vector2(u * 2 - 1, 1 - v * 2);
// predicates a hit must pass (section.js drops hits in the clipped-away half of a part)
export const pickFilters = new Set();
export function raycast(ndc, objects) {
  ray.setFromCamera(ndc, view.camera);
  return ray.intersectObjects(objects, false).find((h) => [...pickFilters].every((f) => f(h))) ?? null;
}
// world point -> { u, v, inFront }; inFront is false behind the camera (project() mirrors those)
export function project(v3) {
  const cam = view.camera;
  const c = v3.clone().applyMatrix4(cam.matrixWorldInverse);
  const p = v3.clone().project(cam);
  return { u: (p.x + 1) / 2, v: (1 - p.y) / 2, inFront: cam.isOrthographicCamera || c.z < 0 };
}
export const canvasSize = () => [stage.clientWidth, stage.clientHeight];
