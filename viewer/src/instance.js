// The Instance panel (right slot, above Parameters): the selected instance's placement and looks as scene.json has
// them, typed. A field saves on Enter or on leaving it (Esc puts it back); ↺ clears it to its default; the server's
// refusal shows under the field. While the gizmo drags, at and rot show the live numbers.
// Also copy, remove and rename, from here, the rail (rails.js) and the keys (editKey, called by main.js):
//   ctrl/cmd-z, shift-ctrl/cmd-z   undo, redo (edits.js; every scene change this session, outside ones too)
//   ctrl/cmd-d                     duplicate the selected instance: next free id, moved along X, selected after
//   e                              split out: the selected part into an instance of its own (core/scene.ts
//                                  splitInstance), where it is, selected with the gizmo on it; offered only while
//                                  its instance shows other parts too
//   delete / backspace             remove it (never the last one)
//   m                              hide / show the gizmo (move.js)
import { createElement, RotateCcw, Undo2, Redo2 } from 'lucide';
import { history, selectedInstance, instanceData, sceneOk, say, undo, redo } from './edits.js';
import { dragPreview, toggleMove, moveUI } from './move.js';
import { MATERIALS, select, selectGroup, clearSelect, multiInstance, setScene, sceneState, meshes, getSelection, moveHidden } from './parts.js';
import { getScene } from './api.js';
import { app } from './app.js';
import { bus } from './scene.js';
import { moveNotes } from './annotate.js';
import { moveBy, niceStep } from '../../core/transform.ts';
import { splitInstance, freeId } from '../../core/scene.ts';
import * as THREE from 'three';
import './instance.css';

const $ = (s) => document.querySelector(s);
const svg = (icon) => createElement(icon).outerHTML;
const panel = $('#inst-panel'), box = $('#inst');
const LOOK_NAMES = { pla: 'matte PLA', petg: 'PETG gloss', metal: 'die-cast metal', translucent: 'translucent' };
const SCALE_NOTE = 'scaling changes clearances; a real size change belongs in the model’s values';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v) => String(+(+v).toFixed(4));

// ---------- the rows ----------
let shown = null;      // the instance id the rows are for
const reset = (k) => `<button class="rs small" data-reset="${k}" title="reset ${k} to its default">${svg(RotateCcw)}</button>`;
function build(id) {
  shown = id;
  const vec = (k, unit) => [0, 1, 2].map((i) => `<input data-k="${k}" data-i="${i}" inputmode="decimal" spellcheck="false" title="${'xyz'[i]} ${unit}">`).join('');
  const mats = Object.keys(MATERIALS).map((m) => `<option value="${m}">${LOOK_NAMES[m] ?? m}</option>`).join('');
  box.innerHTML = `
    <div class="f" data-f="id"><label>id</label><div class="v"><input data-k="id" spellcheck="false" autocomplete="off" title="rename: letters, digits, _ and -"></div><span></span><small class="err" hidden></small></div>
    <div class="f" data-f="at"><label>at</label><div class="v v3">${vec('at', 'mm')}</div>${reset('at')}<small class="err" hidden></small></div>
    <div class="f" data-f="rot"><label>rot</label><div class="v v3">${vec('rot', '°')}</div>${reset('rot')}<small class="err" hidden></small></div>
    <div class="f" data-f="mirror"><label>mirror</label><div class="v v3">${[0, 1, 2].map((i) => `<button class="tog small" data-m="${i}" title="mirror across the plane normal to ${'XYZ'[i]} (one plane at a time: two flips are a turn)">${'XYZ'[i]}</button>`).join('')}</div>${reset('mirror')}<small class="err" hidden></small></div>
    <div class="f" data-f="scale"><label>scale</label><div class="v"><input data-k="scale" inputmode="decimal" spellcheck="false" title="one factor, or x, y, z"></div>${reset('scale')}<small class="note">${SCALE_NOTE}</small><small class="err" hidden></small></div>
    <div class="f" data-f="color"><label>color</label><div class="v"><input type="color" data-k="color"><span class="hex"></span></div>${reset('color')}<small class="err" hidden></small></div>
    <div class="f" data-f="material"><label>material</label><div class="v"><select data-k="material"><option value="">default (matte PLA)</option>${mats}</select></div>${reset('material')}<small class="err" hidden></small></div>
    <div class="f" data-f="scratch"><label>scratch</label><div class="v"><label class="chk" title="shown here, left out of _scene.scad, the check and the export"><input type="checkbox" data-k="scratch"> only for looking</label></div>${reset('scratch')}<small class="err" hidden></small></div>`;
  for (const inp of box.querySelectorAll('input[data-k]:not([type]), input[inputmode]')) {
    inp.onchange = () => commitText(inp);
    inp.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); clearErr(inp.dataset.k); fill(true); inp.blur(); }
    };
  }
  box.querySelector('input[type=color]').onchange = (e) => setField('color', e.target.value);
  box.querySelector('select').onchange = (e) => setField('material', e.target.value || null);
  box.querySelector('input[type=checkbox]').onchange = (e) => setField('scratch', e.target.checked || null);
  for (const b of box.querySelectorAll('[data-m]')) b.onclick = () => {
    const i = +b.dataset.m, cur = instanceData(shown)?.mirror ?? [0, 0, 0];
    const only = cur.every((v, j) => (j === i ? v !== 0 : v === 0));      // this axis alone is on: turn it off
    setField('mirror', only ? null : [0, 1, 2].map((j) => (j === i ? 1 : 0)));
  };
  for (const b of box.querySelectorAll('[data-reset]')) b.onclick = () => setField(b.dataset.reset, null);
}

