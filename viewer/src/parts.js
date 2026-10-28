// Parts: loading the STLs the server built, the part list, hover/click picking, selection and the source panel.
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { app } from './app.js';
import { MODEL, partUrl, refStlUrl, getSource } from './api.js';
import { scene, group, canvas, fit, toNDC, raycast, bus } from './scene.js';
import { renderParams, focusParams } from './params.js';

const $ = (s) => document.querySelector(s);
const loader = new STLLoader();
export const meshes = new Map();      // name -> mesh
let ghost = null;
const hidden = new Set(JSON.parse(localStorage.getItem(`hidden:${MODEL}`) ?? '[]'));

async function loadMesh(url) {
  const geo = await loader.loadAsync(url);
  geo.computeVertexNormals();
  return geo;
}

export const visibleMeshes = () => [...meshes.values()].filter((m) => m.visible);
// every material a section plane should cut: the parts, their edge lines (shading.js) and the reference ghost
export const allMaterials = () => [...[...meshes.values()].flatMap((m) => [m.material, ...m.children.map((c) => c.material)]), ...(ghost ? [ghost.material] : [])];

export async function refresh(s) {
  app.state = s;
  console.log('[viewer] refresh, built', s.builtAt, 'overrides', JSON.stringify(s.overrides));
  $('#title').textContent = `${MODEL} / ${s.file ?? '?'}`;
  $('#status').textContent = s.error ? `error: ${s.error}` : `built ${new Date(s.builtAt).toLocaleTimeString()} in ${(s.buildMs / 1000).toFixed(1)}s`;
  const ovKeys = Object.keys(s.overrides ?? {});
  $('#override-banner').hidden = ovKeys.length === 0;
  $('#override-banner').textContent = ovKeys.length ? `⚠ overrides active: ${ovKeys.map((k) => `${k}=${s.overrides[k]}`).join(', ')} — click Reset to return to the file` : '';
  $('#log').textContent = s.parts.map((p) => p.log).filter(Boolean).join('\n') || 'no warnings';
  renderParams(s.params);
  // remove parts that vanished
  for (const [n, m] of meshes) if (!s.parts.find((p) => p.name === n)) { group.remove(m); meshes.delete(n); }
  await Promise.all(s.parts.map(async (p) => {
    let m = meshes.get(p.name);
    if (m && m.userData.version === p.version) return;
    if (!p.ok) { if (m) m.visible = false; return; }
    const geo = await loadMesh(partUrl(p.name, p.version));
    if (m) { m.geometry.dispose(); m.geometry = geo; }
    else {
      // polygonOffset pushes the surface back a hair so edge lines (shading.js) sit on top without z-fighting
      m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.55, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
      m.userData.name = p.name; meshes.set(p.name, m); group.add(m);
    }
    m.userData.version = p.version; m.userData.part = p;
    m.visible = !hidden.has(p.name);
  }));
  if (s.reference && !ghost) {
    const geo = await loadMesh(refStlUrl());
    ghost = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: +$('#ghost-op').value, depthWrite: false }));
    ghost.visible = $('#ghost').checked; scene.add(ghost);
  }
  renderPartList();
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
  let total = 0;
  const groups = new Map();                         // group name -> [parts], in first-seen order
  const order = [];                                 // top-level rows: a part or a group name
  for (const p of app.state.parts) {
    total += p.tris;
    if (!p.group) { order.push(p); continue; }
    if (!groups.has(p.group)) { groups.set(p.group, []); order.push(p.group); }
    groups.get(p.group).push(p);
  }
  const partRow = (p, inGroup) => {
    const li = document.createElement('li');
    li.className = (p.ok || p.empty ? '' : 'bad ') + (p.empty ? 'empty ' : '') + (app.selected === p.name ? 'selected ' : '') + (inGroup ? 'member' : '');
    li.innerHTML = `<input type="checkbox" ${hidden.has(p.name) ? '' : 'checked'}><span class="sw" style="background:${p.color}"></span><span class="n">${p.name}</span><span class="t">${p.ok ? `${p.tris}△ ${p.ms}ms` : p.empty ? 'empty' : 'failed'}</span>`;
    li.querySelector('input').onclick = (e) => { e.stopPropagation(); toggle(p.name); renderPartList(); };
    li.onclick = () => select(p.name);
    return li;
  };
  for (const row of order) {
    if (typeof row !== 'string') { ul.appendChild(partRow(row, false)); continue; }
    const name = row, members = groups.get(name);
    const shown = members.filter((p) => !hidden.has(p.name)).length;
    const tris = members.reduce((n, p) => n + p.tris, 0), bad = members.filter((p) => !p.ok && !p.empty).length;
    const li = document.createElement('li');
    li.className = 'group ' + (bad ? 'bad ' : '') + (selectedGroup === name ? 'selected ' : '') + (folded.has(name) ? 'folded' : '');
    li.innerHTML = `<span class="fold" title="fold / unfold">▾</span><input type="checkbox" title="show / hide the whole group"><span class="n">${name}</span><span class="t">${bad ? `${bad} failed` : `${members.length} parts ${tris}△`}</span>`;
    const cb = li.querySelector('input');
    cb.checked = shown === members.length; cb.indeterminate = shown > 0 && shown < members.length;
    cb.onclick = (e) => { e.stopPropagation(); setGroupHidden(name, shown === members.length); renderPartList(); };
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
  $('#tri-total').textContent = `${total.toLocaleString()} triangles`;
}
function toggle(name) {
  hidden.has(name) ? hidden.delete(name) : hidden.add(name);
  localStorage.setItem(`hidden:${MODEL}`, JSON.stringify([...hidden]));
  const m = meshes.get(name); if (m) m.visible = !hidden.has(name);
  bus.dispatchEvent(new Event('visibility'));   // bounds.js re-measures
}
export const getSelection = () => ({ part: app.selected, group: selectedGroup });
export const groupMembers = (g) => app.state?.parts.filter((p) => p.group === g).map((p) => p.name) ?? [];
export const groupNames = () => [...new Set((app.state?.parts ?? []).map((p) => p.group).filter(Boolean))];
function setGroupHidden(g, hide) {
  for (const n of groupMembers(g)) if (hidden.has(n) !== hide) toggle(n);
}
export const hiddenParts = () => [...hidden];
// show exactly this set of parts as hidden (a pushed view); does not touch what is remembered per model
export function setHidden(names) {
  const want = new Set(names);
  for (const [n, m] of meshes) m.visible = !want.has(n);
  bus.dispatchEvent(new Event('visibility'));
}

