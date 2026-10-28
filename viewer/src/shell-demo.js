// The shell demo (shell.html): the viewer's planned layout on the CyberDOS shell with stand-in content,
// so the rails, trays and panels can be judged before the real viewer moves onto them.
import '@redswoop/cyberdos/web/cyber.css';
import '@redswoop/cyberdos/web/shell.css';
import './shell-demo.css';
import { Rail, foldable, resizable, PALETTES, DEFAULT_PALETTE, GOOGLE_FONTS_URL, applyPalette, setSkin } from '@redswoop/cyberdos/web';
import { createElement, Box, Layers, PenTool, MoveUpRight, Type, Crosshair, SquareSplitVertical, Ruler, Ghost, Search,
         Images, Eye, EyeOff, Camera, Settings2, Grid3x3, Maximize, Rotate3d, SunMedium, FlipVertical2, Focus, Trash2,
         Code, ScanEye, SlidersHorizontal, MousePointer2, Image, StickyNote, Folder, Ellipsis, View } from 'lucide';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const $ = (s) => document.querySelector(s);
const svg = (icon) => createElement(icon).outerHTML;

// ---------- skin and text size ----------
const SKINS = [{ id: 'plain', name: 'plain' }, ...PALETTES.map((p) => ({ id: p.id, name: p.name }))];
let skin = new URLSearchParams(location.search).get('skin') ?? DEFAULT_PALETTE.id;
let fs = 1;
function setTheme(id) {
  skin = id;
  const pal = PALETTES.find((p) => p.id === id);
  setSkin(!!pal);
  applyPalette(pal && !pal.stock ? pal.colors : {});
  if (pal && !document.getElementById('cyber-fonts'))
    document.head.append(Object.assign(document.createElement('link'), { id: 'cyber-fonts', rel: 'stylesheet', href: GOOGLE_FONTS_URL }));
  backdrop();
}
const setFs = (v) => { fs = Math.round(v * 100) / 100; document.documentElement.style.setProperty('--fs', fs); };

// ---------- the stand-in stage: a box on a grid ----------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(devicePixelRatio);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
camera.position.set(160, -220, 150); camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, canvas);
const grid = new THREE.GridHelper(600, 60); grid.rotation.x = Math.PI / 2; scene.add(grid);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(1, -2, 3); scene.add(sun);
const mat = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, roughness: 0.6 });
const box = new THREE.Mesh(new THREE.BoxGeometry(120, 70, 40), mat); box.position.z = 20; scene.add(box);
const dome = new THREE.Mesh(new THREE.SphereGeometry(22, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), mat.clone());
dome.rotation.x = Math.PI / 2; dome.position.set(20, 0, 40); scene.add(dome);
function backdrop() {
  const css = getComputedStyle(document.documentElement);
  const on = skin !== 'plain';
  scene.background = new THREE.Color(on ? css.getPropertyValue('--bg').trim() || '#0b0607' : '#14161a');
  const line = on ? css.getPropertyValue('--chrome').trim() : '#3a404c';
  grid.material.color = new THREE.Color(line); grid.material.opacity = on ? 0.35 : 0.8; grid.material.transparent = true;
}
function size() {
  const r = $('#stage').getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
}
addEventListener('resize', size);
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

// selection: click the box or dome, click empty space to clear (a drag is an orbit, not a click)
let selected = null;
let down = null;
canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
  const r = canvas.getBoundingClientRect();
  const ray = new THREE.Raycaster();
  ray.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, camera);
  const hit = ray.intersectObjects([box, dome])[0]?.object ?? null;
  select(hit === box ? 'base' : hit === dome ? 'dome' : null);
});
function select(id) {
  selected = id;
  for (const [m, n] of [[box, 'base'], [dome, 'dome']]) m.material.emissive = new THREE.Color(n === id ? 0x1d3a66 : 0);
  for (const li of document.querySelectorAll('#tree li')) li.classList.toggle('sel', li.dataset.id === id);
  context();
}

// ---------- the rails ----------
const mode = { space: 'view', section: false, measure: false };
const toggles = { edges: true, shadows: false, headlight: true, ortho: false, ghost: false, box: false };

const left = new Rail('left', [
  { id: 'spaces', handle: true, entries: [
    { id: 'view', label: 'View', icon: svg(Rotate3d), keys: ['V'], on: true, onSelect: () => space('view') },
    { id: 'annotate', label: 'Annotate', icon: svg(PenTool), keys: ['N'], on: false, onSelect: () => space('annotate') },
    { id: 'trace', label: 'Trace', icon: svg(Images), on: false, onSelect: () => space('trace') },
    { id: 'items', label: 'Items', icon: svg(Layers), on: true, onSelect: (e) => slot('#left', e) },
  ] },
  { id: 'context', anchor: 'middle', handle: true },
  { id: 'modes', anchor: 'bottom', entries: [
    { id: 'section', label: 'Section', icon: svg(SquareSplitVertical), keys: ['S'], state: 'Off', on: false, onSelect: () => { mode.section = !mode.section; context(); } },
    { id: 'measure', label: 'Measure', icon: svg(Ruler), keys: ['M'], state: 'Off', on: false, onSelect: () => { mode.measure = !mode.measure; context(); } },
  ] },
]);

