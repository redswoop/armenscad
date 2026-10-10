// Entry point: which model, the picker, keyboard, view buttons, and the SSE wiring.
// The work lives in scene.js (three.js), parts.js (meshes, picking, selection), params.js (the panel),
// annotate.js (drawing + notes), refs.js (reference images), overlay.js (image as a plane), section.js
// (clipping plane), shading.js (shadows, edges, headlight), api.js (server).
import { MODEL, getModels, getState, connect, reportView } from './api.js';
import { app } from './app.js';
import { fit, fitView, setOrtho, isOrtho, setPose, getPose, controls } from './scene.js';
import { refresh, toggleGhost, hiddenParts, setHidden } from './parts.js';
import * as annotate from './annotate.js';
import { loadRefs, refs } from './refs.js';
import * as overlay from './overlay.js';
import { section, toggleSection } from './section.js';
import { shading } from './shading.js';
import * as boundsUI from './bounds.js';
import { installDebug } from './debug.js';

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

// ---------- views + keys ----------
document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => fitView(b.dataset.view)));
$('#fit').onclick = () => fit();
$('#ortho').onclick = () => setOrtho(!isOrtho());
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if (annotate.handleKey(e)) { e.preventDefault(); return; }
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
