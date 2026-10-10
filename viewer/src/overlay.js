// A reference image as a textured plane in the scene, for tracing profiles and checking shapes against photos.
//
// Placement (one overlay object in annotations.json `overlays[]`):
//   image pixel `originPx` (x right, y down) sits at plane point (0, 0); image right = the plane's first axis,
//   image up = its second axis, scaled by `mmPerPx`, rotated `rot` deg CCW about the origin, flipped first.
//   plane XY: axes (x, y), `offset` on z.   XZ: (x, z), offset on y.   YZ: (y, z), offset on x.
// Scene graph per overlay: pivot (plane basis * Rz(rot), at offset) -> flip (scale +-1) -> mesh (plane, shifted so
// the origin pixel sits on the pivot). Calibration clicks read the exact image pixel from the ray-cast's uv.
import * as THREE from 'three';
import { scene, bus, raycast, setOrtho, fitView, controls, view, renderer } from './scene.js';
import { refUrl, putOverlay, deleteOverlay } from './api.js';
import { onPlace, findRef } from './refs.js';
import { onDoc, doc, registerTool, setTool, setPointSource, askText, scheduleRedraw } from './annotate.js';

const $ = (s) => document.querySelector(s);
const r3 = (v) => Math.round(v * 1000) / 1000, r4 = (v) => Math.round(v * 10000) / 10000;
const textures = new Map();                 // image name -> Texture
const nodes = new Map();                    // overlay id -> { pivot, flip, mesh, json }
let current = null;                         // the overlay the panel edits (an object from doc.overlays)
const PLANE_AXES = { XY: [0, 1], XZ: [0, 2], YZ: [1, 2] };
const NORMAL_AXIS = { XY: 2, XZ: 1, YZ: 0 };
const FACE_VIEW = { XY: 'top', XZ: 'front', YZ: 'side' };

async function texture(name) {
  if (!textures.has(name)) {
    const tex = await new THREE.TextureLoader().loadAsync(refUrl(name));
    tex.colorSpace = THREE.SRGBColorSpace;             // photos render too bright without this (r152+)
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    textures.set(name, tex);
  }
  return textures.get(name);
}

const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
const qX90 = new THREE.Quaternion().setFromAxisAngle(X, Math.PI / 2), qZ90 = new THREE.Quaternion().setFromAxisAngle(Z, Math.PI / 2);
const basis = (plane) => {
  if (plane === 'XZ') return qX90.clone();                          // local y -> Z, normal -Y
  if (plane === 'YZ') return qZ90.clone().multiply(qX90);           // Rx(90) then Rz(90): local x -> Y, y -> Z, normal +X
  return new THREE.Quaternion();
};
// local (in-plane) position of image pixel (px, py): the plane geometry is centred, image top is +y
const local = (o, px, py) => new THREE.Vector3((px - o.sizePx[0] / 2) * o.mmPerPx, (o.sizePx[1] / 2 - py) * o.mmPerPx, 0);

async function build(o) {
  let n = nodes.get(o.id);
  const tex = await texture(o.image);
  if (!n) {
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false,
                                              polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.renderOrder = -1; mesh.userData.overlay = o.id;
    const flip = new THREE.Object3D(); flip.add(mesh);
    const pivot = new THREE.Object3D(); pivot.add(flip); scene.add(pivot);
    n = { pivot, flip, mesh, json: null }; nodes.set(o.id, n);
  }
  const [w, h] = o.sizePx, s = o.mmPerPx;
  n.mesh.geometry.dispose(); n.mesh.geometry = new THREE.PlaneGeometry(w * s, h * s);
  n.mesh.position.copy(local(o, ...o.originPx)).negate();
  n.mesh.material.opacity = o.opacity ?? 0.5; n.mesh.material.depthTest = !o.onTop; n.mesh.material.map = tex;
  n.flip.scale.set(o.flipX ? -1 : 1, o.flipY ? -1 : 1, 1);
  n.pivot.quaternion.copy(basis(o.plane)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(o.rot ?? 0)));
  n.pivot.position.set(0, 0, 0); n.pivot.position.setComponent(NORMAL_AXIS[o.plane], o.offset ?? 0);
  n.pivot.visible = o.visible !== false;
  n.pivot.updateMatrixWorld(true);
  n.json = JSON.stringify(o);
  bus.dispatchEvent(new Event('camera'));           // annotations re-project over the new plane
}
function remove(id) {
  const n = nodes.get(id); if (!n) return;
  scene.remove(n.pivot); n.mesh.geometry.dispose(); n.mesh.material.dispose(); nodes.delete(id);
}

