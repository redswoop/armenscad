// Entry point: which model, the picker, keyboard, view buttons, and the SSE wiring.
// The work lives in scene.js (three.js), parts.js (meshes, picking, selection), params.js (the panel),
// annotate.js (drawing + notes), refs.js (reference images), overlay.js (image as a plane), section.js
// (clipping plane), shading.js (shadows, edges, headlight), viewcube.js (the cube and camera buttons), hud.js
// (the dock's popover, foldable sidebar sections), theme.js (the page skin, text size), api.js (server).
import { MODEL, getModels, getState, connect, reportView } from './api.js';
import { app } from './app.js';
import { fit, fitView, setOrtho, isOrtho, setPose, getPose, controls, orbitTo } from './scene.js';
import { refresh, toggleGhost, hiddenParts, setHidden } from './parts.js';
import * as annotate from './annotate.js';
import { loadRefs, refs } from './refs.js';
import * as overlay from './overlay.js';
import { section, toggleSection, sectionKey } from './section.js';
import { shading } from './shading.js';
import * as boundsUI from './bounds.js';
import { installDebug } from './debug.js';
import { installSkinPicker } from './theme.js';
import { home } from './viewcube.js';
import { closePop } from './hud.js';

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
async function fillSwitcher() {
  const list = await getModels();
  const sel = $('#switch');
  sel.innerHTML = list.map((m) => `<option value="${m.name}" ${m.name === MODEL ? 'selected' : ''}>${m.name}</option>`).join('');
  sel.onchange = () => { location.href = `/${sel.value}/`; };
}
if (!MODEL) { showPicker(); throw new Error('no model in url'); }
fillSwitcher();
installSkinPicker($('#skin'));

// ---------- keys ----------
// views on the digits, Shapr3D's: 1 home (iso), 2 front, 3 back, 4 top, 5 bottom, 6 right, 7 left; with or
// without ctrl, top row or numpad (by key position)
const VIEW_KEYS = { 1: () => home(), 2: [0, -1, 0], 3: [0, 1, 0], 4: [0, 0, 1], 5: [0, 0, -1], 6: [1, 0, 0], 7: [-1, 0, 0] };
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Escape' && closePop()) return;
  if (sectionKey(e)) { e.preventDefault(); return; }
  if (annotate.handleKey(e)) { e.preventDefault(); return; }
  const digit = !e.metaKey && !e.altKey && !e.shiftKey && e.code.match(/^(?:Digit|Numpad)(\d)$/)?.[1];
  const v = digit && VIEW_KEYS[digit];
  if (v) { typeof v === 'function' ? v() : orbitTo(v); e.preventDefault(); return; }
  if (e.key === 'f') fit();
  if (e.key === 'g') toggleGhost();
  if (e.key === 'o') setOrtho(!isOrtho());
  if (e.key === 's') toggleSection();
  if (e.key === 'b') boundsUI.toggleBox();
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
  refs: () => refs, overlay, section, shading, bounds: boundsUI.bounds, box: boundsUI.setBox,
});
