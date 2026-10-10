// The parameter panel. It lists every top-of-file assignment, in file order, under its `// ---- section ----`
// heading. That is a lot, so: sections fold (click the heading; remembered per model), a filter box matches names
// and comments, and selecting a part narrows the list to the parameters its modules mention (plus whatever those
// are computed from), with a "selection only" checkbox to turn that off.
// Edits are posted as overrides: the server re-renders with them, the .scad file is untouched.
import { app } from './app.js';
import { MODEL, postOverrides } from './api.js';

const $ = (s) => document.querySelector(s);
const folded = new Set(JSON.parse(localStorage.getItem(`folded:${MODEL}`) ?? '[]'));
let focus = null;   // Set of parameter names for the selected part, or null = no selection
const idents = (code) => new Set(code.replace(/\/\/.*$/gm, '').match(/[A-Za-z_$][\w$]*/g) ?? []);

export function focusParams(code) {
  if (code === null) { focus = null; renderParams(app.state.params); return; }
  const names = new Set(app.state.params.map((p) => p.name));
  const used = idents(code);
  focus = new Set([...used].filter((n) => names.has(n)));
  for (let grew = true; grew;) {   // pull in what the focused parameters are computed from, until nothing new appears
    grew = false;
    for (const p of app.state.params) if (focus.has(p.name)) for (const n of idents(p.value)) if (names.has(n) && !focus.has(n)) { focus.add(n); grew = true; }
  }
  renderParams(app.state.params);
}

export function renderParams(params) {
  const box = $('#params'); box.innerHTML = '';
  const q = $('#p-filter').value.trim().toLowerCase();
  const narrow = focus && $('#p-sel').checked;
  $('#p-sel-wrap').hidden = !focus;
  let sec = null, secBox = null, nShown = 0;
  for (const p of params) {
    if (narrow && !focus.has(p.name)) continue;
    if (q && !(p.name.toLowerCase().includes(q) || p.comment.toLowerCase().includes(q) || p.section.toLowerCase().includes(q))) continue;
    nShown++;
    if (p.section !== sec) {
      sec = p.section;
      const h = document.createElement('div'); h.className = 'sec' + (folded.has(sec) && !q && !narrow ? ' closed' : ''); h.textContent = sec;
      secBox = document.createElement('div'); secBox.className = 'secbox';
      h.onclick = () => { folded.has(sec) ? folded.delete(sec) : folded.add(sec); localStorage.setItem(`folded:${MODEL}`, JSON.stringify([...folded])); h.classList.toggle('closed'); };
      box.appendChild(h); box.appendChild(secBox);
    }
    const ov = app.state.overrides[p.name];
    const isStr = /^"[^"]*"$/.test(p.value);                                       // "cairo" -> shown and edited without the quotes
    const derived = !isStr && !/^-?[\d.]+$|^(true|false)$|^\[[^()]*\]$/.test(p.value);   // expressions stay read-only
    const shown = (v) => (isStr ? String(v).replace(/^"|"$/g, '') : v);
    const d = document.createElement('div'); d.className = 'p';
    d.innerHTML = `<label title="${p.name}">${p.name}</label><input data-name="${p.name}" data-str="${isStr}" value="${String(shown(ov ?? p.value)).replace(/"/g, '&quot;')}" ${ov !== undefined ? 'class="dirty"' : ''} ${derived ? 'readonly title="derived: ' + p.value.replace(/"/g, '&quot;') + '"' : ''}>` + (p.comment ? `<small>${p.comment.replace(/</g, '&lt;')}</small>` : '');
    const inp = d.querySelector('input');
    inp.oninput = () => inp.classList.toggle('dirty', inp.value !== shown(p.value));
    inp.onkeydown = (e) => { if (e.key === 'Enter') applyParams(); };
    secBox.appendChild(d);
  }
  $('#p-count').textContent = nShown === params.length ? `${params.length}` : `${nShown} of ${params.length}`;
}
$('#p-filter').oninput = () => renderParams(app.state.params);
$('#p-sel').onchange = () => renderParams(app.state.params);

export async function applyParams() {
  const ov = {};
  for (const inp of document.querySelectorAll('#params input:not([readonly])')) {
    const p = app.state.params.find((x) => x.name === inp.dataset.name);
    const v = inp.dataset.str === 'true' ? `"${inp.value}"` : inp.value;      // string params get their quotes back
    if (v !== p.value) ov[p.name] = v;
  }
  await postOverrides(ov);
}
$('#apply').onclick = applyParams;
$('#reset').onclick = () => postOverrides({});