// the values into the rows; a field being typed in keeps what is typed unless `force`
function fill(force = false) {
  const id = shown, inst = instanceData(id); if (!inst) return;
  const live = dragPreview(), d = live?.id === id ? live.fields : {};
  const pl = [...meshes.values()].find((m) => m.userData.placed?.instance === id)?.userData.placed;
  const put = (inp, v) => { if (force || document.activeElement !== inp) { inp.value = v; delete inp.dataset.bad; } };
  for (const inp of box.querySelectorAll('input[data-i]')) {
    const k = inp.dataset.k, v = d[k] ?? inst[k] ?? [0, 0, 0];
    put(inp, fmt(v[+inp.dataset.i]));
    inp.classList.toggle('live', !!d[k]);
  }
  put(box.querySelector('input[data-k=id]'), inst.id);
  const s = inst.scale ?? 1;
  put(box.querySelector('input[data-k=scale]'), Array.isArray(s) ? s.map(fmt).join(', ') : fmt(s));
  const m = inst.mirror ?? [0, 0, 0], axisOnly = m.filter((v) => v !== 0).length <= 1;
  for (const b of box.querySelectorAll('[data-m]')) b.classList.toggle('on', axisOnly && m[+b.dataset.m] !== 0);
  box.querySelector('[data-f=mirror] label').title = axisOnly ? '' : `mirror [${m.join(', ')}] (not along one axis)`;
  const c = box.querySelector('input[type=color]');
  c.value = inst.color ?? pl?.color ?? '#999999';
  box.querySelector('.hex').textContent = inst.color ?? 'part colours';
  box.querySelector('.hex').classList.toggle('muted', !inst.color);
  box.querySelector('select').value = inst.material ?? '';
  box.querySelector('input[type=checkbox]').checked = !!inst.scratch;
  for (const b of box.querySelectorAll('[data-reset]')) b.disabled = inst[b.dataset.reset] === undefined;
  for (const f of box.querySelectorAll('.f')) f.classList.toggle('set', inst[f.dataset.f] !== undefined && f.dataset.f !== 'id');
  $('#inst-id').textContent = id;
  $('#inst-undo').disabled = !history.canUndo; $('#inst-redo').disabled = !history.canRedo;
  $('#inst-remove').disabled = (sceneState()?.scene?.instances?.length ?? 0) <= 1;
  $('#inst-split').hidden = !splitTarget();
  $('#inst-undo').title = history.canUndo ? `undo: ${history.peek('undo').label} (ctrl-z)` : 'nothing to undo';
  $('#inst-redo').title = history.canRedo ? `redo: ${history.peek('redo').label} (shift-ctrl-z)` : 'nothing to redo';
}

