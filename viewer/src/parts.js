// Parts: loading the STLs the server built, placing them as the scene says, the part list, hover/click picking,
// selection and the source panel.
//
// The scene (scene.json through the server's /scene; docs/SPEC-components-2026-11-14.md) is a list of placed parts,
// each addressed instance.part. One mesh per placed part, keyed by that path; one STL geometry per part name, loaded
// once and shared by every instance that shows it. A placement is a matrix (core/placement.ts, the same maths the
// core and _scene.scad use), so moving an instance never reloads a mesh. With no scene.json the scene is one
// instance at identity and the viewer looks as it always did: while there is one instance its id stays out of
// the UI (the list, the tip, hiddenParts() all say the bare part name); with more the list is grouped by instance.
// The list shows names and state only (failed, empty); triangle counts and build times are in the readout at the
// foot of the render (bounds.js), for whatever is selected.
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { placementMatrix, scaled } from '../../core/placement.ts';
import { app } from './app.js';
import { MODEL, partUrl, refStlUrl, getSource, getScene } from './api.js';
import { scene, group, canvas, fit, toNDC, raycast, bus, renderer } from './scene.js';
import { token } from './tokens.js';
import { renderParams, focusParams } from './params.js';
import { createElement, Eye, EyeOff, ChevronDown } from 'lucide';

const $ = (s) => document.querySelector(s);
const loader = new STLLoader();
const EYE = createElement(Eye).outerHTML, EYE_OFF = createElement(EyeOff).outerHTML, CHEVRON = createElement(ChevronDown).outerHTML;
const eye = (shown, title) => `<button class="eye" title="${title}">${shown ? EYE : EYE_OFF}</button>`;
export const meshes = new Map();      // instance.part -> mesh
const geos = new Map();               // part name -> { version, geo }: one STL, shared by every instance showing it
let ghost = null;
// paths (instance.part); a bare part name (stored before scenes) is read as that part in every instance
const hidden = new Set(JSON.parse(localStorage.getItem(`hidden:${MODEL}`) ?? '[]'));

async function loadMesh(url) {
  const geo = await loader.loadAsync(url);
  geo.computeVertexNormals();
  return geo;
}

// ---------- the scene ----------
// sceneSt: the server's last /scene ({ hash, exists, scene, parts, errors }); a write names its hash as the base.
// placed: the last scene that resolved without errors, so a bad hand edit shows its errors and keeps the parts
// where they were; before any good one, the default scene built here (one instance at identity).
let sceneSt = null, placed = null;
export const sceneState = () => sceneSt;
const partOf = (path) => path.slice(path.indexOf('.') + 1);
function placedParts() {
  if (placed) return placed;
  const id = MODEL.split('/').pop().replace(/[^A-Za-z0-9_-]/g, '_') || 'model';     // as core/scene.ts defaultScene
  return (app.state?.parts ?? []).map((p) => ({ path: `${id}.${p.name}`, instance: id, part: p.name, call: p.call, color: p.color,
    material: null, group: p.group, reference: p.reference, scratch: false, at: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], mirror: [0, 0, 0] }));
}
const instanceIds = () => [...new Set(placedParts().map((p) => p.instance))];
export const multiInstance = () => instanceIds().length > 1;
// what the UI calls a placed part: the bare part name while there is one instance, else instance.part
export const labelOf = (path) => (multiInstance() ? path : partOf(path));
// a name from outside (debug, a pushed view, an old note): a path, or a bare part name meaning it in every instance
const pathsFor = (name) => (name.includes('.') ? [name] : placedParts().filter((p) => p.part === name).map((p) => p.path));
// an instance's placement as a matrix (annotate.js puts a note's local points back where the instance is now)
export function instanceMatrix(id) {
  const p = placedParts().find((x) => x.instance === id);
  return p ? new THREE.Matrix4().fromArray(placementMatrix(p)) : null;
}

