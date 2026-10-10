// Section: one clipping plane through the parts, driven from the sidebar (axis, position, flip, two tilt
// angles), by the gizmo on the plane (an arrow slides it, two rings turn it), by gestures on a cut face
// (drag slides it, click moves the gizmo there, double-click flips it), or from
// window.viewer.section({ on, axis, mm, flip, rot: [a, b], pivot: [x, y, z] }). three's local clipping on the
// part (and ghost) materials, so the grid, reference overlays and annotations stay whole. Remembered per
// model in localStorage.
//
// The plane: base normal ±axis (flip picks the sign; it points into the kept half), tilted by rot[0] degrees
// about the next axis and rot[1] about the one after (X: about Y then Z; Y: about Z then X; Z: about X then
// Y), passing through pivot. mm is pivot's component along the base axis, which is what the slider moves.
// The pivot is where the gizmo sits and what the rings turn about.
//
// Cut faces are capped the way CAD does it: the plane passes through solid material, so that area is drawn
// in the part's colour with a hatch (one line direction per part) and, where two parts occupy the same spot
// on the plane, in red cross-hatch (an interference). Without caps a section reads as hollow shells.
//
// How the cap knows where the solid is: the stencil buffer. For every part, its geometry is drawn twice with
// colour off and the same clipping plane (back faces +1, front faces -1). Along a pixel's ray through the
// cut, the front face that would have balanced the interior back face is clipped away, so the count is
// non-zero exactly where the plane passes through solid (the three.js webgl_clipping_stencil recipe; needs
// watertight meshes, which ours are). Low 7 bits hold that count, the top bit remembers "some part already
// capped this pixel": drawing the cap replaces the byte with the flag, so the next part's count starts clean
// and a non-zero count on a flagged pixel is an overlap. Per part, in order: stencil back, stencil front,
// overlap cap (flag set and count != 0), cap (count != 0). Every mesh sits in the scene directly with its own
// renderOrder; a Group's renderOrder would sort its children as a block, before every cap.
import * as THREE from 'three';
import { MODEL } from './api.js';
import { scene, renderer, canvas, controls, view, bus, bounds, frameHooks, toNDC, raycast, pickFilters } from './scene.js';
import { meshes, visibleMeshes, allMaterials } from './parts.js';

const $ = (s) => document.querySelector(s);
renderer.localClippingEnabled = true;
const AX = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
const KEY = `section:${MODEL}`;
export const st = Object.assign({ on: false, axis: 'Z', mm: 0, flip: false, rot: [0, 0], pivot: null }, JSON.parse(localStorage.getItem(KEY) ?? '{}'));
const plane = new THREE.Plane();
const axisIndex = () => 'XYZ'.indexOf(st.axis);
const sign = () => (st.flip ? 1 : -1);
const tilted = () => st.rot[0] !== 0 || st.rot[1] !== 0;
// normal for tilt angles (a, b) on the base axis i: cos a cos b e_i + sin b e_j - sin a cos b e_k (j, k cyclic)
function normalFor(a, b, s = sign()) {
  const i = axisIndex(), j = (i + 1) % 3, k = (i + 2) % 3, A = THREE.MathUtils.degToRad(a), B = THREE.MathUtils.degToRad(b);
  const n = new THREE.Vector3();
  n.setComponent(i, Math.cos(A) * Math.cos(B)); n.setComponent(j, Math.sin(B)); n.setComponent(k, -Math.sin(A) * Math.cos(B));
  return n.multiplyScalar(s);
}
// the inverse: tilt angles (degrees) that give a unit normal n on the current base
function anglesFor(n) {
  const i = axisIndex(), j = (i + 1) % 3, k = (i + 2) % 3, f = n.clone().multiplyScalar(sign());
  return [THREE.MathUtils.radToDeg(Math.atan2(-f.getComponent(k), f.getComponent(i))), THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(f.getComponent(j), -1, 1)))];
}
const normal = () => normalFor(st.rot[0], st.rot[1]);   // points into the kept half
// a point on the plane; the stored pivot, or the middle of the parts at mm along the axis until one is set
function pivot() {
  const p = st.pivot ? new THREE.Vector3(...st.pivot) : bounds().getCenter(new THREE.Vector3());
  p.setComponent(axisIndex(), st.mm);
  if (meshes.size) st.pivot = p.toArray();     // before the parts load the bounds are a placeholder: don't keep that
  return p;
}
// is a world point on the kept side (true when the section is off)
export const kept = (p) => !st.on || plane.distanceToPoint(p) >= -1e-4;
pickFilters.add((hit) => !hit.object.userData.name || kept(hit.point));    // part picking ignores the clipped-away half