// the panel follows the selection and every scene change
function sync() {
  const id = sceneOk() ? selectedInstance() : null;
  panel.hidden = !id || !instanceData(id);
  if (panel.hidden) { shown = null; return; }
  if (id !== shown) build(id);
  fill();
}
for (const ev of ['select', 'parts', 'placed', 'history']) bus.addEventListener(ev, sync);

// ---------- errors beside a field ----------
const fieldOf = (msg) => (/\bid\b/.test(msg) ? 'id' : msg.match(/\b(at|rot|mirror|scale|color|material|scratch|parts)\b/)?.[1]);
function showErr(k, msg) {
  const el = box.querySelector(`[data-f="${k}"] .err`);
  if (!el) { say(msg, true); return; }
  el.textContent = msg.replace(/^instances\[\d+\]( \([^)]*\))?: /, ''); el.hidden = false;
}
const clearErr = (k) => { const el = box.querySelector(`[data-f="${k}"] .err`); if (el) el.hidden = true; };
function refused(k, r) {
  const msgs = r.errors?.length ? r.errors : [r.error ?? 'not saved'];
  for (const m of msgs) showErr(fieldOf(m.replace(/^instances\[\d+\]( \([^)]*\))?: /, '')) ?? k, m);
}

// ---------- saving ----------
async function setField(k, v) {
  const id = shown; if (!id) return;
  clearErr(k);
  const r = await history.setFields(id, { [k]: v }, `${v == null ? 'reset' : 'set'} ${k} of ${id}`);
  if (!r.ok) refused(k, r);
  fill();
}
function commitText(inp) {
  const k = inp.dataset.k, inst = instanceData(shown); if (!inst) return;
  clearErr(k);
  if (k === 'id') { const to = inp.value.trim(); if (to && to !== shown) rename(shown, to); else fill(true); return; }
  if (k === 'at' || k === 'rot') {
    const vals = [...box.querySelectorAll(`input[data-k="${k}"]`)].map((x) => x.value.trim()).map((x) => (x === '' ? 0 : Number(x)));
    if (vals.some((x) => !Number.isFinite(x))) { showErr(k, `${k} wants three numbers`); return; }
    if (vals.every((x, i) => x === (inst[k] ?? [0, 0, 0])[i])) return;
    setField(k, vals.every((x) => x === 0) ? null : vals);
    return;
  }
  if (k === 'scale') {
    const vals = inp.value.replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean).map(Number);
    if (!(vals.length === 1 || vals.length === 3) || vals.some((x) => !Number.isFinite(x))) { showErr(k, 'scale wants one number or x, y, z'); return; }
    const v = vals.length === 1 ? vals[0] : vals;
    setField(k, (Array.isArray(v) ? v.every((x) => x === 1) : v === 1) ? null : v);
  }
}

// ---------- copy, remove, rename ----------
// select an instance as a whole: its group while there are several, else the part that was selected (or its first)
function selectInstance(id, part = null) {
  if (multiInstance()) { selectGroup(id); return; }
  const paths = [...meshes.keys()].filter((p) => p.startsWith(`${id}.`));
  select(paths.find((p) => p === `${id}.${part}`) ?? paths[0]);
}
// the scene with the new state in it, so the new meshes exist before selecting
const settle = async () => setScene(await getScene());
const free = (id, ids) => { const base = id.replace(/_\d+$/, ''); let n = 2; while (ids.includes(`${base}_${n}`)) n++; return `${base}_${n}`; };