// Looks: an instance's material (scene.json "material") picks a preset; anything else is the default, matte PLA.
// The colour is the instance's, else the part's (the server resolves that).
const MATERIALS = {
  pla: { roughness: 0.55, metalness: 0.05 },
  petg: { roughness: 0.2, metalness: 0.05 },
  metal: { roughness: 0.3, metalness: 0.85, env: true },        // die-cast: needs something to reflect
  translucent: { roughness: 0.25, metalness: 0, opacity: 0.45 },
};
let envMap = null;
const roomEnv = () => (envMap ??= new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture);
function dress(m, pl) {
  const mat = m.material, name = MATERIALS[pl.material] ? pl.material : 'pla', look = MATERIALS[name];
  mat.color.set(pl.color);
  if (mat.userData.preset !== name) {
    mat.userData.preset = name;
    mat.roughness = look.roughness; mat.metalness = look.metalness;
    mat.envMap = look.env ? roomEnv() : null; mat.envMapIntensity = 0.8;
    mat.transparent = look.opacity != null; mat.opacity = look.opacity ?? 1; mat.depthWrite = !mat.transparent;
    mat.needsUpdate = true;
  }
  // polygonOffset pushes the surface back a hair so edge lines (shading.js) sit on top without z-fighting;
  // a reference part (manifest `reference: true`, a presence mesh the design is fitted to) goes back further,
  // so where its faces coincide with the design's the design wins instead of the two flickering as you orbit
  mat.polygonOffsetFactor = mat.polygonOffsetUnits = pl.reference ? 3 : 1;
}

// One mesh per placed part: made, re-dressed, re-placed, or dropped. Synchronous, from the geometries loaded so far.
function place() {
  const list = placedParts(), paths = new Set(list.map((p) => p.path));
  for (const [n, m] of meshes) if (!paths.has(n)) { group.remove(m); m.material.dispose(); meshes.delete(n); }
  // hidden names from before scenes (bare part names) become paths once
  const bare = [...hidden].filter((n) => !n.includes('.'));
  if (bare.length && placed) { for (const n of bare) { hidden.delete(n); for (const q of pathsFor(n)) hidden.add(q); } saveHidden(); }
  for (const pl of list) {
    const built = app.state?.parts.find((p) => p.name === pl.part), g = geos.get(pl.part);
    let m = meshes.get(pl.path);
    if (!g) { if (m) m.visible = false; continue; }
    if (!m) {
      m = new THREE.Mesh(g.geo, new THREE.MeshStandardMaterial({ polygonOffset: true }));
      m.matrixAutoUpdate = false;
      meshes.set(pl.path, m); group.add(m);
    } else if (m.geometry !== g.geo) m.geometry = g.geo;
    m.userData.name = pl.path; m.userData.label = labelOf(pl.path); m.userData.part = built; m.userData.placed = pl;
    dress(m, pl);
    m.matrix.fromArray(placementMatrix(pl)); m.matrixWorldNeedsUpdate = true; m.updateMatrixWorld();
    m.visible = !!built?.ok && !hidden.has(pl.path);
  }
  for (const g of geos.values()) if (g.old) { disposeGeo(g.old); delete g.old; }
}
// a geometry and what was built from it (the outline hull here, the edge lines in shading.js)
function disposeGeo(geo) { for (const k of ['hull', 'edges']) geo.userData[k]?.dispose(); geo.dispose(); }

// a scene from the server (GET /scene, or SSE 'scene' after the CLI, Claude or a hand edit): re-place, no mesh reload
export function setScene(st) {
  if (!st) return;
  takeScene(st);
  if (!app.state) return;
  place();
  if (app.selected && !meshes.has(app.selected)) app.selected = null;
  if (selectedGroup && !groupNames().includes(selectedGroup)) selectedGroup = null;
  renderPartList(); paint();
  bus.dispatchEvent(new Event('parts'));
}
function takeScene(st) {
  sceneSt = st;
  if (!st.errors?.length) placed = st.parts;
  console.log(`[viewer] scene ${st.hash}${st.exists ? '' : ' (default)'} ${st.parts?.length ?? 0} placed${st.errors?.length ? `, ${st.errors.length} error(s)` : ''}`);
  showStatus();
}
// Re-place one instance at once, without writing (a drag in progress): fields over what the scene says.
// The write is api.js patchInstance(id, fields, sceneState().hash); its SSE 'scene' lands through setScene.
export function previewInstance(id, fields) {
  for (const m of meshes.values()) {
    if (m.userData.placed?.instance !== id) continue;
    m.matrix.fromArray(placementMatrix({ ...m.userData.placed, ...fields })); m.matrixWorldNeedsUpdate = true; m.updateMatrixWorld();
  }
  bus.dispatchEvent(new Event('placed'));
}