// ---------- stencil masks ----------
const FLAG = 0x80, COUNT = 0x7f;
const ORDER = 10;      // parts draw at 0; each part's four section meshes take ORDER + 4i .. + 3
function stencilMat(side, op) {
  const m = new THREE.MeshBasicMaterial({ side, depthWrite: false, depthTest: false, colorWrite: false, clippingPlanes: [plane] });
  m.stencilWrite = true; m.stencilWriteMask = COUNT;
  m.stencilFunc = THREE.AlwaysStencilFunc; m.stencilFail = op; m.stencilZFail = op; m.stencilZPass = op;
  return m;
}

// ---------- hatched cap material ----------
// MeshStandardMaterial with a hatch mixed into the base colour: parallel lines `pitch` mm apart at `angle`
// on the plane (cross-hatch for overlaps). vCap is the quad's uv in mm; fwidth() anti-aliases the lines so
// they fade to a tint when zoomed out instead of shimmering.
const HATCH = { pitch: 2.5, width: 0.3 };
function capMat(cross) {
  const u = { uAngle: { value: 0 }, uSize: { value: 1 }, uLine: { value: new THREE.Color() } };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.02, side: THREE.DoubleSide });
  mat.defines = cross ? { CAP_CROSS: 1 } : {};
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uSize; varying vec2 vCap;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvCap = uv * uSize;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uAngle; uniform vec3 uLine; varying vec2 vCap;
float hatch(vec2 dir) {
  float d = dot(vCap, dir), w = fwidth(d);
  float f = abs(fract(d / ${HATCH.pitch.toFixed(3)}) - 0.5) * ${HATCH.pitch.toFixed(3)};   // mm to the nearest line
  return 1.0 - smoothstep(${HATCH.width.toFixed(3)} - w, ${HATCH.width.toFixed(3)} + w, f);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 dir = vec2(cos(uAngle), sin(uAngle));
  float h = hatch(dir);
  #ifdef CAP_CROSS
  h = max(h, hatch(vec2(-dir.y, dir.x)));
  #endif
  diffuseColor.rgb = mix(diffuseColor.rgb, uLine, h);
}`);
  };
  mat.userData.u = u;
  // stencil: ref FLAG is both the test value (masked) and what Replace writes: count cleared, flag set
  mat.stencilWrite = true; mat.stencilRef = FLAG; mat.stencilWriteMask = 0xff;
  mat.stencilFail = THREE.KeepStencilOp; mat.stencilZFail = THREE.ReplaceStencilOp; mat.stencilZPass = THREE.ReplaceStencilOp;
  if (cross) { mat.stencilFunc = THREE.LessStencilFunc; mat.stencilFuncMask = 0xff; }        // FLAG < byte: flagged and counted
  else { mat.stencilFunc = THREE.NotEqualStencilFunc; mat.stencilFuncMask = COUNT; }        // count != 0
  return mat;
}
const OVERLAP = new THREE.Color(0xd23c3c), OVERLAP_LINE = new THREE.Color(0x5a1010);

// ---------- one cap set per part ----------
const caps = new Map();      // part name -> { back, front, overlap, cap, i }
const capGeo = new THREE.PlaneGeometry(1, 1);
function makeCap(name, mesh, i) {
  const back = new THREE.Mesh(mesh.geometry, stencilMat(THREE.BackSide, THREE.IncrementWrapStencilOp));
  const front = new THREE.Mesh(mesh.geometry, stencilMat(THREE.FrontSide, THREE.DecrementWrapStencilOp));
  const overlap = new THREE.Mesh(capGeo, capMat(true));
  const cap = new THREE.Mesh(capGeo, capMat(false));
  overlap.material.color.copy(OVERLAP); overlap.material.userData.u.uLine.value.copy(OVERLAP_LINE);
  const c = { back, front, overlap, cap, i };
  order(c, i);
  for (const m of [back, front, overlap, cap]) { m.frustumCulled = false; m.userData.section = name; scene.add(m); }
  overlap.receiveShadow = cap.receiveShadow = true;     // the kept half throws shadows onto the cut face
  caps.set(name, c);
  return c;
}
function order(c, i) {
  c.i = i;
  c.back.renderOrder = c.front.renderOrder = ORDER + 4 * i;
  c.overlap.renderOrder = ORDER + 4 * i + 1;
  c.cap.renderOrder = ORDER + 4 * i + 2;
  c.cap.material.userData.u.uAngle.value = THREE.MathUtils.degToRad(45 + 37 * i);      // a different direction per part
  c.overlap.material.userData.u.uAngle.value = THREE.MathUtils.degToRad(45 + 37 * i);
}
// runs before every frame: caps follow the parts (visibility, rebuilt geometry, colour) and the plane
function syncCaps() {
  const b = bounds(), c = b.getCenter(new THREE.Vector3()), size = b.getSize(new THREE.Vector3()).length() * 1.1;
  const n = normal(), p = pivot();
  // the quad sits on the plane under the middle of the parts, not at the pivot: the gizmo can be dragged
  // far off the parts, and a quad centred there stops short of the far side of the cut
  const mid = c.addScaledVector(n, -n.dot(c.clone().sub(p)));
  let k = 0;
  for (const [name, mesh] of meshes) {
    const cp = caps.get(name) ?? makeCap(name, mesh, k);
    if (cp.i !== k) order(cp, k);
    const on = st.on && mesh.visible;
    cp.back.visible = cp.front.visible = cp.overlap.visible = cp.cap.visible = on;
    k++;
    if (!on) continue;
    if (cp.back.geometry !== mesh.geometry) cp.back.geometry = cp.front.geometry = mesh.geometry;
    const u = cp.cap.material.userData.u;
    cp.cap.material.color.copy(mesh.material.color).add(mesh.material.emissive);
    u.uLine.value.copy(mesh.material.color).multiplyScalar(0.45);
    for (const q of [cp.cap, cp.overlap]) {
      q.material.userData.u.uSize.value = size;
      q.scale.set(size, size, 1);
      q.position.copy(mid);
      q.lookAt(q.position.clone().sub(n));     // face the removed half
    }
  }
  for (const [name, cp] of caps) if (!meshes.has(name)) { for (const m of [cp.back, cp.front, cp.overlap, cp.cap]) scene.remove(m); caps.delete(name); }
}
frameHooks.add(syncCaps);

function apply() {
  plane.setFromNormalAndCoplanarPoint(normal(), pivot());     // visible where n·p + c >= 0
  for (const m of allMaterials()) { m.clippingPlanes = st.on ? [plane] : null; m.needsUpdate = true; }
  syncCaps();
  localStorage.setItem(KEY, JSON.stringify(st));
  syncUI();
}

function range() {           // slider limits: the parts' extent along the axis, a little past each end
  const b = bounds(), i = axisIndex();
  return [Math.floor(b.min.getComponent(i)) - 1, Math.ceil(b.max.getComponent(i)) + 1];
}
function syncUI() {
  const [lo, hi] = range();
  $('#sec-on').checked = st.on; $('#sec-axis').value = st.axis; $('#sec-flip').checked = st.flip;
  $('#sec-pos').min = lo; $('#sec-pos').max = hi; $('#sec-pos').value = st.mm; $('#sec-mm').value = +st.mm.toFixed(2);
  const i = axisIndex();
  $('#sec-rot-a-ax').textContent = 'XYZ'[(i + 1) % 3]; $('#sec-rot-b-ax').textContent = 'XYZ'[(i + 2) % 3];
  $('#sec-rot-a').value = st.rot[0]; $('#sec-rot-b').value = st.rot[1];
  $('#sec-rot-row').classList.toggle('tilted', tilted());
  const where = tilted() ? `tilted ${st.rot.map((a) => +a.toFixed(1)).join('° / ')}°, gizmo at (${st.pivot.map((v) => v.toFixed(1)).join(', ')})` : `${st.axis} ${st.flip ? '≥' : '≤'} ${+st.mm.toFixed(2)} mm`;
  $('#sec-hint').textContent = st.on ? `showing ${where} · gizmo: arrow slides, rings turn, knob moves it · cut face: drag slides, click moves the gizmo, double-click flips · alt = fine steps` : '';
}

// the one entry point: set any of the fields, get the state back
export function section(opts = {}) {
  if (opts.axis) st.axis = String(opts.axis).toUpperCase();
  if (opts.mm !== undefined) st.mm = +opts.mm;
  if (opts.flip !== undefined) st.flip = !!opts.flip;
  if (opts.on !== undefined) st.on = !!opts.on;
  if (opts.rot) { if (!tilted() && !opts.pivot) st.pivot = null; st.rot = [+opts.rot[0] || 0, +opts.rot[1] || 0]; }   // a fresh tilt turns about the middle of the parts
  if (opts.pivot) { st.pivot = [...opts.pivot].map(Number); st.mm = st.pivot[axisIndex()]; }
  if (!Number.isFinite(st.mm)) st.mm = bounds().getCenter(new THREE.Vector3()).getComponent(axisIndex());
  apply();
  console.log(`[viewer] section ${st.on ? `on ${st.axis}${st.flip ? '>=' : '<='}${st.mm}${tilted() ? ` rot ${st.rot.join('/')} pivot ${st.pivot.map((v) => +v.toFixed(2)).join(',')}` : ''}` : 'off'}`);
  return { ...st };
}
export const toggleSection = () => section({ on: !st.on });

// ---------- what is under the pointer ----------
// A capped spot: a cap quad hit, nothing of the kept half nearer to the camera, and the point inside some
// visible part's solid (an odd number of surface crossings from it into the removed half).
const ray = new THREE.Raycaster();
function capUnder(ndc) {
  if (!st.on) return null;
  const quads = [...caps.values()].filter((c) => c.cap.visible).map((c) => c.cap);
  const hit = raycast(ndc, quads); if (!hit) return null;
  const near = raycast(ndc, visibleMeshes());                       // pickFilters keep this to the kept half
  if (near && near.distance < hit.distance - 1e-3) return null;     // something in front of the cut face
  ray.set(hit.point, normal().negate()); ray.near = 1e-3; ray.far = Infinity;
  for (const [name, cp] of caps) {
    if (!cp.cap.visible) continue;
    if (ray.intersectObjects([cp.back, cp.front], false).length % 2 === 1) return { point: hit.point, part: name };
  }
  return null;
}

// ---------- the gizmo ----------
// A transform handle on the plane at the pivot, a constant size on screen, drawn on top of everything:
//   centre  a knob at the pivot: drag to move the gizmo across the plane (the plane stays; the rings then
//           turn about the new spot)
//   arrow   double-headed, along the normal: drag to slide the plane
//   rings   one per in-plane axis (coloured for the world axis it starts as; they follow the plane once it
//           tilts): drag around the ring to turn the plane about that axis. The angle comes from where the
//           pointer ray meets the ring's own plane, so it is a pure function of the pointer position (no
//           drift; letting go and re-grabbing continues exactly). Snaps to 1°, alt 0.1°, ctrl 15°.
// While a drag runs a faint square with a cross shows the whole plane, so a tilt reads even where no cap
// is in view, and a label by the pointer shows the value.
const AXIS_COLOR = [0xe05252, 0x52c452, 0x5a8cf0];    // X, Y, Z
const ARROW_COLOR = 0xffd166;
const GIZMO_PX = 56;                                  // ring radius on screen
const onTop = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false });
const pickMat = () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false, colorWrite: false });
const gizmo = new THREE.Group();
function ring(axisLocal) {         // torus lies in XY (axis Z); turn its axis onto the local axis it rotates about
  const g = new THREE.Group();
  const vis = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 8, 64), onTop(0xffffff, 0.75));
  const pick = new THREE.Mesh(new THREE.TorusGeometry(1, 0.14, 6, 48), pickMat());
  if (axisLocal === 'x') g.rotation.y = Math.PI / 2; else g.rotation.x = Math.PI / 2;
  g.add(vis, pick); g.userData = { handle: 'ring', axisLocal, vis };
  pick.userData.handle = g;
  return g;
}
function arrow() {
  const g = new THREE.Group();
  const mat = onTop(ARROW_COLOR, 0.85);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 12), mat);
  const tip1 = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 16), mat); tip1.position.y = 1.44;
  const tip2 = tip1.clone(); tip2.position.y = -1.44; tip2.rotation.z = Math.PI;
  const pick = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 3.2, 8), pickMat());
  g.add(shaft, tip1, tip2, pick);
  g.rotation.x = Math.PI / 2;      // cylinder runs along Y; the normal is local Z
  g.userData = { handle: 'arrow', vis: shaft, mat };
  pick.userData.handle = g;
  return g;
}
function centre() {
  const g = new THREE.Group();
  const vis = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), onTop(ARROW_COLOR, 0.9));
  const pick = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), pickMat());
  g.add(vis, pick); g.userData = { handle: 'centre', vis };
  pick.userData.handle = g;
  return g;
}
const handles = { centre: centre(), ringX: ring('x'), ringY: ring('y'), arrow: arrow() };
gizmo.add(handles.centre, handles.ringX, handles.ringY, handles.arrow);
const outline = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([
  [-0.5, -0.5], [0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [0.5, 0.5], [-0.5, 0.5], [-0.5, 0.5], [-0.5, -0.5], [-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5],
].map(([x, y]) => new THREE.Vector3(x, y, 0))), new THREE.LineBasicMaterial({ color: ARROW_COLOR, transparent: true, opacity: 0.35, depthTest: false }));
gizmo.renderOrder = outline.renderOrder = 1000;
gizmo.traverse((o) => { o.renderOrder = 1000; });
scene.add(gizmo, outline);
const pickMeshes = Object.values(handles).map((h) => h.children.find((c) => c.userData.handle));

// the plane's frame: local x, y are the base axes j, k carried by the tilt, local z the (unsigned) normal
function frameQuat() {
  const i = axisIndex(), j = (i + 1) % 3, k = (i + 2) % 3;
  const ej = new THREE.Vector3().setComponent(j, 1), ek = new THREE.Vector3().setComponent(k, 1), ei = new THREE.Vector3().setComponent(i, 1);
  const q = new THREE.Quaternion().setFromAxisAngle(ej, THREE.MathUtils.degToRad(st.rot[0]))
    .multiply(new THREE.Quaternion().setFromAxisAngle(ek, THREE.MathUtils.degToRad(st.rot[1])));
  const m = new THREE.Matrix4().makeBasis(ej.applyQuaternion(q), ek.applyQuaternion(q), ei.applyQuaternion(q));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
// world mm per screen pixel at a point (perspective: grows with distance; ortho: the frustum over the canvas)
function mmPerPixel(p) {
  const cam = view.camera, h = canvas.clientHeight;
  if (cam.isOrthographicCamera) return (cam.top - cam.bottom) / cam.zoom / h;
  return 2 * cam.position.distanceTo(p) * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) / h;
}
let hover = null;      // handle group under the pointer
frameHooks.add(() => {
  gizmo.visible = st.on && meshes.size > 0;
  outline.visible = gizmo.visible && !!drag;
  if (!gizmo.visible) return;
  const p = pivot(), i = axisIndex();
  gizmo.position.copy(p); gizmo.quaternion.copy(frameQuat()); gizmo.scale.setScalar(GIZMO_PX * mmPerPixel(p));
  handles.ringX.userData.vis.material.color.setHex(AXIS_COLOR[(i + 1) % 3]);
  handles.ringY.userData.vis.material.color.setHex(AXIS_COLOR[(i + 2) % 3]);
  for (const h of Object.values(handles)) {
    const hot = drag?.handle === h || (!drag && hover === h);
    h.userData.vis.material.opacity = hot ? 1 : h.userData.handle === 'ring' ? 0.7 : 0.85;
    h.scale.setScalar(hot ? 1.08 : 1);
  }
  if (outline.visible) {
    outline.position.copy(p); outline.lookAt(p.clone().add(normal()));
    outline.scale.setScalar(bounds().getSize(new THREE.Vector3()).length() * 1.1);
  }
});
const handleUnder = (ndc) => (gizmo.visible ? raycast(ndc, pickMeshes)?.object.userData.handle ?? null : null);
const label = document.createElement('div'); label.id = 'gizmo-label'; label.hidden = true; canvas.parentElement.appendChild(label);
function showLabel(ev, text) {
  label.hidden = false; label.textContent = text;
  label.style.left = ev.offsetX + 16 + 'px'; label.style.top = ev.offsetY - 28 + 'px';
}

// ---------- gestures ----------
// The gizmo handles take priority; then a capped spot on a cut face (a cap quad hit, nothing of the kept
// half nearer to the camera, the point inside some visible part's solid). Registered in the capture phase
// so OrbitControls and the part picker never see the gestures.
//   centre drag                  move the gizmo across the plane (pointer ray meets the plane; snapped in-plane)
//   arrow drag / cut-face drag   slide along the normal to the point on that line nearest the pointer ray
//   ring drag                    turn about the ring's axis by the pointer's angle change around the pivot
//   click on a cut face          move the gizmo (the pivot) there; the plane does not change
//   double-click on a cut face   flip which half is kept
//   alt = 0.1 mm / 0.1° steps, ctrl on a ring = 15° steps
let drag = null;
function pointerLine(ev) {
  ray.setFromCamera(toNDC(ev), view.camera); ray.near = 0; ray.far = Infinity;
  return { o: ray.ray.origin.clone(), d: ray.ray.direction.clone() };
}
// parameter t of the point on the line p0 + a·t nearest to the line o + d·s
function nearestT(p0, a, o, d) {
  const w = p0.clone().sub(o), ad = a.dot(d), aw = a.dot(w), dw = d.dot(w);
  const den = 1 - ad * ad; if (den < 1e-6) return 0;     // looking straight down the axis
  return (ad * dw - aw) / den;
}
// angle of the pointer around `axis` through `c`, measured from e1 (in the ring's plane); null when the
// ring is seen edge-on
function ringAngle(ev, c, axis, e1) {
  const { o, d } = pointerLine(ev), dn = d.dot(axis);
  if (Math.abs(dn) < 1e-3) return null;
  const q = o.addScaledVector(d, c.clone().sub(o).dot(axis) / dn).sub(c);
  return Math.atan2(q.dot(axis.clone().cross(e1)), q.dot(e1));
}
const snap = (v, step) => Math.round(v / step) * step;
// where the pointer ray meets the plane through c with normal n; null when seen edge-on
function onPlane(ev, c, n) {
  const { o, d } = pointerLine(ev), dn = d.dot(n);
  return Math.abs(dn) < 1e-3 ? null : o.addScaledVector(d, c.clone().sub(o).dot(n) / dn);
}
canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0 || ev.metaKey) return;
  const ndc = toNDC(ev), h = handleUnder(ndc);
  const hit = h ? null : capUnder(ndc);
  if (!h && !hit) return;
  ev.stopImmediatePropagation(); ev.preventDefault();
  const p = pivot(), n = normal();
  drag = { x: ev.clientX, y: ev.clientY, moved: false, handle: h, n0: n, pivot0: p, hit: hit?.point.clone() };
  if (h?.userData.handle === 'ring') {
    drag.axis = new THREE.Vector3(h.userData.axisLocal === 'x' ? 1 : 0, h.userData.axisLocal === 'y' ? 1 : 0, 0).applyQuaternion(gizmo.quaternion);
    drag.a0 = ringAngle(ev, p, drag.axis, n);
    if (drag.a0 === null) { drag = null; return; }
  } else if (h?.userData.handle === 'centre') {
    drag.centre = true;
    drag.u = new THREE.Vector3(1, 0, 0).applyQuaternion(gizmo.quaternion); drag.v = new THREE.Vector3(0, 1, 0).applyQuaternion(gizmo.quaternion);
    drag.q0 = onPlane(ev, p, n); if (!drag.q0) { drag = null; return; }     // where on the plane the knob was grabbed
  } else drag.p0 = h ? p.clone() : hit.point.clone();
  controls.enabled = false;
  canvas.setPointerCapture(ev.pointerId);
  canvas.style.cursor = 'grabbing';
}, true);
canvas.addEventListener('pointermove', (ev) => {
  if (drag) {
    ev.stopImmediatePropagation();
    if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 3) drag.moved = true;
    if (!drag.moved) return;
    if (drag.centre) {
      const q = onPlane(ev, drag.pivot0, drag.n0); if (!q) return;
      const delta = q.sub(drag.q0);
      const step = ev.altKey ? 0.1 : 1, du = snap(delta.dot(drag.u), step), dv = snap(delta.dot(drag.v), step);
      section({ pivot: drag.pivot0.clone().addScaledVector(drag.u, du).addScaledVector(drag.v, dv).toArray() });
      showLabel(ev, `${du > 0 ? '+' : ''}${du.toFixed(ev.altKey ? 1 : 0)} / ${dv > 0 ? '+' : ''}${dv.toFixed(ev.altKey ? 1 : 0)} mm`);
    } else if (drag.axis) {
      const a = ringAngle(ev, drag.pivot0, drag.axis, drag.n0); if (a === null) return;
      const deg = snap(THREE.MathUtils.radToDeg(a - drag.a0), ev.altKey ? 0.1 : ev.ctrlKey ? 15 : 1);
      const n = drag.n0.clone().applyAxisAngle(drag.axis, THREE.MathUtils.degToRad(deg));
      section({ rot: anglesFor(n).map((v) => +v.toFixed(2)), pivot: drag.pivot0.toArray() });
      showLabel(ev, `${deg > 0 ? '+' : ''}${deg.toFixed(ev.altKey ? 1 : 0)}°`);
    } else {
      const { o, d } = pointerLine(ev), step = ev.altKey ? 0.1 : 1;
      const t = snap(nearestT(drag.p0, drag.n0, o, d), step);
      if (tilted()) section({ pivot: drag.pivot0.clone().addScaledVector(drag.n0, t).toArray() });
      else section({ mm: snap(drag.pivot0.getComponent(axisIndex()) + t * drag.n0.getComponent(axisIndex()), step) });
      showLabel(ev, `${t > 0 ? '+' : ''}${t.toFixed(ev.altKey ? 1 : 0)} mm`);
    }
    return;
  }
  if (!st.on || ev.buttons) return;
  const ndc = toNDC(ev);
  hover = handleUnder(ndc);
  if (hover || capUnder(ndc)) {       // ours: the part picker (later listener) must not restyle the cursor or show its tip
    ev.stopImmediatePropagation();
    canvas.style.cursor = hover?.userData.handle === 'centre' ? 'move' : 'grab'; $('#tip').hidden = true;
  } else if (hover === null && canvas.style.cursor === 'move') canvas.style.cursor = '';
}, true);
const endDrag = (ev) => {
  if (!drag) return;
  ev.stopImmediatePropagation();
  if (!drag.moved && !drag.handle) section({ pivot: drag.hit.toArray() });     // a click on a cut face: bring the gizmo here
  drag = null; controls.enabled = true; canvas.style.cursor = ''; label.hidden = true;
  try { canvas.releasePointerCapture(ev.pointerId); } catch {}
};
canvas.addEventListener('pointerup', endDrag, true);
canvas.addEventListener('pointercancel', endDrag, true);
canvas.addEventListener('dblclick', (ev) => {
  const ndc = toNDC(ev);
  if (handleUnder(ndc) || !capUnder(ndc)) return;
  ev.stopImmediatePropagation();
  section({ flip: !st.flip });
}, true);

$('#sec-on').onchange = (e) => section({ on: e.target.checked });
$('#sec-axis').onchange = (e) => { st.axis = e.target.value; st.rot = [0, 0]; const [lo, hi] = range(); section({ mm: st.mm >= lo && st.mm <= hi ? st.mm : (lo + hi) / 2 }); };
const rotInput = (k) => (e) => { const r = [...st.rot]; r[k] = +e.target.value || 0; section({ rot: r }); };
$('#sec-rot-a').onchange = rotInput(0); $('#sec-rot-b').onchange = rotInput(1);
$('#sec-rot-reset').onclick = () => section({ rot: [0, 0] });
$('#sec-flip').onchange = (e) => section({ flip: e.target.checked });
$('#sec-pos').oninput = (e) => section({ mm: +e.target.value, on: true });
$('#sec-mm').onchange = (e) => section({ mm: +e.target.value, on: true });
bus.addEventListener('parts', () => { if (st.on) apply(); else syncUI(); });   // new meshes get the plane too
syncUI();
