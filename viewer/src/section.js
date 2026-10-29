// Section: one clipping plane through the parts, after Shapr3D's section view: a toggle (the left rail's Section, or s)
// that remembers its plane, the gizmo on the plane (an arrow slides it, two rings turn it), by gestures on a cut face
// (drag slides it, click moves the gizmo there, double-click flips it), or from
// window.viewer.section({ on, axis, mm, flip, rot: [a, b], pivot: [x, y, z] }). three's local clipping on the
// part (and ghost) materials, so the grid, reference overlays and annotations stay whole. Remembered per
// model in localStorage.
//
// The first time it is turned on for a model (nothing remembered) it asks which plane: the three origin planes
// show through the middle of the parts, tinted for their normal axis; click one, or click a part's face to cut
// along that face with the part's side kept. Badges beside the gizmo flip the kept side, turn the camera to
// look straight at the cut, ask for another plane, and (when tilted) square it up again. The tool card shows the
// plane and an mm field. window.viewer.section never asks.
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
import { createElement, FlipVertical2, Focus, Replace, RotateCcw } from 'lucide';
import { MODEL } from './api.js';
import { scene, renderer, canvas, controls, view, bus, bounds, frameHooks, toNDC, raycast, pickFilters, project, orbitTo } from './scene.js';
import { meshes, visibleMeshes, allMaterials } from './parts.js';
import { token, numToken, axisColors } from './tokens.js';