const right = new Rail('right', [
  { id: 'view', handle: true, entries: [
    { id: 'grid', label: 'Grid', icon: svg(Grid3x3), state: '10 mm', title: 'grid spacing (follows the zoom)' },
    { id: 'views', label: 'Views', icon: svg(View), keys: ['1'], tray: viewsTray },
    { id: 'fit', label: 'Fit', icon: svg(Maximize), keys: ['F'] },
  ] },
  { id: 'look', anchor: 'middle', handle: true, entries: [
    { id: 'display', label: 'Display', icon: svg(SunMedium), state: 'Shaded · edges', tray: displayTray },
    { id: 'ortho', label: 'Camera', icon: svg(Focus), keys: ['O'], state: 'Perspective', onSelect: (e) => { toggles.ortho = !toggles.ortho; e.update({ state: toggles.ortho ? 'Orthographic' : 'Perspective' }); } },
    { id: 'shot', label: 'Screenshot', icon: svg(Camera) },
  ] },
  { id: 'app', anchor: 'bottom', entries: [
    { id: 'settings', label: 'Settings', icon: svg(Settings2), tray: settingsTray },
    { id: 'params', label: 'Parameters', icon: svg(SlidersHorizontal), keys: ['P'], on: true, onSelect: (e) => slot('#right', e) },
  ] },
]);

$('#frame').append(left.el, right.el);

function space(id) {
  mode.space = id;
  for (const s of ['view', 'annotate', 'trace']) left.entry(s).on = s === id;
  context();
}
function slot(sel, entry) {
  const s = $(sel);
  s.hidden = !s.hidden;
  entry.on = !s.hidden;
}

// The middle group: what fits the mode, then the selection, then the space. Only redrawn when that changes.
let shown = '';
function context() {
  const sec = left.entry('section');
  sec.update({ on: mode.section, state: mode.section ? 'Edit' : 'Off' });
  left.entry('measure').update({ on: mode.measure, state: mode.measure ? 'Click two points' : 'Off' });
  const key = mode.section ? 'section' : mode.space === 'annotate' ? 'annotate' : mode.space === 'trace' ? 'trace' : selected ? 'part' : 'none';
  if (key === shown) return;
  shown = key;
  left.group('context').set(CONTEXT[key]());
}
const flip = (k, label) => (e) => { toggles[k] = !toggles[k]; e.update({ on: toggles[k], state: toggles[k] ? 'On' : 'Off' }); };
const CONTEXT = {
  none: () => [
    { id: 'search', label: 'Search', icon: svg(Search), keys: ['⌘', 'K'] },
    { id: 'box', label: 'Bounding box', icon: svg(Box), keys: ['B'], on: toggles.box, state: toggles.box ? 'On' : 'Off', onSelect: flip('box') },
    { id: 'ghost', label: 'Ghost', icon: svg(Ghost), keys: ['G'], on: toggles.ghost, state: toggles.ghost ? 'On' : 'Off', onSelect: flip('ghost') },
  ],
  part: () => [
    { id: 'isolate', label: 'Isolate', icon: svg(ScanEye), keys: ['I'] },
    { id: 'hide', label: 'Hide', icon: svg(EyeOff), keys: ['H'] },
    { id: 'zoom', label: 'Zoom to', icon: svg(Focus), keys: ['Z'] },
    { id: 'code', label: 'Show code', icon: svg(Code) },
    { id: 'more', label: 'More', icon: svg(Ellipsis), more: true },
  ],
  annotate: () => [
    { id: 'select', label: 'Select', icon: svg(MousePointer2), keys: ['V'], on: true },
    { id: 'pen', label: 'Pen', icon: svg(PenTool), keys: ['P'], on: false },
    { id: 'arrow', label: 'Arrow', icon: svg(MoveUpRight), keys: ['A'], on: false },
    { id: 'text', label: 'Label', icon: svg(Type), keys: ['T'], on: false },
    { id: 'points', label: 'Pick points', icon: svg(Crosshair), keys: ['K'], on: false },
  ].map((s) => ({ ...s, onSelect: (e) => { for (const x of left.group('context').entries) x.on = x === e; } })),
  trace: () => [
    { id: 'place', label: 'Place image', icon: svg(Image) },
    { id: 'calib', label: 'Calibrate', icon: svg(Ruler), state: 'Two points + a length' },
    { id: 'origin', label: 'Set origin', icon: svg(Crosshair) },
    { id: 'face', label: 'Face the image', icon: svg(Focus) },
  ],
  section: () => [
    { id: 'flip', label: 'Flip side', icon: svg(FlipVertical2) },
    { id: 'look', label: 'Normal to section', icon: svg(Focus) },
    { id: '2d', label: '2D section', icon: svg(SquareSplitVertical), on: false, state: 'Off', onSelect: flip('s2d') },
    { id: 'only', label: 'Section only', icon: svg(Box), on: false, state: 'Off', onSelect: flip('sonly') },
    { id: 'delete', label: 'Delete section', icon: svg(Trash2), onSelect: () => { mode.section = false; context(); } },
  ],
};

