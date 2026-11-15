// Entry point: which model, the pickers (the page with no model, the dialog behind the title), keyboard, and
// the SSE wiring. The work lives in scene.js (three.js), parts.js (meshes, picking, selection), params.js (the
// panel), annotate.js (drawing + notes), refs.js (reference images), overlay.js (image as a plane), section.js
// (clipping plane), shading.js (shadows, edges, headlight), grid.js (the ground grid, the print bed), viewcube.js (the cube), rails.js (the two rails,
// their trays, the tool card), hud.js (foldable panels, slot widths), theme.js (the page skin, text size),
// api.js (server).
import { MODEL, getModels, getWorkspace, getState, getScene, connect, disconnect, reportView } from './api.js';
import { workspaceTree, shortFor } from './workspace.js';
import { app } from './app.js';
import { fit, fitView, setOrtho, isOrtho, setPose, getPose, controls, orbitTo } from './scene.js';
import { refresh, setScene, toggleGhost, hiddenParts, setHidden, getSelection, clearSelect, toggleCode } from './parts.js';
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
import { editKey } from './instance.js';

const $ = (s) => document.querySelector(s);
document.title = MODEL ? `${MODEL} · scad viewer` : 'scad viewer';

// The page with no model: the workspace by project (workspace.js). A project folds; inside, assemblies first, then
// the other models, then its subfolders as folded groups. /<project>/ (a folder that is not itself a model) is the
// same page with that project open. What is open is remembered.
const OPEN = 'armenscad.projects';
async function showPicker(msg) {
  const { models, about } = await getWorkspace();
  const tree = workspaceTree(models);
  // a URL that names a project or a group, not a model, is no error: it opens that project
  const here = MODEL && tree.find((p) => p.name === MODEL.split('/')[0] && !models.some((m) => m.name === MODEL));
  let open; try { open = new Set(JSON.parse(localStorage.getItem(OPEN) ?? '[]')); } catch { open = new Set(); }
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const status = (m) => (m.loaded ? (m.error ? 'error' : m.building ? 'rendering' : m.failed ? `${m.failed} failed` : 'built') : '') + (m.clients ? ` · ${m.clients} open` : '');
  const row = (m, project, label = m.short) => {
    const what = m.assembly ? `assembly of ${m.uses.map((u) => shortFor(u, project)).join(', ')}` : m.reference ? 'reference mesh' : m.file ?? '';
    const used = m.usedBy.length ? `used by ${m.usedBy.map((u) => shortFor(u, project)).join(', ')}` : '';
    return `<li class="${m.assembly ? 'asm' : ''}"><a href="/${m.name}/">${esc(label)}</a><span class="muted">${esc([what, used, status(m)].filter(Boolean).join(' · '))}</span></li>`;
  };
  const group = (g, project) => `<li class="fold"><details data-k="${esc(g.path)}" ${open.has(g.path) || (!g.folded && !open.has(`-${g.path}`)) || MODEL === g.path ? 'open' : ''}>
    <summary><b>${esc(g.name)}</b><span class="muted">${g.models.length}${about[g.path] ? ` · ${esc(about[g.path])}` : g.reference ? ' · reference meshes' : ''}</span></summary>
    <ul>${g.models.map((m) => row(m, project)).join('')}</ul></details></li>`;
  const project = (p) => (p.single ? row(p.single, '', p.single.name)
    : `<li class="fold proj"><details data-k="${esc(p.name)}" ${open.has(p.name) || here === p || tree.length === 1 ? 'open' : ''}>
    <summary><b>${esc(p.name)}</b><span class="muted">${p.count} models${about[p.name] ? ` · ${esc(about[p.name])}` : ''}</span></summary>
    <ul>${p.direct.map((m) => row(m, p.name)).join('')}${p.groups.map((g) => group(g, p.name)).join('')}</ul></details></li>`);
  $('#pick-msg').textContent = here ? '' : msg ?? '';
  $('#pick-list').innerHTML = tree.length ? tree.map(project).join('') : '<li class="muted">no folder with a viewer.json found</li>';
  for (const d of document.querySelectorAll('#pick-list details')) d.ontoggle = () => {
    const k = d.dataset.k;       // "-k": a group that starts open was folded by hand
    open.delete(k); open.delete(`-${k}`); open.add(d.open ? k : `-${k}`);
    try { localStorage.setItem(OPEN, JSON.stringify([...open])); } catch {}
  };
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
  if (editKey(e)) { e.preventDefault(); return; }
  const digit = !e.metaKey && !e.altKey && !e.shiftKey && e.code.match(/^(?:Digit|Numpad)(\d)$/)?.[1];
  const v = digit && VIEW_KEYS[digit];
  if (v) { typeof v === 'function' ? v() : orbitTo(v); e.preventDefault(); return; }
  if (e.key === 'f') fit();
  if (e.key === 'g') toggleGhost();
  if (e.key === 'o') setOrtho(!isOrtho());
  if (e.key === 's') toggleSection();
  if (e.key === 'b') boundsUI.toggleBox();
  if (e.key === 'c' && !e.metaKey && !e.ctrlKey) toggleCode();
  if (e.key === 'n') toggleAnnotate();
});

// the server keeps the last pose this tab showed, so a CLI can ask "what is on screen"
let reportTimer = null;
controls.addEventListener('end', () => { clearTimeout(reportTimer); reportTimer = setTimeout(() => reportView(getPose(), hiddenParts()).catch(() => {}), 250); });

// ---------- live updates ----------
connect({
  open: () => getState().then((s) => {
    if (s.builtAt && (!app.state || s.builtAt !== app.state.builtAt)) refresh(s);
    else if (app.state) getScene().then(setScene);    // a scene edit missed while the stream was down
  }),
  building: () => { $('#status').textContent = 'rendering…'; },
  built: (s) => refresh(s),
  annotations: (d) => annotate.setDoc(d),
  scene: (st) => setScene(st),         // scene.json changed (CLI, Claude, a hand edit, another tab): re-place, no rebuild
  view: (v) => {                       // someone (tools/notes view ...) asked every tab to look at this
    if (v.preset) fitView(v.preset);
    if (v.camera) setPose(v.camera);
    if (v.hidden) setHidden(v.hidden);
    console.log(`[viewer] view seq=${v.seq} applied`, v.preset ?? '', v.camera ? JSON.stringify(v.camera) : '');
  },
});
getState().then((s) => {
  // no such model (the server's 404 carries no model): the picker, which opens the project if the URL names one.
  // Not s.file: an assembly has no file of its own, and its build can fail.
  if (s.error && !s.model) { disconnect(); return showPicker(`${MODEL}: ${s.error}`); }
  if (s.builtAt) refresh(s); else $('#status').textContent = 'rendering…';
});
loadRefs().then(() => annotate.load());   // notes may reference an overlay image, so the refs go first
installDebug({
  annotations: () => annotate.doc, setTool: annotate.setTool, tool: annotate.getTool, redraw: annotate.scheduleRedraw,
  selectAnn: annotate.selectAnn, scadPoints: annotate.scadPoints,
  refs: () => refs, overlay, section, shading, bounds: boundsUI.bounds, box: boundsUI.setBox, printer: setPrinter, grid: toggleGrid,
});