// build errors and scene.json errors, in the same two places: the status line and the log
function showStatus() {
  const s = app.state, errs = sceneSt?.errors ?? [];
  if (!s) { if (errs.length) $('#status').textContent = `scene.json: ${errs[0]}`; return; }
  const build = s.error ? `error: ${s.error}` : `built ${new Date(s.builtAt).toLocaleTimeString()} in ${(s.buildMs / 1000).toFixed(1)}s`;
  $('#status').textContent = errs.length ? `${build} · scene.json: ${errs.length === 1 ? errs[0] : `${errs.length} errors, see the log`}` : build;
  $('#log').textContent = [...errs.map((e) => `scene.json: ${e}`), ...s.parts.map((p) => p.log).filter(Boolean)].join('\n') || 'no warnings';
}

export const visibleMeshes = () => [...meshes.values()].filter((m) => m.visible);
// every material a section plane should cut: the parts, their edge lines (shading.js) and the reference ghost
export const allMaterials = () => [...[...meshes.values()].flatMap((m) => [m.material, ...m.children.map((c) => c.material)]), ...(ghost ? [ghost.material] : [])];

export async function refresh(s) {
  app.state = s;
  console.log('[viewer] refresh, built', s.builtAt, 'overrides', JSON.stringify(s.overrides));
  // a breadcrumb: the model's path in the workspace (toy / assembly), then the file; it opens the model picker
  $('#title').innerHTML = `${MODEL.split('/').map((x) => `<span>${x}</span>`).join('<i>/</i>')}<i>/</i><span class="file">${s.file ?? '?'}</span><b>▾</b>`;
  const ovKeys = Object.keys(s.overrides ?? {});
  $('#override-banner').hidden = ovKeys.length === 0;
  $('#override-banner').textContent = ovKeys.length ? `⚠ overrides active: ${ovKeys.map((k) => `${k}=${s.overrides[k]}`).join(', ')} — click Reset to return to the file` : '';
  showStatus();
  renderParams(s.params);
  // the scene too: viewer.json (part names, colours) may have changed with the build
  const st = await getScene().catch((e) => ({ errors: [`cannot read the scene: ${e.message ?? e}`], parts: [] }));
  // each part's STL once, whatever number of instances show it; the old geometry goes once every mesh has the new
  await Promise.all(s.parts.map(async (p) => {
    const g = geos.get(p.name);
    if (!p.ok || (g && g.version === p.version)) return;
    const geo = await loadMesh(partUrl(p.name, p.version));
    geos.set(p.name, { version: p.version, geo, old: g?.geo });
  }));
  const gone = [...geos].filter(([n]) => !s.parts.some((p) => p.name === n));
  for (const [n] of gone) geos.delete(n);
  takeScene(st); place();
  for (const [, g] of gone) disposeGeo(g.geo);
  if (s.reference && !ghost) {
    const geo = await loadMesh(refStlUrl());
    ghost = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: +$('#ghost-op').value, depthWrite: false }));
    ghost.visible = ghostOn; scene.add(ghost);
    $('#ghost-row').hidden = false;
    bus.dispatchEvent(new Event('ui'));     // the rails offer Ghost now
  }
  renderPartList(); paint();      // a rebuilt mesh needs its highlight rebuilt
  if (!refresh.fitted) { fit(); refresh.fitted = true; }
  bus.dispatchEvent(new Event('parts'));   // section.js re-applies its clipping plane to new meshes
}