// ---------- trays ----------
function rows(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
}
function displayTray() {
  const d = rows(`<p class="cd-tray-title">Display</p>
    ${['edges', 'shadows', 'headlight'].map((k) => `<div class="demo-row"><label><input type="checkbox" data-k="${k}" ${toggles[k] ? 'checked' : ''}> ${k}</label></div>`).join('')}`);
  d.addEventListener('change', (e) => {
    toggles[e.target.dataset.k] = e.target.checked;
    right.entry('display').update({ state: ['Shaded', toggles.edges && 'edges', toggles.shadows && 'shadows'].filter(Boolean).join(' · ') });
  });
  return d;
}
function viewsTray() {
  return rows(`<p class="cd-tray-title">Views</p>
    <div class="demo-row">${['Home 1', 'Front 2', 'Back 3', 'Top 4'].map((v) => `<button class="demo-btn">${v}</button>`).join('')}</div>
    <div class="demo-row">${['Bottom 5', 'Right 6', 'Left 7'].map((v) => `<button class="demo-btn">${v}</button>`).join('')}</div>`);
}
function settingsTray() {
  const d = rows(`<p class="cd-tray-title">Interface</p>
    <div class="demo-row"><span>skin</span><select id="skin">${SKINS.map((s) => `<option value="${s.id}" ${s.id === skin ? 'selected' : ''}>${s.name}</option>`).join('')}</select></div>
    <div class="demo-row"><span>text</span><button class="demo-btn" data-fs="-1">A−</button><span id="fs-val">${Math.round(fs * 100)}%</span><button class="demo-btn" data-fs="1">A+</button></div>`);
  d.querySelector('#skin').onchange = (e) => setTheme(e.target.value);
  d.addEventListener('click', (e) => {
    const step = +e.target.dataset.fs;
    if (!step) return;
    setFs(Math.max(0.85, Math.min(2, fs + step * 0.15)));
    d.querySelector('#fs-val').textContent = `${Math.round(fs * 100)}%`;
  });
  return d;
}

// ---------- panels (stand-in content) ----------
const ITEMS = [
  { id: 'body', kind: 'folder', name: 'body', icon: Folder },
  { id: 'base', kind: 'part', name: 'base', icon: Box, child: true },
  { id: 'dome', kind: 'part', name: 'dome', icon: Box, child: true },
  { id: 'hatch', kind: 'part', name: 'hatch (hidden by pose)', icon: Box, off: true },
  { id: 'front', kind: 'ref', name: 'front.jpg', icon: Image, pct: '50%' },
  { id: 'side', kind: 'ref', name: 'side-profile.png', icon: Image, pct: '35%', off: true },
  { id: 'n1', kind: 'note', name: 'fillet this edge 2 mm', icon: StickyNote },
];
function tree() {
  $('#tree').innerHTML = ITEMS.map((i) => `<li data-id="${i.id}" class="${i.child ? 'child' : ''} ${i.off ? 'off' : ''} ${i.id === selected ? 'sel' : ''}">
    ${svg(i.icon)}<span class="n">${i.name}</span>${i.pct ? `<span class="pct">${i.pct}</span>` : ''}
    <button class="eye" title="${i.off ? 'show' : 'hide'}">${svg(i.off ? EyeOff : Eye)}</button></li>`).join('');
  $('#item-count').textContent = `${ITEMS.filter((i) => i.kind === 'part').length} parts · ${ITEMS.filter((i) => i.kind === 'ref').length} references`;
}
$('#tree').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const item = ITEMS.find((i) => i.id === li.dataset.id);
  if (e.target.closest('.eye')) { item.off = !item.off; tree(); return; }
  if (item.kind === 'part') select(item.id === selected ? null : item.id);
});
const PARAMS = { Body: [['wall', 2], ['length', 120], ['width', 70], ['height', 40]], Dome: [['dome_r', 22], ['dome_x', 20]], Fit: [['clearance', 0.2], ['layer_h', 0.2]] };
$('#param-body').innerHTML = Object.entries(PARAMS).map(([sec, ps]) => `<div class="demo-sec">${sec}</div>` +
  ps.map(([n, v]) => `<div class="demo-param"><label>${n}</label><input type="number" value="${v}" step="0.1"></div>`).join('')).join('');
$('#param-body').addEventListener('input', () => { $('#dirty').textContent = 'changed: apply to rebuild'; });

for (const p of document.querySelectorAll('.cd-panel')) foldable(p);
resizable($('#left'));
resizable($('#right'));

addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  if (k === 's') left.entry('section').el.click();
  else if (k === 'm') left.entry('measure').el.click();
  else if (k === 'n') space(mode.space === 'annotate' ? 'view' : 'annotate');
  else if (k === 'escape') { mode.section = false; mode.measure = false; select(null); space('view'); }
});

setTheme(skin);
tree();
size();
context();