// ---------- ghost ----------
$('#ghost').onchange = (e) => { if (ghost) ghost.visible = e.target.checked; };
$('#ghost-op').oninput = (e) => { if (ghost) ghost.material.opacity = +e.target.value; };
export function toggleGhost() { $('#ghost').checked = !$('#ghost').checked; $('#ghost').onchange({ target: $('#ghost') }); }

// ---------- selection + source ----------
export async function select(name) {
  app.selected = name; selectedGroup = null;
  for (const [n, m] of meshes) m.material.emissive.set(n === name ? app.selGlow : 0x000000);
  renderPartList();
  bus.dispatchEvent(new Event('select'));
  const p = app.state.parts.find((x) => x.name === name);
  if (!p?.module) return;
  const mods = await getSource(p.module);
  focusParams(mods.map((m) => m.code).join('\n'));
  $('#code-title').textContent = `${p.call}   →   ${app.state.file}:${mods[0]?.line ?? '?'}   (${mods.length} module${mods.length === 1 ? '' : 's'})`;
  $('#code-body').innerHTML = mods.map((m) => `<div class="mod-head">${m.name}()  <span class="muted">line ${m.line}</span></div>` + highlight(m.code)).join('\n');
  $('#code').hidden = false;
}
// a group: highlight every member, no source panel (each member's own row still opens its module)
export function selectGroup(g) {
  clearSelect();
  selectedGroup = g;
  const members = new Set(groupMembers(g));
  for (const [n, m] of meshes) m.material.emissive.set(members.has(n) ? app.selGlow : 0x000000);
  renderPartList();
  bus.dispatchEvent(new Event('select'));
}
export function clearSelect() {
  $('#code').hidden = true; app.selected = null; selectedGroup = null;
  for (const m of meshes.values()) m.material.emissive.set(0);
  renderPartList(); focusParams(null);
  bus.dispatchEvent(new Event('select'));
}
$('#code-close').onclick = clearSelect;
function highlight(code) {
  const esc = code.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return esc
    .replace(/(\/\/.*)$/gm, '<span class="cm">$1</span>')
    .replace(/\b(module|function|for|if|else|let|each|difference|union|intersection|hull|minkowski|translate|rotate|mirror|scale|linear_extrude|rotate_extrude|cylinder|cube|sphere|polygon|circle|square|offset|import|color)\b/g, '<span class="kw">$1</span>')
    .replace(/(?<![\w.])(-?\d+\.?\d*)(?![\w"])/g, '<span class="num">$1</span>');
}

// ---------- hover / click picking ----------
// ndc -> { name, point } of the nearest visible part under it, or null
export function pickPart(ndc) {
  const hit = raycast(ndc, visibleMeshes());
  return hit ? { name: hit.object.userData.name, point: hit.point } : null;
}
let downAt = null;
canvas.addEventListener('pointermove', (ev) => {
  const h = pickPart(toNDC(ev)); const tip = $('#tip');
  canvas.style.cursor = h ? 'pointer' : '';
  tip.hidden = !h;
  if (h) { tip.style.left = ev.offsetX + 14 + 'px'; tip.style.top = ev.offsetY + 14 + 'px';
    tip.textContent = `${h.name}  (${h.point.x.toFixed(1)}, ${h.point.y.toFixed(1)}, ${h.point.z.toFixed(1)})`; }
});
canvas.addEventListener('pointerdown', (ev) => { downAt = [ev.clientX, ev.clientY]; });
canvas.addEventListener('pointerup', (ev) => {
  if (!downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 4) return;
  const h = pickPart(toNDC(ev)); if (h) select(h.name);
});
