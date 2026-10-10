// Shading: the switches that keep a grey-on-grey render readable. Remembered per model in localStorage,
// window.viewer.shading({ shadows, edges, headlight }) from the Chrome tools.
//   shadows   the key light casts shadows (PCF soft map); its orthographic shadow camera is refitted to the
//             visible parts before every frame so the map is never wasted on empty space. Clipped-away
//             geometry does not cast (clipShadows), so a section reads as an open box, not a lidded one.
//   edges     dark lines along creases sharper than EDGE_DEG on every part, rebuilt when a part rebuilds.
//             They share the part's clipping plane through parts.allMaterials().
//   headlight the fill light rides with the camera, so whatever faces you is lit even inside the shadow.
import * as THREE from 'three';
import { MODEL } from './api.js';
import { renderer, lights, view, controls, bounds, bus, frameHooks } from './scene.js';
import { meshes } from './parts.js';

const $ = (s) => document.querySelector(s);
const KEY = `shading:${MODEL}`;
export const st = Object.assign({ shadows: true, edges: true, headlight: true }, JSON.parse(localStorage.getItem(KEY) ?? '{}'));
const EDGE_DEG = 30;
const EDGE_COLOR = 0x0c0e12;

renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const { key, fill, hemi } = lights;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0005;
key.shadow.normalBias = 0.6;          // mm; lifts the sample off the surface so flat faces don't stripe
const keyDir = key.position.clone().normalize();

// ---------- per-frame: shadow camera fit + headlight ----------
const lastFit = new THREE.Box3();
function fitShadow() {
  const b = bounds();
  if (b.equals(lastFit)) return;
  lastFit.copy(b);
  const c = b.getCenter(new THREE.Vector3()), r = b.getSize(new THREE.Vector3()).length() / 2;
  key.position.copy(c).addScaledVector(keyDir, 2 * r);
  key.target.position.copy(c);
  const cam = key.shadow.camera;
  cam.left = cam.bottom = -r; cam.right = cam.top = r; cam.near = 0.1; cam.far = 4 * r;
  cam.updateProjectionMatrix();
}
frameHooks.add(() => {
  if (st.shadows) fitShadow();
  if (st.headlight) { fill.position.copy(view.camera.position); fill.target.position.copy(controls.target); }   // lights along the view
});

// ---------- edges ----------
function edgesFor(mesh) {
  let e = mesh.children.find((c) => c.userData.edges);
  if (e && e.userData.geo === mesh.geometry) return e;
  if (e) { e.geometry.dispose(); mesh.remove(e); }
  const mat = new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.75, clippingPlanes: mesh.material.clippingPlanes });
  e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, EDGE_DEG), mat);
  e.userData.edges = true; e.userData.geo = mesh.geometry; e.raycast = () => {};
  mesh.add(e);
  return e;
}
function syncParts() {
  for (const m of meshes.values()) {
    m.castShadow = m.receiveShadow = st.shadows;
    m.material.clipShadows = true;
    if (st.edges) edgesFor(m).visible = true;
    else { const e = m.children.find((c) => c.userData.edges); if (e) e.visible = false; }
  }
}

function apply() {
  renderer.shadowMap.enabled = st.shadows;
  key.castShadow = st.shadows;
  // shadows carry the depth cue, so the ambient can come down and the key can come up
  hemi.intensity = st.shadows ? 0.7 : 1.1;
  key.intensity = st.shadows ? 1.7 : 1.4;
  fill.intensity = st.headlight ? 0.45 : 0.5;
  if (!st.headlight) { fill.position.set(-80, 60, -40); fill.target.position.set(0, 0, 0); }
  lastFit.makeEmpty();
  syncParts();
  for (const m of meshes.values()) m.material.needsUpdate = true;    // shadow map on/off recompiles
  localStorage.setItem(KEY, JSON.stringify(st));
  $('#sh-shadows').checked = st.shadows; $('#sh-edges').checked = st.edges; $('#sh-headlight').checked = st.headlight;
}
export function shading(opts = {}) {
  for (const k of ['shadows', 'edges', 'headlight']) if (opts[k] !== undefined) st[k] = !!opts[k];
  apply();
  console.log(`[viewer] shading ${JSON.stringify(st)}`);
  return { ...st };
}
$('#sh-shadows').onchange = (e) => shading({ shadows: e.target.checked });
$('#sh-edges').onchange = (e) => shading({ edges: e.target.checked });
$('#sh-headlight').onchange = (e) => shading({ headlight: e.target.checked });
bus.addEventListener('parts', syncParts);     // new or rebuilt meshes get shadows and fresh edges
apply();