// The list is a two-level tree: parts that share a manifest `group` sit under one header row (at the position of
// the group's first member); parts without a group stay at the top level. A group's checkbox hides or shows every
// member (indeterminate when mixed), its name selects them all, ▸ folds it. Hidden and folded are remembered per model.
const folded = new Set(JSON.parse(localStorage.getItem(`folded:${MODEL}`) ?? '[]'));
let selectedGroup = null;
function renderPartList() {
  const ul = $('#parts'); ul.innerHTML = '';
  const groups = new Map();                         // group name -> [parts], in first-seen order
  const order = [];                                 // top-level rows: a part or a group name
  for (const p of rows()) {
    if (!p.group) { order.push(p); continue; }
    if (!groups.has(p.group)) { groups.set(p.group, []); order.push(p.group); }
    groups.get(p.group).push(p);
  }
  const partRow = (p, inGroup) => {
    const li = document.createElement('li');
    li.className = (p.ok || p.empty ? '' : 'bad ') + (p.empty ? 'empty ' : '') + (app.selected === p.name ? 'selected ' : '') + (inGroup ? 'member ' : '') + (hidden.has(p.name) ? 'off' : '') + (p.scratch ? ' scratch' : '');
    if (p.scratch) li.title = SCRATCH;
    li.innerHTML = `<span class="sw" style="background:${p.color}"></span><span class="n">${p.label}</span>${p.badge}${p.ok ? '' : `<span class="t">${p.empty ? 'empty' : 'failed'}</span>`}${eye(!hidden.has(p.name), hidden.has(p.name) ? 'show' : 'hide')}`;
    li.querySelector('.eye').onclick = (e) => { e.stopPropagation(); toggle(p.name); renderPartList(); };
    li.onclick = () => select(p.name);
    return li;
  };
  for (const row of order) {
    if (typeof row !== 'string') { ul.appendChild(partRow(row, false)); continue; }
    const name = row, members = groups.get(name);
    const shown = members.filter((p) => !hidden.has(p.name)).length;
    const bad = members.filter((p) => !p.ok && !p.empty).length;
    const li = document.createElement('li');
    const inst = members[0].byInstance ? members[0] : null;      // a group that is one instance: its scratch and scale cues
    li.className = 'group ' + (bad ? 'bad ' : '') + (selectedGroup === name ? 'selected ' : '') + (folded.has(name) ? 'folded ' : '') + (shown === 0 ? 'off' : shown < members.length ? 'some' : '') + (inst?.scratch ? ' scratch' : '');
    if (inst?.scratch) li.title = SCRATCH;
    li.innerHTML = `<span class="fold" title="fold / unfold">${CHEVRON}</span><span class="n">${name}</span>${inst?.instBadge ?? ''}${bad ? `<span class="t">${bad} failed</span>` : ''}${eye(shown > 0, 'show / hide the whole group')}`;
    li.querySelector('.eye').onclick = (e) => { e.stopPropagation(); setGroupHidden(name, shown === members.length); renderPartList(); };
    li.querySelector('.fold').onclick = (e) => {
      e.stopPropagation();
      folded.has(name) ? folded.delete(name) : folded.add(name);
      localStorage.setItem(`folded:${MODEL}`, JSON.stringify([...folded]));
      renderPartList();
    };
    li.onclick = () => selectGroup(name);
    ul.appendChild(li);
    if (!folded.has(name)) for (const p of members) ul.appendChild(partRow(p, true));
  }
}
// The list's rows: one per placed part, its built part's state (ok, tris, ...) under its path and label. While the
// scene has one instance the groups are the manifest's; with more, one group per instance (its id), and a scaled
// or scratch instance says so on its header; with one, on each of its rows.
const SCRATCH = 'scratch: shown here, left out of _scene.scad, the check and the export';
function scaleBadge(pl) {
  if (!scaled(pl)) return '';
  const s = pl.scale.every((v) => v === pl.scale[0]) ? `×${pl.scale[0]}` : `×${pl.scale.join('/')}`;
  return `<span class="badge" title="scaled ${s}: its clearances scale too, and a print would be wrong; for a real size change, use a value">${s}</span>`;
}
function rows() {
  const byInstance = multiInstance(), out = [];
  for (const pl of placedParts()) {
    const built = app.state.parts.find((p) => p.name === pl.part);
    if (!built) continue;
    const badge = scaleBadge(pl);
    out.push({ ...built, name: pl.path, label: labelOf(pl.path), color: pl.color, group: byInstance ? pl.instance : pl.group,
               scratch: pl.scratch, byInstance, badge: byInstance ? '' : badge, instBadge: badge });
  }
  return out;
}
function groupMap() {      // group key -> member paths, in list order
  const byInstance = multiInstance(), out = new Map();
  for (const pl of placedParts()) {
    const g = byInstance ? pl.instance : pl.group;
    if (g) { if (!out.has(g)) out.set(g, []); out.get(g).push(pl.path); }
  }
  return out;
}
const saveHidden = () => localStorage.setItem(`hidden:${MODEL}`, JSON.stringify([...hidden]));
function toggle(name) {
  hidden.has(name) ? hidden.delete(name) : hidden.add(name);
  saveHidden();
  const m = meshes.get(name); if (m) m.visible = !hidden.has(name);
  bus.dispatchEvent(new Event('visibility'));   // bounds.js re-measures
}
export const getSelection = () => ({ part: app.selected, group: selectedGroup });
export const groupMembers = (g) => groupMap().get(g) ?? [];
export const groupNames = () => [...groupMap().keys()];
function setGroupHidden(g, hide) {
  for (const n of groupMembers(g)) if (hidden.has(n) !== hide) toggle(n);
}
export const hiddenParts = () => [...hidden].map((n) => (n.includes('.') ? labelOf(n) : n));
// Hide on the rail: the selected part, or every member of the selected group; the selection goes
export function hideSelection() {
  if (app.selected) { if (!hidden.has(app.selected)) toggle(app.selected); }
  else if (selectedGroup) setGroupHidden(selectedGroup, true);
  clearSelect();
}
// show exactly this set of parts as hidden (a pushed view); does not touch what is remembered per model
export function setHidden(names) {
  const want = new Set(names.flatMap(pathsFor));
  for (const [n, m] of meshes) m.visible = !!m.userData.part?.ok && !want.has(n);
  bus.dispatchEvent(new Event('visibility'));
}

