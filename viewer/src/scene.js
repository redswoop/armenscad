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

export const canvas = document.querySelector('#c');
export const stage = canvas.parentElement;
export const bus = new EventTarget();     // 'camera' after any camera move, 'resize' after the canvas resizes

export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true });   // stencil: section caps (section.js)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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

// lights: sky/ground ambient, a fixed key (the one that casts shadows, shading.js), a fill (shading.js can
// turn it into a headlight that follows the camera so shadowed interiors stay readable)
export const lights = {
  hemi: new THREE.HemisphereLight(0xffffff, 0x334455, 1.1),
  key: new THREE.DirectionalLight(0xffffff, 1.4),
  fill: new THREE.DirectionalLight(0xffffff, 0.5),
};
lights.key.position.set(80, -60, 120); lights.fill.position.set(-80, 60, -40);
scene.add(lights.hemi, lights.key, lights.key.target, lights.fill, lights.fill.target);
const grid = new THREE.GridHelper(200, 20, 0x3a3f4a, 0x262a33); grid.rotation.x = Math.PI / 2; scene.add(grid);
scene.add(new THREE.AxesHelper(20));

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
(function loop() { controls.update(); clip(); for (const f of frameHooks) f(); renderer.render(scene, view.camera); requestAnimationFrame(loop); })();

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
  document.querySelector('#ortho')?.classList.toggle('on', on);
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
  const b = bounds(), c = b.getCenter(new THREE.Vector3()), hp = b.getSize(new THREE.Vector3()).length() / 2 * 1.1;
  const cam = view.camera, d = dir ?? cam.position.clone().sub(controls.target).normalize();
  controls.target.copy(c); cam.position.copy(c).addScaledVector(d, hp / tanHalfFov());
  if (cam.isOrthographicCamera) { cam.zoom = ORTHO_HALF / hp; cam.updateProjectionMatrix(); }
  controls.update();
  bus.dispatchEvent(new Event('camera'));
}
export const VIEWS = { iso: [1, -1.2, 0.8], top: [0, 0, 1], front: [0, -1, 0], side: [1, 0, 0], under: [0.01, -0.3, -1] };
export const fitView = (name) => fit(new THREE.Vector3(...VIEWS[name]).normalize());

// ---------- poses ----------
export function getPose() {
  const cam = view.camera;
  return { pos: cam.position.toArray().map(r3), target: controls.target.toArray().map(r3), up: [0, 0, 1],
           fov: persp.fov, ortho: !!cam.isOrthographicCamera, zoom: cam.isOrthographicCamera ? +cam.zoom.toFixed(4) : 1 };
}
const r3 = (v) => Math.round(v * 1000) / 1000;
export function setPose(p) {
  if (!p) return;
  if (!!p.ortho !== isOrtho()) setOrtho(!!p.ortho);
  const cam = view.camera;
  cam.position.fromArray(p.pos); controls.target.fromArray(p.target);
  if (cam.isPerspectiveCamera) cam.fov = p.fov ?? 40; else cam.zoom = p.zoom ?? 1;
  cam.updateProjectionMatrix();
  // drop damping residue so the pose lands exactly (private fields in r170; guard in case they move)
  controls._sphericalDelta?.set(0, 0, 0); controls._panOffset?.set(0, 0, 0); controls._scale = 1;
  controls.update();
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