// keep the scene in step with doc.overlays (the server's file)
onDoc((d) => {
  for (const id of [...nodes.keys()]) if (!d.overlays.find((o) => o.id === id)) remove(id);
  for (const o of d.overlays) if (nodes.get(o.id)?.json !== JSON.stringify(o)) build(o).catch((e) => console.warn('[viewer] overlay', o.image, e.message));
  if (current && !d.overlays.find((o) => o.id === current.id)) current = null;
  if (!current && d.overlays.length) current = d.overlays.at(-1);
  else if (current) current = d.overlays.find((o) => o.id === current.id);
  renderPanel();
});

// ---------- placing from the gallery ----------
onPlace(async (ref) => {
  const tex = await texture(ref.name);
  const [w, h] = [tex.image.naturalWidth ?? tex.image.width, tex.image.naturalHeight ?? tex.image.height];
  const scale = ref.scale?.px?.length === 2 && ref.scale.mm ? ref.scale : null;
  const mmPerPx = scale ? r4(scale.mm / Math.hypot(scale.px[1][0] - scale.px[0][0], scale.px[1][1] - scale.px[0][1])) : r4(100 / Math.max(w, h));
  const o = { image: ref.name, sizePx: [w, h], plane: PLANE_AXES[ref.view] ? ref.view : 'XZ', offset: 0, mmPerPx,
              originPx: scale ? scale.px[0] : [Math.round(w / 2), Math.round(h / 2)], rot: 0, flipX: false, flipY: false,
              opacity: 0.5, visible: true, onTop: false, calib: scale ? { px: scale.px, mm: scale.mm } : null, caption: ref.caption ?? null };
  const r = await putOverlay('new', o);
  console.log(`[viewer] overlay ${o.image} ${o.plane} mm/px=${o.mmPerPx} origin=[${o.originPx}] -> ${r.id}`);
  current = { ...o, id: r.id };
});

// ---------- panel ----------
let saveTimer = null;
function save() {
  if (!current) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => putOverlay(current.id, current), 300);
  build(current); renderPanel();
}
const field = (id, key, parse = (v) => v) => { $(id).oninput = () => { if (!current) return; current[key] = parse($(id).value); save(); }; };
field('#ov-plane', 'plane'); field('#ov-offset', 'offset', Number); field('#ov-mmpx', 'mmPerPx', Number); field('#ov-rot', 'rot', Number); field('#ov-opacity', 'opacity', Number);
for (const [id, key] of [['#ov-visible', 'visible'], ['#ov-flipx', 'flipX'], ['#ov-flipy', 'flipY'], ['#ov-ontop', 'onTop']])
  $(id).onchange = () => { if (!current) return; current[key] = $(id).checked; save(); };
$('#ov-remove').onclick = () => { if (current) { console.log(`[viewer] overlay ${current.id} removed`); deleteOverlay(current.id); } };
$('#ov-name').onchange = () => { const id = $('#ov-name').value; $('#ov-name').blur(); select(id); };
$('#ov-face').onclick = () => { if (!current) return; setOrtho(true); fitView(FACE_VIEW[current.plane]); frame(); };
$('#ov-fit').onclick = frame;
$('#ov-calib').onclick = () => setTool('calib');
$('#ov-origin').onclick = () => setTool('origin');