// ---------- ghost ----------
// the model's reference STL, see-through; the rail's Ghost entry and the Display tray's opacity row show once there is one
let ghostOn = false;
export const ghostState = () => ({ available: !!ghost, on: ghostOn });
export function toggleGhost() {
  if (!ghost) return;
  ghostOn = !ghostOn;
  ghost.visible = ghostOn;
  bus.dispatchEvent(new Event('ui'));
}
$('#ghost-op').oninput = (e) => { if (ghost) ghost.material.opacity = +e.target.value; };

// ---------- selection + source ----------
export async function select(name) {
  name = meshes.has(name) ? name : pathsFor(name)[0] ?? name;     // a bare part name (debug, old callers): its first instance
  app.selected = name; selectedGroup = null;
  paint(); renderPartList();
  bus.dispatchEvent(new Event('select'));
  const p = app.state.parts.find((x) => x.name === partOf(name));
  source = null; showCode();
  if (!p?.module) return;
  const mods = await getSource(p.module);
  if (app.selected !== name) return;            // another pick while this one loaded
  source = { part: p, mods };
  focusParams(mods.map((m) => m.code).join('\n'));
  showCode();
}
// The source panel: the selected part's modules. It opens only when asked (Code on the rail, c), then follows
// the selection; with nothing selected, or a group, there is no panel. On or off is remembered.
const CODE = 'armenscad.code';
let codeOn = localStorage.getItem(CODE) === '1', source = null;     // source: { part, mods } of the selected part
export const codeState = () => ({ on: codeOn });
export function toggleCode(on = !codeOn) {
  codeOn = on; localStorage.setItem(CODE, on ? '1' : '0');
  showCode();
  bus.dispatchEvent(new Event('ui'));
}
function showCode() {
  const show = codeOn && !!source;
  $('#code').hidden = !show;
  if (!show) return;
  const { part: p, mods } = source;
  $('#code-title').textContent = `${p.call}   →   ${app.state.file}:${mods[0]?.line ?? '?'}   (${mods.length} module${mods.length === 1 ? '' : 's'})`;
  $('#code-body').innerHTML = mods.map((m) => `<div class="mod-head">${m.name}()  <span class="muted">line ${m.line}</span></div>` + highlight(m.code)).join('\n');
}
// a group: highlight every member, no source panel
export function selectGroup(g) {
  clearSelect();
  selectedGroup = g;
  paint(); renderPartList();
  bus.dispatchEvent(new Event('select'));
}
export function clearSelect() {
  source = null; showCode(); app.selected = null; selectedGroup = null;
  paint(); renderPartList(); focusParams(null);
  bus.dispatchEvent(new Event('select'));
}
$('#code-close').onclick = () => toggleCode(false);
function highlight(code) {
  const esc = code.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return esc
    .replace(/(\/\/.*)$/gm, '<span class="cm">$1</span>')
    .replace(/\b(module|function|for|if|else|let|each|difference|union|intersection|hull|minkowski|translate|rotate|mirror|scale|linear_extrude|rotate_extrude|cylinder|cube|sphere|polygon|circle|square|offset|import|color)\b/g, '<span class="kw">$1</span>')
    .replace(/(?<![\w.])(-?\d+\.?\d*)(?![\w"])/g, '<span class="num">$1</span>');
}

// ---------- highlight ----------
// What is selected (a part, or every member of a group) gets an outline in the skin's --select colour and a
// light tint of it; the part under the pointer gets a thinner, fainter outline, so a click is no surprise. The
// outline is an inverted hull: the part's back faces pushed out along smoothed normals by a fixed number of
// screen pixels (in the vertex shader), so it reads on any part colour at any zoom, and it shares the part's
// clipping plane. The hull geometry (vertices welded so the normals are smooth and the shell has no cracks) is
// built once per geometry, ahead of time when the page is idle, since a 400k-triangle part takes a moment.
const SEL = new THREE.Color(0x6ea8fe);
const OUTLINE = { sel: [3, 1], hover: [1.5, 0.55] };    // [px, opacity]
let hovered = null;
const res = new THREE.Vector2(1, 1);
const sizeRes = () => res.set(canvas.clientWidth || 1, canvas.clientHeight || 1);
bus.addEventListener('resize', sizeRes); sizeRes();
function hullOf(geo) {
  if (!geo.userData.hull) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', geo.getAttribute('position'));
    geo.userData.hull = mergeVertices(g, 1e-4); geo.userData.hull.computeVertexNormals();
  }
  return geo.userData.hull;
}
function outlineMat(clip) {
  const u = { uWidth: { value: 3 }, uRes: { value: res } };
  const m = new THREE.MeshBasicMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, clippingPlanes: clip });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWidth; uniform vec2 uRes;')
      .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 nc = projectionMatrix * vec4(normalize(normalMatrix * normal), 0.0);
  if (dot(nc.xy, nc.xy) > 1e-12) gl_Position.xy += normalize(nc.xy) * uWidth * 2.0 / uRes * gl_Position.w;
}`);
  };
  m.userData.u = u;
  return m;
}
// a mesh's outline child, rebuilt with its geometry
function outline(mesh) {
  let o = mesh.userData.outline;
  if (o?.userData.geo === mesh.geometry) return o;
  if (o) { mesh.remove(o); o.userData.geo.userData.hull?.dispose(); }
  o = new THREE.Mesh(hullOf(mesh.geometry), outlineMat(mesh.material.clippingPlanes));
  o.raycast = () => {}; o.userData.geo = mesh.geometry;
  mesh.add(o); mesh.userData.outline = o;
  return o;
}
const selectedNames = () => new Set(app.selected ? [app.selected] : selectedGroup ? groupMembers(selectedGroup) : []);
export function paint() {
  const sel = selectedNames();
  for (const [n, m] of meshes) {
    const look = sel.has(n) ? OUTLINE.sel : n === hovered ? OUTLINE.hover : null;
    m.material.emissive.copy(SEL).multiplyScalar(sel.has(n) ? 0.2 : 0);
    if (look) {
      const o = outline(m); o.visible = true;
      o.material.color.copy(SEL); o.material.opacity = look[1]; o.material.userData.u.uWidth.value = look[0];
    } else if (m.userData.outline) m.userData.outline.visible = false;
  }
}
// build the hulls while nothing is happening
function warmHulls() {
  const todo = [...meshes.values()].filter((m) => !m.geometry.userData.hull);
  const next = () => { const m = todo.shift(); if (!m) return; hullOf(m.geometry); (window.requestIdleCallback ?? setTimeout)(next); };
  (window.requestIdleCallback ?? setTimeout)(next);
}
bus.addEventListener('parts', warmHulls);
bus.addEventListener('skin', () => { SEL.setHex(token('--select', '#6ea8fe').hex); paint(); });
SEL.setHex(token('--select', '#6ea8fe').hex);

// ---------- hover / click picking ----------
// ndc -> the nearest visible placed part under it, or null: { name: its path, label, instance, part, point: world mm,
// local: the same point in the instance's own frame (where the .scad draws the part) }
export function pickPart(ndc) {
  const hit = raycast(ndc, visibleMeshes());
  if (!hit) return null;
  const o = hit.object, pl = o.userData.placed;
  return { name: o.userData.name, label: o.userData.label, instance: pl.instance, part: pl.part, point: hit.point,
           local: hit.point.clone().applyMatrix4(o.matrixWorld.clone().invert()) };
}
let downAt = null;
canvas.addEventListener('pointermove', (ev) => {
  const h = pickPart(toNDC(ev)); const tip = $('#tip');
  if ((h?.name ?? null) !== hovered) { hovered = h?.name ?? null; paint(); }
  canvas.style.cursor = h ? 'pointer' : '';
  tip.hidden = !h;
  if (h) { tip.style.left = ev.offsetX + 14 + 'px'; tip.style.top = ev.offsetY + 14 + 'px';
    tip.textContent = `${h.label}  (${h.point.x.toFixed(1)}, ${h.point.y.toFixed(1)}, ${h.point.z.toFixed(1)})`; }
});
canvas.addEventListener('pointerleave', () => { if (hovered) { hovered = null; paint(); } });
canvas.addEventListener('pointerdown', (ev) => { downAt = [ev.clientX, ev.clientY]; });
canvas.addEventListener('pointerup', (ev) => {
  if (!downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 4) return;
  const h = pickPart(toNDC(ev)); if (h) select(h.name);
});