export async function duplicate() {
  const id = selectedInstance(); if (!id || !sceneOk()) return;
  const ids = sceneState().scene.instances.map((x) => x.id), to = free(id, ids);
  // half its width along X, in a round step, so it reads as a second one beside the first
  const b = new THREE.Box3();
  for (const m of meshes.values()) if (m.userData.placed?.instance === id && m.userData.part?.ok) b.expandByObject(m);
  const off = Math.max(5, niceStep((b.isEmpty() ? 20 : b.getSize(new THREE.Vector3()).x) * 0.5 / 8));
  const r = await history.change(`copy ${id} to ${to}`, (s) => {
    const i = s.instances.findIndex((x) => x.id === id); if (i < 0) throw new Error(`no instance ${id}`);
    const c = { ...structuredClone(s.instances[i]), id: to, at: moveBy(s.instances[i], [off, 0, 0]) };
    s.instances.splice(i + 1, 0, c); return s;
  });
  if (!r.ok) { say(`copy ${id}: ${r.error}`, true); return; }
  await settle(); selectInstance(to);
  say(`copied ${id} to ${to}, ${off} mm along X`);
}
export async function removeSelected() {
  const id = selectedInstance(); if (!id || !sceneOk()) return;
  if (sceneState().scene.instances.length <= 1) { say(`${id} is the only instance; a scene keeps one`, true); return; }
  const r = await history.change(`remove ${id}`, (s) => {
    const i = s.instances.findIndex((x) => x.id === id); if (i < 0) throw new Error(`no instance ${id}`);
    s.instances.splice(i, 1); return s;
  });
  if (!r.ok) { say(`remove ${id}: ${r.error}`, true); return; }
  clearSelect(); await settle();
  say(`removed ${id} (ctrl-z brings it back)`);
}
// Split out: the selected part, while its instance shows other parts too: { id, part } or null
export function splitTarget() {
  const { part, group } = getSelection();
  if (!part || group || !sceneOk()) return null;
  const pl = meshes.get(part)?.userData.placed; if (!pl) return null;
  return (sceneState().parts ?? []).filter((p) => p.instance === pl.instance).length > 1 ? { id: pl.instance, part: pl.part } : null;
}
// one undo step through the same write path as Duplicate; the part's hidden state and its notes go with it
export async function splitOut() {
  const t = splitTarget();
  if (!t) { const id = selectedInstance(); if (id && getSelection().part) say(`${id} shows only this part: nothing to split it from (move ${id} itself)`, true); return; }
  let to = null;
  const r = await history.change(`split ${t.part} out of ${t.id}`, (s) => {
    to = freeId(s, t.part);           // on the scene the write is based on (a 409 rebuilds it on the fresh one)
    return splitInstance(s, { parts: app.state.parts }, t.id, t.part, to);
  });
  if (!r.ok) { say(`split ${t.part} out of ${t.id}: ${r.error}`, true); return; }
  moveHidden(`${t.id}.${t.part}`, `${to}.${t.part}`);
  await settle(); select(`${to}.${t.part}`);
  if (!moveUI().on) toggleMove(true);
  const notes = await moveNotes(t.id, t.part, to).catch(() => 0);
  say(`split ${t.part} out of ${t.id} as ${to}${notes ? `; ${notes} note${notes === 1 ? ' on it follows' : 's on it follow'} it` : ''} (ctrl-z puts it back)`);
}
async function rename(from, to) {
  const part = getSelection().part?.split('.').slice(1).join('.') ?? null;
  const r = await history.change(`rename ${from} to ${to}`, (s) => {
    const inst = s.instances.find((x) => x.id === from); if (!inst) throw new Error(`no instance ${from}`);
    inst.id = to; return s;
  });
  if (!r.ok) { refused('id', r); return; }
  await settle(); selectInstance(to, part);
}

$('#inst-copy').onclick = duplicate;
$('#inst-split').onclick = splitOut;
$('#inst-remove').onclick = removeSelected;
$('#inst-undo').innerHTML = svg(Undo2); $('#inst-redo').innerHTML = svg(Redo2);
$('#inst-undo').onclick = undo; $('#inst-redo').onclick = redo;

// main.js: keys, after the note tools had theirs; true when used
export function editKey(e) {
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (mod && !e.altKey && k === 'z') { e.shiftKey ? redo() : undo(); return true; }
  if (mod && !e.altKey && !e.shiftKey && k === 'd') { if (selectedInstance()) duplicate(); return true; }
  if (!mod && (e.key === 'Delete' || e.key === 'Backspace') && selectedInstance()) { removeSelected(); return true; }
  if (!mod && !e.altKey && k === 'm') { toggleMove(); return true; }
  if (!mod && !e.altKey && k === 'e' && getSelection().part) { splitOut(); return true; }
  return false;
}
sync();
