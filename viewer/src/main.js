// Entry point: which model, the pickers (the page with no model, the dialog behind the title), keyboard, and
// the SSE wiring. The work lives in scene.js (three.js), parts.js (meshes, picking, selection), params.js (the
// panel), annotate.js (drawing + notes), refs.js (reference images), overlay.js (image as a plane), section.js
// (clipping plane), shading.js (shadows, edges, headlight), grid.js (the ground grid, the print bed), viewcube.js (the cube), rails.js (the two rails,
// their trays, the tool card), hud.js (foldable panels, slot widths), theme.js (the page skin, text size),
// api.js (server).
import { MODEL, getModels, getState, connect, reportView } from './api.js';
import { app } from './app.js';
import { fit, fitView, setOrtho, isOrtho, setPose, getPose, controls, orbitTo } from './scene.js';
import { refresh, toggleGhost, hiddenParts, setHidden, getSelection, clearSelect } from './parts.js';
import * as annotate from './annotate.js';
import { loadRefs, refs } from './refs.js';
import * as overlay from './overlay.js';
import { section, toggleSection, sectionKey } from './section.js';
import { shading } from './shading.js';
import * as boundsUI from './bounds.js';
import { setPrinter, toggleGrid } from './grid.js';
import { installDebug } from './debug.js';
import { installSkinPicker } from './theme.js';
import { home } from './viewcube.js';
import './hud.js';
import { toggleAnnotate } from './rails.js';

const $ = (s) => document.querySelector(s);
document.title = MODEL ? `${MODEL} · scad viewer` : 'scad viewer';

async function showPicker(msg) {
  const list = await getModels();
  $('#pick-msg').textContent = msg ?? '';
  $('#pick-list').innerHTML = list.length
    ? list.map((m) => `<li><a href="/${m.name}/">${m.name}</a><span class="muted">${m.file ?? ''}${m.loaded ? (m.error ? ' · error' : m.building ? ' · rendering' : m.failed ? ` · ${m.failed} failed` : ' · built') : ''}${m.clients ? ` · ${m.clients} open` : ''}</span></li>`).join('')
    : '<li class="muted">no folder with a viewer.json found</li>';
  $('#pick').hidden = false;
}
if (!MODEL) { showPicker(); throw new Error('no model in url'); }

// the title opens a picker over the workspace's models: type to narrow, Enter opens the first
const dlg = $('#models');
let models = [];
function listModels() {
  const q = $('#models-q').value.trim().toLowerCase();
  const hits = models.filter((m) => m.name.toLowerCase().includes(q));
  $('#models-list').innerHTML = hits.map((m) => `<li><a href="/${m.name}/" class="${m.name === MODEL ? 'here' : ''}">${m.name}</a><span class="muted">${m.file ?? ''}${m.error ? ' · error' : m.failed ? ` · ${m.failed} failed` : ''}</span></li>`).join('') || '<li class="muted">no match</li>';
}
$('#title').onclick = async () => {
  models = await getModels();
  $('#models-q').value = '';
  listModels();
  dlg.showModal();
};
$('#models-q').oninput = listModels;
$('#models-q').onkeydown = (e) => { if (e.key === 'Enter') { const a = $('#models-list a'); if (a) location.href = a.href; } };
dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };   // a click on the backdrop
installSkinPicker($('#skin'));

// ---------- keys ----------
// views on the digits, Shapr3D's: 1 home (iso), 2 front, 3 back, 4 top, 5 bottom, 6 right, 7 left; with or
// without ctrl, top row or numpad (by key position)
const VIEW_KEYS = { 1: () => home(), 2: [0, -1, 0], 3: [0, 1, 0], 4: [0, 0, 1], 5: [0, 0, -1], 6: [1, 0, 0], 7: [-1, 0, 0] };
for (const b of document.querySelectorAll('#tray-views [data-view]')) b.onclick = () => { const v = VIEW_KEYS[b.dataset.view]; typeof v === 'function' ? v() : orbitTo(v); };
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if (sectionKey(e)) { e.preventDefault(); return; }
  // Esc with the plain pointer and a part or group selected: let go of it (notes and tools take Esc otherwise)
  if (e.key === 'Escape' && annotate.getTool() === 'select' && (getSelection().part || getSelection().group)) { clearSelect(); return; }
  if (annotate.handleKey(e)) { e.preventDefault(); return; }
  const digit = !e.metaKey && !e.altKey && !e.shiftKey && e.code.match(/^(?:Digit|Numpad)(\d)$/)?.[1];
  const v = digit && VIEW_KEYS[digit];
  if (v) { typeof v === 'function' ? v() : orbitTo(v); e.preventDefault(); return; }
  if (e.key === 'f') fit();
  if (e.key === 'g') toggleGhost();
  if (e.key === 'o') setOrtho(!isOrtho());
  if (e.key === 's') toggleSection();
  if (e.key === 'b') boundsUI.toggleBox();
  if (e.key === 'n') toggleAnnotate();
});

// the server keeps the last pose this tab showed, so a CLI can ask "what is on screen"
let reportTimer = null;
controls.addEventListener('end', () => { clearTimeout(reportTimer); reportTimer = setTimeout(() => reportView(getPose(), hiddenParts()).catch(() => {}), 250); });

// ---------- live updates ----------
connect({
  open: () => getState().then((s) => { if (s.builtAt && (!app.state || s.builtAt !== app.state.builtAt)) refresh(s); }),
  building: () => { $('#status').textContent = 'rendering…'; },
  built: (s) => refresh(s),
  annotations: (d) => annotate.setDoc(d),
  view: (v) => {                       // someone (tools/notes view ...) asked every tab to look at this
    if (v.preset) fitView(v.preset);
    if (v.camera) setPose(v.camera);
    if (v.hidden) setHidden(v.hidden);
    console.log(`[viewer] view seq=${v.seq} applied`, v.preset ?? '', v.camera ? JSON.stringify(v.camera) : '');
  },
});
getState().then((s) => {
  if (s.error && !s.file) return showPicker(`${MODEL}: ${s.error}`);
  if (s.builtAt) refresh(s); else $('#status').textContent = 'rendering…';
});
loadRefs().then(() => annotate.load());   // notes may reference an overlay image, so the refs go first
installDebug({
  annotations: () => annotate.doc, setTool: annotate.setTool, tool: annotate.getTool, redraw: annotate.scheduleRedraw,
  selectAnn: annotate.selectAnn, scadPoints: annotate.scadPoints,
  refs: () => refs, overlay, section, shading, bounds: boundsUI.bounds, box: boundsUI.setBox, printer: setPrinter, grid: toggleGrid,
});