function renderPanel() {
  const p = $('#ov-panel'); p.hidden = !current;
  for (const f of document.querySelectorAll('#gallery figure')) f.classList.toggle('on', !!current && f.dataset.name === current.image);
  if (!current) return;
  const o = current;
  $('#ov-name').innerHTML = doc.overlays.map((x) => `<option value="${x.id}" ${x.id === o.id ? 'selected' : ''}>${x.id} · ${x.image}</option>`).join('');
  if (document.activeElement?.closest('#ov-panel')) return;      // don't clobber the field being typed in
  $('#ov-plane').value = o.plane; $('#ov-offset').value = o.offset ?? 0; $('#ov-mmpx').value = o.mmPerPx; $('#ov-rot').value = o.rot ?? 0;
  $('#ov-opacity').value = o.opacity ?? 0.5; $('#ov-visible').checked = o.visible !== false;
  $('#ov-flipx').checked = !!o.flipX; $('#ov-flipy').checked = !!o.flipY; $('#ov-ontop').checked = !!o.onTop;
  $('#ov-info').textContent = `${o.sizePx[0]} x ${o.sizePx[1]} px = ${(o.sizePx[0] * o.mmPerPx).toFixed(1)} x ${(o.sizePx[1] * o.mmPerPx).toFixed(1)} mm` +
    `\norigin px [${o.originPx.map(Math.round)}] at (0, 0)` + (o.calib ? `\ncalibrated: ${o.calib.mm} mm between px [${o.calib.px[0].map(Math.round)}] and [${o.calib.px[1].map(Math.round)}]` : '\nnot calibrated: use Calibrate');
}

// frame the current overlay (fit() only knows the parts)
function frame() {
  const n = current && nodes.get(current.id); if (!n) return;
  const b = new THREE.Box3().setFromObject(n.mesh), c = b.getCenter(new THREE.Vector3()), hp = b.getSize(new THREE.Vector3()).length() / 2 * 1.05;
  const cam = view.camera, d = cam.position.clone().sub(controls.target).normalize();
  controls.target.copy(c); cam.position.copy(c).addScaledVector(d, hp / Math.tan(THREE.MathUtils.degToRad(20)));
  if (cam.isOrthographicCamera) { cam.zoom = 100 / hp; cam.updateProjectionMatrix(); }
  controls.update(); bus.dispatchEvent(new Event('camera'));
}

// ---------- picking on the plane ----------
// ndc -> { point (world), px, py (image pixels), plane, overlay } for the current overlay, or null
export function intersect(ndc) {
  const n = current && nodes.get(current.id); if (!n || !n.pivot.visible) return null;
  const h = raycast(ndc, [n.mesh]); if (!h) return null;
  const px = h.uv.x * current.sizePx[0], py = (1 - h.uv.y) * current.sizePx[1];
  const p = h.point.clone(); p.setComponent(NORMAL_AXIS[current.plane], current.offset ?? 0);   // exactly on the plane
  return { point: p, px, py, plane: current.plane, overlay: current.id };
}
setPointSource((ndc) => intersect(ndc));

// calibrate: two clicks on the image, then the real distance between them
let calibA = null;
registerTool('calib', {
  hint: 'click two points on the image whose distance you know',
  up: async (c) => {
    const h = intersect(c.ndc); if (!h) return;
    if (!calibA) { calibA = [h.px, h.py]; $('#tool-hint').textContent = 'now the second point'; return; }
    const b = [h.px, h.py], dpx = Math.hypot(b[0] - calibA[0], b[1] - calibA[1]);
    const mm = parseFloat(await askText(c.u, c.v, 'distance in mm'));
    if (mm > 0 && dpx > 0) {
      current.mmPerPx = r4(mm / dpx); current.calib = { px: [calibA.map(r3), b.map(r3)], mm };
      console.log(`[viewer] calib ${dpx.toFixed(1)}px = ${mm}mm -> ${current.mmPerPx} mm/px`);
      save();
    }
    calibA = null; setTool('select');
  },
  cancel: () => { calibA = null; },
});
registerTool('origin', {
  hint: 'click the image point that sits at (0, 0)',
  up: (c) => {
    const h = intersect(c.ndc); if (!h) return;
    current.originPx = [r3(h.px), r3(h.py)];
    console.log(`[viewer] overlay ${current.image} origin=[${current.originPx}]`);
    save(); setTool('select');
  },
});

export const get = () => current;
export const set = (patch) => { if (current) { Object.assign(current, patch); save(); } };
export const list = () => doc.overlays;
export const select = (id) => { current = doc.overlays.find((o) => o.id === id) ?? current; renderPanel(); };