const $ = (s) => document.querySelector(s);
renderer.localClippingEnabled = true;
const AX = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
const KEY = `section:${MODEL}`;
let chosen = localStorage.getItem(`section:${MODEL}`) !== null;    // a plane has been picked for this model
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
const lastPlane = new THREE.Plane(), partBox = new THREE.Box3();
let lastOn = null;
const boxOf = (geo) => geo.boundingBox ?? (geo.computeBoundingBox(), geo.boundingBox);
function syncCaps() {
  const b = bounds(), c = b.getCenter(new THREE.Vector3()), size = b.getSize(new THREE.Vector3()).length() * 1.1;
  const n = normal(), p = pivot();
  // the quad sits on the plane under the middle of the parts, not at the pivot: the gizmo can be dragged
  // far off the parts, and a quad centred there stops short of the far side of the cut
  const mid = c.addScaledVector(n, -n.dot(c.clone().sub(p)));
  // clipShadows: the shadow map depends on the plane (shading.js renders it only on demand)
  if (!lastPlane.equals(plane) || lastOn !== st.on) { lastPlane.copy(plane); lastOn = st.on; renderer.shadowMap.needsUpdate = true; }
  let k = 0;
  for (const [name, mesh] of meshes) {
    const cp = caps.get(name) ?? makeCap(name, mesh, k);
    if (cp.i !== k) order(cp, k);
    // only a part the plane passes through needs its stencil passes and cap: one wholly on the kept side draws
    // back and front for a net count of 0, one wholly on the cut side is clipped away. Both are a full extra
    // draw of the part, twice (the reference parts here are 1.4 M triangles).
    const on = st.on && mesh.visible && plane.intersectsBox(partBox.copy(boxOf(mesh.geometry)).applyMatrix4(mesh.matrixWorld));
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
  if (st.on) chosen = true;
  syncUI();
}

const PLANE = { X: 'YZ', Y: 'XZ', Z: 'XY' };
function syncUI() {
  $('#sec-read').hidden = !st.on || picking; $('#sec-hint').hidden = !picking;
  $('#sec-plane').textContent = PLANE[st.axis] + (tilted() ? '∠' : '');
  $('#sec-read').title = `${PLANE[st.axis]} plane${tilted() ? `, tilted ${st.rot.map((a) => +a.toFixed(1)).join('° / ')}° about ${'XYZ'[(axisIndex() + 1) % 3]} / ${'XYZ'[(axisIndex() + 2) % 3]}` : ''}, keeping ${st.axis} ${st.flip ? '≥' : '≤'} the cut`;
  $('#sec-mm').value = +st.mm.toFixed(2);
  $('#sec-flip').classList.toggle('on', st.flip);
  $('#sec-untilt').hidden = !tilted();
  bus.dispatchEvent(new Event('ui'));     // the rails show the section
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
//   knob    a puck lying in the plane at the pivot: drag to move the gizmo across the plane (the plane stays;
//           the arcs then turn about the new spot)
//   arrow   double-headed, along the normal: drag to slide the plane
//   arcs    one per in-plane axis, a quarter turn with arrowheads standing up off the plane on the camera's
//           side (mirrored each frame, so the two never stack behind each other): drag along it
//           to turn the plane about that axis. The angle comes from where the pointer ray meets the arc's
//           own plane, so it is a pure function of the pointer position (no drift; letting go and re-grabbing
//           continues exactly). Snaps to 1°, alt 0.1°, ctrl 15°.
// Colours are the skin's axis tokens (--axis-x/y/z): the arrow for the base axis it slides along, each arc for
// the axis it turns about (they keep those once the plane tilts); the knob is --gizmo-knob, and every stroke
// has an additive halo of --gizmo-glow strength. While a drag runs a faint square (--gizmo-plane) with a cross
// shows the whole plane, so a tilt reads even where no cap is in view, and a label by the pointer shows the value.
const GIZMO_PX = 64;
const WHITE = new THREE.Color(0xffffff);                                  // arc radius on screen
const look = { axis: axisColors(), knob: 0xe8e8e8, plane: 0xffd166, glow: 0.15 };
function readLook() {
  look.axis = axisColors();
  look.knob = token('--gizmo-knob', '#e8e8e8').hex; look.plane = token('--gizmo-plane', '#ffd166').hex;
  look.glow = numToken('--gizmo-glow', 0.15);
}
// double-sided: the arcs are mirrored (negative scale) to face the camera
const onTop = (opacity = 1) => new THREE.MeshBasicMaterial({ transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
const glowMat = () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
const pickMat = () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false, colorWrite: false, side: THREE.DoubleSide });
const gizmo = new THREE.Group();
// a handle: its visible strokes (each with a fatter halo behind it) and an invisible, fatter pick mesh
function handle(kind, parts, pickGeo, extra = {}) {
  const g = new THREE.Group(), mats = [], halos = [];
  for (const { geo, halo, at } of parts) {
    const m = new THREE.Mesh(geo, onTop()); mats.push(m.material);
    const items = [m];
    if (halo) { const h = new THREE.Mesh(halo, glowMat()); halos.push(h.material); items.push(h); }
    for (const o of items) { if (at) at(o); g.add(o); }
  }
  const pick = new THREE.Mesh(pickGeo, pickMat()); pick.userData.handle = g; g.add(pick);
  g.userData = { handle: kind, mats, halos, color: 0xffffff, ...extra };
  return g;
}
const ARC = [THREE.MathUtils.degToRad(10), THREE.MathUtils.degToRad(72)];    // the turn shown, from the plane up (short of the arrow at 90°)
function arc(axisLocal) {
  // the torus lies in its own XY from angle 0; the group turns that plane onto the one the arc lives in, and
  // the arc spans ARC up from the in-plane axis toward the normal, clear of the arrow
  const span = ARC[1] - ARC[0], start = (axisLocal === 'x' ? Math.PI / 2 : 0) + ARC[0];
  const spin = (o) => { o.rotation.z = start; };
  const tip = (end) => {        // an arrowhead at one end of the arc, pointing along it
    const a = end ? start + span : start, dir = end ? 1 : -1;
    const geo = new THREE.ConeGeometry(0.1, 0.26, 16).translate(0, 0.08, 0);
    return { geo, at: (o) => { o.position.set(Math.cos(a), Math.sin(a), 0); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-Math.sin(a) * dir, Math.cos(a) * dir, 0)); } };
  };
  const g = handle('ring', [
    { geo: new THREE.TorusGeometry(1, 0.035, 8, 48, span), halo: new THREE.TorusGeometry(1, 0.12, 8, 48, span), at: spin },
    tip(false), tip(true),
  ], new THREE.TorusGeometry(1, 0.2, 6, 24, span + 0.3).rotateZ(-0.15), { axisLocal });
  g.children.at(-1).rotation.z = start;
  if (axisLocal === 'x') g.rotation.y = Math.PI / 2; else g.rotation.x = Math.PI / 2;
  return g;
}
function arrow() {
  const shaft = (sgn) => ({ geo: new THREE.CylinderGeometry(0.035, 0.035, 0.95, 10).translate(0, sgn * 0.78, 0), halo: new THREE.CylinderGeometry(0.11, 0.11, 0.95, 10).translate(0, sgn * 0.78, 0) });
  const cone = (sgn) => ({ geo: new THREE.ConeGeometry(0.13, 0.34, 20).translate(0, 1.42, 0).rotateZ(sgn > 0 ? 0 : Math.PI) });
  const g = handle('arrow', [shaft(1), shaft(-1), cone(1), cone(-1)], new THREE.CylinderGeometry(0.22, 0.22, 3.3, 8));
  g.rotation.x = Math.PI / 2;      // cylinders run along Y; the normal is local Z
  return g;
}
function knob() {
  return handle('centre', [
    { geo: new THREE.TorusGeometry(0.2, 0.03, 8, 40), halo: new THREE.TorusGeometry(0.2, 0.09, 8, 40) },
    { geo: new THREE.SphereGeometry(0.075, 16, 12) },
  ], new THREE.SphereGeometry(0.32, 8, 6));
}
const handles = { centre: knob(), ringX: arc('x'), ringY: arc('y'), arrow: arrow() };
// each arc sits in a wrapper the frame hook mirrors in the gizmo's own axes
const mirror = { x: new THREE.Group().add(handles.ringX), y: new THREE.Group().add(handles.ringY) };
gizmo.add(handles.centre, mirror.x, mirror.y, handles.arrow);
const outline = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([
  [-0.5, -0.5], [0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [0.5, 0.5], [-0.5, 0.5], [-0.5, 0.5], [-0.5, -0.5], [-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5],
].map(([x, y]) => new THREE.Vector3(x, y, 0))), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35, depthTest: false }));
// while picking, a see-through sheet fills it, so the preview reads where it slices through the parts
const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
outline.add(sheet);
gizmo.renderOrder = outline.renderOrder = 1000;
gizmo.traverse((o) => { o.renderOrder = 1000; });
scene.add(gizmo, outline);
// the origin planes offered while picking: through the middle of the parts, a little bigger than them, tinted
// for their normal axis
const origin = new THREE.Group();
for (const axis of 'XYZ') {
  const i = 'XYZ'.indexOf(axis);
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
  const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, y]) => new THREE.Vector3(x, y, 0))),
    new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5 }));
  edge.raycast = () => {};
  fill.add(edge); fill.userData = { originAxis: axis, edge };
  const e = (n) => new THREE.Vector3().setComponent(n % 3, 1);      // local x, y on the next two axes, z the normal
  fill.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(e(i + 1), e(i + 2), e(i)));
  fill.renderOrder = edge.renderOrder = 999;
  origin.add(fill);
}
origin.visible = false; scene.add(origin);
// the skin's colours onto everything that does not change per frame
function dress() {
  readLook();
  for (const m of origin.children) { const c = look.axis['XYZ'.indexOf(m.userData.originAxis)]; m.material.color.setHex(c); m.userData.edge.material.color.setHex(c); }
  outline.material.color.setHex(look.plane); sheet.material.color.setHex(look.plane);
  handles.centre.userData.color = look.knob;
}
bus.addEventListener('skin', dress);
dress();
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
let picking = false;   // asking which plane to cut along
let preview = null;    // { p, n }: the face a click would cut along, drawn as the outline while picking
let hotPlane = null;   // the origin plane under the pointer while picking
const badges = $('#sec-badges');
frameHooks.add(() => {
  gizmo.visible = st.on && !picking && meshes.size > 0;
  origin.visible = picking;
  if (picking) {
    const b = bounds(), c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3()).multiplyScalar(1.2);
    for (const m of origin.children) {
      const i = 'XYZ'.indexOf(m.userData.originAxis), j = (i + 1) % 3, k = (i + 2) % 3;
      m.position.copy(c); m.scale.set(Math.max(5, sz.getComponent(j)), Math.max(5, sz.getComponent(k)), 1);
      const hot = hotPlane === m.userData.originAxis;
      m.material.opacity = hot ? 0.3 : 0.08; m.userData.edge.material.opacity = hot ? 1 : 0.5;
    }
  }
  outline.visible = (gizmo.visible && !!drag) || (picking && !!preview);
  sheet.visible = picking; outline.material.opacity = picking ? 0.8 : 0.35;
  badges.hidden = !gizmo.visible || !!drag;
  if (preview && picking) {
    outline.position.copy(preview.p); outline.lookAt(preview.p.clone().add(preview.n));
    outline.scale.setScalar(bounds().getSize(new THREE.Vector3()).length() * 1.1);
  }
  if (!gizmo.visible) return;
  const p = pivot(), i = axisIndex();
  const at = project(p);      // the badges sit just right of the rings
  if (!at.inFront) badges.hidden = true;
  else { badges.style.left = Math.round(Math.min(at.u * canvas.clientWidth + GIZMO_PX + 18, canvas.clientWidth - 40)) + 'px'; badges.style.top = Math.round(at.v * canvas.clientHeight - badges.offsetHeight / 2) + 'px'; }   // whole px: a 1 px ring on a half pixel smears
  gizmo.position.copy(p); gizmo.quaternion.copy(frameQuat()); gizmo.scale.setScalar(GIZMO_PX * mmPerPixel(p));
  // which side of each axis the camera is on, in the gizmo's frame; the arcs stand up toward it
  const cam = view.camera.position.clone().sub(p).applyQuaternion(gizmo.quaternion.clone().invert());
  const side = (v) => (v < 0 ? -1 : 1);
  if (!drag) { mirror.x.scale.set(1, side(cam.y), side(cam.z)); mirror.y.scale.set(side(cam.x), 1, side(cam.z)); }
  handles.arrow.userData.color = look.axis[i];
  handles.ringX.userData.color = look.axis[(i + 1) % 3];
  handles.ringY.userData.color = look.axis[(i + 2) % 3];
  // at rest a touch dim; under the pointer or in a drag: lifted toward white, a stronger halo, a little bigger
  for (const h of Object.values(handles)) {
    const u = h.userData, hot = drag?.handle === h || (!drag && hover === h), idle = !!drag && !hot;
    const c = new THREE.Color(u.color); if (hot) c.lerp(WHITE, 0.35);
    for (const m of u.mats) { m.color.copy(c); m.opacity = idle ? 0.25 : hot ? 1 : 0.85; }
    for (const m of u.halos) { m.color.copy(c); m.opacity = idle ? 0 : look.glow * (hot ? 2.2 : 1); }
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
let pickDown = null;
canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0 || ev.metaKey) return;
  if (picking) { pickDown = { x: ev.clientX, y: ev.clientY }; return; }     // a click picks a face; a drag still orbits
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
  if (picking) {
    if (ev.buttons) return;
    const u = pickUnder(toNDC(ev)), tip = $('#tip');
    hotPlane = u?.axis ?? null;
    preview = u && !u.axis ? { p: u.hit.point.clone(), n: faceNormal(u.hit) } : null;
    if (u) {
      ev.stopImmediatePropagation(); canvas.style.cursor = 'crosshair';
      tip.hidden = false; tip.style.left = ev.offsetX + 14 + 'px'; tip.style.top = ev.offsetY + 14 + 'px';
      tip.textContent = u.axis ? `${PLANE[u.axis]} plane` : `along this face of ${u.hit.object.userData.name}`;
    } else { if (canvas.style.cursor === 'crosshair') canvas.style.cursor = ''; tip.hidden = true; }
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
  if (picking && pickDown) {
    const click = Math.hypot(ev.clientX - pickDown.x, ev.clientY - pickDown.y) <= 4; pickDown = null;
    const u = click && pickUnder(toNDC(ev));
    if (u) { ev.stopImmediatePropagation(); $('#tip').hidden = true; u.axis ? pickAxis(u.axis) : cutAlong(u.hit); }      // and the part picker does not select it
    return;
  }
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

// ---------- picking the plane ----------
// the face's outward normal, in world space (parts have no transform, but say so anyway)
// the nearest origin plane or visible part face under the pointer: { axis, hit } or { hit }
function pickUnder(ndc) {
  const hit = raycast(ndc, [...visibleMeshes(), ...origin.children]);
  return hit ? { axis: hit.object.userData.originAxis, hit } : null;
}
const faceNormal = (hit) => hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
// cut along the face under a hit: base axis is the normal's largest component, the tilt makes up the rest, the
// part's side (behind the face) is kept, and the gizmo sits where the face was clicked
function cutAlong(hit) {
  const k = faceNormal(hit).negate(), i = [0, 1, 2].reduce((a, b) => (Math.abs(k.getComponent(b)) > Math.abs(k.getComponent(a)) ? b : a));
  st.axis = 'XYZ'[i]; st.flip = k.getComponent(i) > 0;
  const rot = anglesFor(k).map((a) => (Math.abs(a) < 0.01 ? 0 : +a.toFixed(2)));
  endPick();
  section({ on: true, rot, pivot: hit.point.toArray() });
}
function pickAxis(axis) {          // an origin plane: that axis, untilted, through the middle of the parts
  endPick();
  st.axis = axis; st.pivot = null;
  section({ on: true, rot: [0, 0], mm: bounds().getCenter(new THREE.Vector3()).getComponent(axisIndex()) });
}
function startPick() { picking = true; preview = null; hotPlane = null; syncUI(); }
function endPick() {
  if (!picking) return;
  picking = false; preview = null; hotPlane = null; pickDown = null; $('#tip').hidden = true;
  if (canvas.style.cursor === 'crosshair') canvas.style.cursor = '';
  syncUI();
}
// s and the rail's Section: off if on; on with the remembered plane, or ask for one the first time (while asking:
// stop asking)
export function toggleSection() {
  if (picking) endPick();
  else if (st.on) section({ on: false });
  else if (chosen) section({ on: true });
  else startPick();
}
// Esc while asking stops asking (a cut that was on stays on)
export function sectionKey(e) {
  if (!picking || e.key !== 'Escape') return false;
  endPick();
  return true;
}

// ---------- the rails' Section entry and its group (rails.js), the badges, the card's readout ----------
export const SECTION_HELP = 'section view (s)\ngizmo: the arrow slides the cut, the rings tilt it, the knob moves the gizmo\ncut face: drag slides, click moves the gizmo there, double-click flips\nalt = fine steps (0.1 mm, 0.1°), ctrl on a ring = 15°';
export const sectionUI = () => ({ on: st.on, picking, plane: PLANE[st.axis] + (tilted() ? '∠' : ''), mm: +st.mm.toFixed(2), flip: st.flip, tilted: tilted() });
export const flipSection = () => section({ flip: !st.flip });
export const lookAtCut = () => orbitTo(normal().negate().toArray(), { fit: true });
export const replaneSection = () => startPick();
export const untiltSection = () => section({ rot: [0, 0] });
// the badges' icons: the same lucide marks as the rail's Section group (rails.js); the old text glyphs were not
// in the skin's font and fell back to a thin system face
for (const [id, icon] of [['sec-flip', FlipVertical2], ['sec-look', Focus], ['sec-replane', Replace], ['sec-untilt', RotateCcw]]) $('#' + id).replaceChildren(createElement(icon));
$('#sec-flip').onclick = flipSection;
$('#sec-look').onclick = lookAtCut;
$('#sec-replane').onclick = replaneSection;
$('#sec-untilt').onclick = untiltSection;
$('#sec-mm').onchange = (e) => section({ mm: +e.target.value, on: true });
bus.addEventListener('parts', () => { if (st.on) apply(); else syncUI(); });   // new meshes get the plane too
syncUI();
