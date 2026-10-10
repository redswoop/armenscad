// Annotations: draw on the render (pen, arrow, text, picked points), keep them in <model>/annotations.json via the
// server, list them in the sidebar, and re-project them as the camera moves.
//
// The SVG #ink sits over the WebGL canvas and never takes pointer events. While a tool is active, pointer events are
// intercepted in the capture phase on #stage (before OrbitControls on the canvas sees them) for the left button
// only, so wheel zoom and right/middle drags keep working while drawing.
//
// Every stroke records the camera pose, the canvas size, its points as [u, v] in 0..1 (v down), and `hits`: the
// ray-cast of sampled points onto the parts (part name + world mm). Strokes are screen-space and go stale when the
// geometry changes; the hits are the durable anchor and are what Claude acts on.
import * as THREE from 'three';
import { stage, canvas, bus, getPose, setPose, poseDiff, toScreen, project, canvasSize, bounds, uvToNDC } from './scene.js';
import { pickPart, hiddenParts } from './parts.js';
import { getAnnotations, postAnnotation, patchAnnotation, deleteAnnotation } from './api.js';

const $ = (s) => document.querySelector(s);
const ink = $('#ink'), entry = $('#text-entry');
const r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;

export let doc = { version: 1, rev: 0, annotations: [], overlays: [] };   // mirror of the server's file
let docText = '';
let selectedId = null, pendingFocus = null;
const listeners = new Set();                        // called with doc after every change (overlay.js watches overlays)
export const onDoc = (fn) => listeners.add(fn);

// ---------- tools ----------
const tools = {};
let tool = 'select', drawing = false, cur = null;    // cur: the stroke in progress { kind, pts }
export function registerTool(name, t) { tools[name] = t; }
export const getTool = () => tool;
export function setTool(name) {
  if (!tools[name]) return;
  if (name !== tool) { tools[tool].cancel?.(); cur = null; drawing = false; }
  tool = name;
  stage.className = name === 'select' ? '' : `tool-${name}`;
  for (const b of document.querySelectorAll('#tools [data-tool]')) b.classList.toggle('on', b.dataset.tool === name);
  $('#tool-hint').textContent = tools[name].hint ?? '';
  $('#tip').hidden = true;
  console.log('[viewer] tool', name);
  scheduleRedraw();
}
document.querySelectorAll('#tools [data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));

const ctx = (ev) => { const { u, v, ndc } = toScreen(ev); const [W, H] = canvasSize(); return { u, v, ndc, ev, W, H }; };
const onStage = (ev) => ev.target === canvas || ev.target === ink || ev.target === stage;
stage.addEventListener('pointerdown', (ev) => {
  if (tool === 'select' || ev.button !== 0 || !onStage(ev)) return;
  ev.stopPropagation(); ev.preventDefault();
  stage.setPointerCapture(ev.pointerId); drawing = true;
  tools[tool].down?.(ctx(ev));
}, { capture: true });
stage.addEventListener('pointermove', (ev) => {
  if (tool === 'select' || !onStage(ev)) return;
  ev.stopPropagation();
  if (drawing) tools[tool].move?.(ctx(ev)); else tools[tool].hover?.(ctx(ev));
}, { capture: true });
stage.addEventListener('pointerup', (ev) => {
  if (!drawing) return;
  ev.stopPropagation(); drawing = false;
  try { stage.releasePointerCapture(ev.pointerId); } catch {}
  tools[tool].up?.(ctx(ev));
}, { capture: true });
canvas.addEventListener('click', (ev) => { if (tool !== 'select') ev.stopImmediatePropagation(); }, { capture: true });

// keys the tools care about; returns true when consumed. main.js calls this first.
export function handleKey(e) {
  const map = { v: 'select', p: 'pen', a: 'arrow', t: 'text', k: 'points' };
  if (map[e.key] && !e.metaKey && !e.ctrlKey) { setTool(map[e.key]); return true; }
  if (e.key === 'Escape') { tools[tool].cancel?.(); cur = null; drawing = false; if (tool !== 'select') setTool('select'); else selectAnn(null); scheduleRedraw(); return true; }
  if (tools[tool].key?.(e)) return true;
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && tool === 'select') { removeAnn(selectedId); return true; }
  return false;
}

// a small text prompt at a screen position (captions, calibration distances): resolves with the text or null
export function askText(u, v, placeholder, initial = '') {
  const [W, H] = canvasSize();
  entry.style.left = Math.min(u * W + 8, W - 220) + 'px'; entry.style.top = Math.min(v * H - 12, H - 30) + 'px';
  entry.placeholder = placeholder; entry.value = initial; entry.hidden = false; entry.focus();
  return new Promise((resolve) => {
    entry.onkeydown = (e) => {
      if (e.key === 'Enter') { const t = entry.value.trim(); entry.hidden = true; resolve(t || null); }
      if (e.key === 'Escape') { entry.hidden = true; resolve(null); }
      e.stopPropagation();
    };
    entry.onblur = () => { if (!entry.hidden) { entry.hidden = true; resolve(null); } };
  });
}

const dist = (a, b, W, H) => Math.hypot((a[0] - b[0]) * W, (a[1] - b[1]) * H);

registerTool('select', { hint: '' });
registerTool('pen', {
  hint: 'drag to draw · Esc cancels',
  down: (c) => { cur = { kind: 'pen', pts: [[r3(c.u), r3(c.v)]] }; scheduleRedraw(); },
  move: (c) => { if (!cur) return; const last = cur.pts[cur.pts.length - 1]; if (dist(last, [c.u, c.v], c.W, c.H) > 2) { cur.pts.push([r3(c.u), r3(c.v)]); scheduleRedraw(); } },
  up: () => { if (cur && cur.pts.length > 1) commit(cur); cur = null; scheduleRedraw(); },
  cancel: () => { cur = null; },
});
registerTool('arrow', {
  hint: 'drag from the note to the thing · Esc cancels',
  down: (c) => { cur = { kind: 'arrow', pts: [[r3(c.u), r3(c.v)], [r3(c.u), r3(c.v)]] }; },
  move: (c) => { if (cur) { cur.pts[1] = [r3(c.u), r3(c.v)]; scheduleRedraw(); } },
  up: (c) => { if (cur && dist(cur.pts[0], cur.pts[1], c.W, c.H) > 6) commit(cur); cur = null; scheduleRedraw(); },
  cancel: () => { cur = null; },
});
registerTool('text', {
  hint: 'click where the label goes, type, Enter',
  up: async (c) => {
    const text = await askText(c.u, c.v, 'label…');
    if (text) commit({ kind: 'text', pts: [[r3(c.u), r3(c.v)]], caption: text });
  },
});
// points: each click adds a model-space point (overlay plane first, else the part surface); Enter commits
let pointSource = null;                   // set by overlay.js: (ndc) -> { point: Vector3, plane, overlay } | null
export const setPointSource = (fn) => { pointSource = fn; };
registerTool('points', {
  hint: 'click points on the overlay or a part · Backspace undoes · Enter saves',
  up: (c) => {
    const src = pointSource?.(c.ndc);
    const hit = src ?? (() => { const h = pickPart(c.ndc); return h ? { point: h.point, plane: null, overlay: null, part: h.name } : null; })();
    if (!hit) return;
    cur ??= { kind: 'points', xyz: [], plane: hit.plane, overlay: hit.overlay, closed: false };
    cur.xyz.push([r2(hit.point.x), r2(hit.point.y), r2(hit.point.z)]);
    console.log(`[viewer] point ${cur.xyz.length} (${cur.xyz.at(-1).join(', ')})${hit.part ? ' on ' + hit.part : ''}`);
    scheduleRedraw();
  },
  key: (e) => {
    if (e.key === 'Backspace' && cur) { cur.xyz.pop(); if (!cur.xyz.length) cur = null; scheduleRedraw(); return true; }
    if (e.key === 'Enter' && cur?.xyz.length) { commit(cur); cur = null; scheduleRedraw(); return true; }
    return false;
  },
  cancel: () => { cur = null; },
});

// ---------- saving ----------
function sampleHits(pts) {
  const N = Math.max(1, Math.ceil(pts.length / 40)), out = [];
  for (let i = 0; i < pts.length; i++) {
    if (i !== 0 && i !== pts.length - 1 && i % N !== 0) continue;
    const h = pickPart(uvToNDC(pts[i][0], pts[i][1]));
    out.push({ i, part: h?.name ?? null, xyz: h ? [r2(h.point.x), r2(h.point.y), r2(h.point.z)] : null });
  }
  return out;
}
async function commit(a) {
  a.camera = getPose(); a.hidden = hiddenParts(); a.canvas = canvasSize(); a.caption ??= '';
  if (a.pts) a.hits = sampleHits(a.pts);
  const r = await postAnnotation(a);
  if (!r.ok) { console.warn('[viewer] annotation not saved', r); return; }
  const n = a.hits?.filter((h) => h.part).length ?? a.xyz?.length ?? 0, m = a.hits?.length ?? a.xyz?.length ?? 0;
  console.log(`[viewer] annotation saved ${r.id} ${a.kind} hits=${n}/${m}`);
  pendingFocus = r.id; selectedId = r.id;
  load();                                           // the SSE will also deliver it; this covers a dead stream
}
export async function load() { setDoc(await getAnnotations().catch(() => null)); }
export function setDoc(d) {
  if (!d || d.version !== 1) return;
  const text = JSON.stringify(d);
  if (text === docText) return;
  doc = d; docText = text;
  console.log(`[viewer] annotations rev=${d.rev} n=${d.annotations.length} overlays=${d.overlays.length}`);
  renderList(); scheduleRedraw();
  for (const fn of listeners) fn(doc);
}
async function removeAnn(id) { await deleteAnnotation(id); if (selectedId === id) selectedId = null; load(); }
export function selectAnn(id, go = false) {
  selectedId = id;
  const a = doc.annotations.find((x) => x.id === id);
  if (a && go && a.camera) setPose(a.camera);
  renderList(); scheduleRedraw();
}

// ---------- sidebar list ----------
const glyph = { pen: '✎', arrow: '➚', text: 'T', points: '⦿' };
function renderList() {
  const ul = $('#annots'); ul.innerHTML = '';
  const showDone = $('#a-showdone').checked;
  const items = doc.annotations.filter((a) => showDone || a.status !== 'done');
  $('#a-count').textContent = `${doc.annotations.filter((a) => a.status !== 'done').length} open`;
  const pose = getPose(), diag = bounds().getSize(new THREE.Vector3()).length();
  for (const a of items) {
    const li = document.createElement('li');
    li.className = `${a.status === 'done' ? 'done ' : ''}${a.id === selectedId ? 'selected ' : ''}${a.by === 'claude' ? 'claude ' : ''}${!anchored(a) && !poseClose(a.camera, pose, diag) ? 'ghost' : ''}`;
    const where = a.kind === 'points' ? `${a.xyz.length} pts${a.plane ? ' ' + a.plane : ''}` : (a.hits?.find((h) => h.part) ? `on ${a.hits.find((h) => h.part).part}` : 'not on a part');
    li.innerHTML = `<div class="a-row"><input type="checkbox" class="done" ${a.status === 'done' ? 'checked' : ''} title="done">` +
      `<span class="k">${glyph[a.kind] ?? '?'} ${a.id}</span><span class="w muted">${where}</span>` +
      `<button class="small go" title="look at it">go</button><button class="small rm" title="delete">×</button></div>` +
      `<input class="cap" placeholder="caption… (Enter saves)" value="${(a.caption ?? '').replace(/"/g, '&quot;')}">` +
      (a.reply ? `<div class="reply">↳ ${a.reply}</div>` : '') +
      (a.kind === 'points' ? `<pre class="pts">${fmtPoints(a)}</pre><button class="small copy">copy</button>` : '') +
      (li.className.includes('ghost') ? '<div class="muted small-note">drawn from another view · click to go there</div>' : '');
    li.querySelector('.done').onclick = (e) => { e.stopPropagation(); patchAnnotation(a.id, { status: e.target.checked ? 'done' : 'open' }).then(load); };
    li.querySelector('.go').onclick = (e) => { e.stopPropagation(); selectAnn(a.id, true); };
    li.querySelector('.rm').onclick = (e) => { e.stopPropagation(); removeAnn(a.id); };
    const cap = li.querySelector('.cap');
    cap.onclick = (e) => e.stopPropagation();
    cap.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { patchAnnotation(a.id, { caption: cap.value }).then(load); cap.blur(); } if (e.key === 'Escape') cap.blur(); };
    cap.onchange = () => { if (cap.value !== (a.caption ?? '')) patchAnnotation(a.id, { caption: cap.value }).then(load); };
    li.querySelector('.copy')?.addEventListener('click', (e) => { e.stopPropagation(); navigator.clipboard.writeText(scadPoints(a)); e.target.textContent = 'copied'; setTimeout(() => (e.target.textContent = 'copy'), 900); });
    li.onclick = () => selectAnn(a.id, true);
    ul.appendChild(li);
    if (a.id === pendingFocus) { pendingFocus = null; cap.focus(); li.scrollIntoView({ block: 'nearest' }); }
  }
  if (!items.length) ul.innerHTML = '<li class="muted empty">none — pick a tool above the render and draw</li>';
}
$('#a-showdone').onchange = renderList;
// the two in-plane coordinates for a points note ("x z" for XZ), or all three when it was picked off parts
const planeAxes = { XY: [0, 1], XZ: [0, 2], YZ: [1, 2] };
const planePts = (a) => { const ax = planeAxes[a.plane]; return a.xyz.map((p) => (ax ? [p[ax[0]], p[ax[1]]] : p)); };
const fmtPoints = (a) => planePts(a).map((p, i) => `${String(i + 1).padStart(2)}  ${p.map((v) => v.toFixed(2).padStart(8)).join(' ')}`).join('\n');
export const scadPoints = (a, name = a.id + '_pts') => `${name} = [${planePts(a).map((p) => `[${p.join(', ')}]`).join(', ')}];  // ${a.plane ?? 'xyz'} from ${a.overlay ?? 'parts'}, note ${a.id}`;

// ---------- drawing ----------
let raf = 0;
export function scheduleRedraw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; redraw(); }); }
bus.addEventListener('camera', scheduleRedraw);
bus.addEventListener('resize', scheduleRedraw);

function poseClose(a, b, diag) {
  if (!a || !b) return false;
  const d = poseDiff(a, b);
  return d.sameMode && d.angle < 3 && d.shift < 0.03 * diag && d.ratio > 0.9 && d.ratio < 1.1;
}
// anchored = enough of it sits on geometry to redraw from the 3D hits
const anchored = (a) => a.kind === 'points' || (a.hits?.length > 0 && a.hits.filter((h) => h.part).length * 2 >= a.hits.length);

const svg = (tag, attrs, text) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
};
function redraw() {
  const [W, H] = canvasSize();
  ink.setAttribute('viewBox', `0 0 ${W} ${H}`);
  ink.innerHTML = '<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>';
  const pose = getPose(), diag = bounds().getSize(new THREE.Vector3()).length(), showDone = $('#a-showdone').checked;
  const px = (p) => [p[0] * W, p[1] * H];
  for (const a of doc.annotations) {
    if (a.status === 'done' && !showDone) continue;
    const g = svg('g', { class: `ann ${a.kind} ${a.id === selectedId ? 'sel' : ''} ${a.status === 'done' ? 'done' : ''}`, 'data-id': a.id });
    const close = poseClose(a.camera, pose, diag);
    let pts;                                              // screen points in px, or null when it cannot be shown
    if (a.kind === 'points') {
      pts = a.xyz.map((p) => project(new THREE.Vector3(...p))).map((s) => (s.inFront ? [s.u * W, s.v * H] : null));
    } else if (close) {
      pts = a.pts.map(px);
    } else if (anchored(a)) {
      pts = a.hits.filter((h) => h.xyz).map((h) => project(new THREE.Vector3(...h.xyz))).map((s) => (s.inFront ? [s.u * W, s.v * H] : null)).filter(Boolean);
      if (a.kind === 'arrow' && a.hits[0]?.xyz == null && a.hits[1]?.xyz) {   // tail was in space: keep its screen offset from the head
        const head = pts[0], off = [(a.pts[0][0] - a.pts[1][0]) * W, (a.pts[0][1] - a.pts[1][1]) * H];
        pts = [[head[0] + off[0], head[1] + off[1]], head];
      }
      if (pts.length < (a.kind === 'arrow' ? 2 : 1)) pts = null;
    } else {
      pts = a.pts.map(px); g.classList.add('ghost');
    }
    if (!pts) continue;
    drawShape(g, a.kind, pts, a);
    ink.appendChild(g);
  }
  if (cur) {
    const g = svg('g', { class: `ann live ${cur.kind}` });
    if (cur.kind === 'points') drawShape(g, 'points', cur.xyz.map((p) => project(new THREE.Vector3(...p))).map((s) => [s.u * W, s.v * H]), cur);
    else drawShape(g, cur.kind, cur.pts.map(px), cur);
    ink.appendChild(g);
  }
}
function drawShape(g, kind, pts, a) {
  const label = a.id ? `${a.id}${a.caption ? ' · ' + a.caption : ''}` : '';
  if (kind === 'pen') {
    const d = pts.filter(Boolean).map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    g.appendChild(svg('path', { d, class: 'halo' })); g.appendChild(svg('path', { d }));
    if (label) g.appendChild(svg('text', { x: pts[0][0] + 6, y: pts[0][1] - 6 }, label));
  } else if (kind === 'arrow') {
    const [a0, a1] = pts;
    g.appendChild(svg('line', { x1: a0[0], y1: a0[1], x2: a1[0], y2: a1[1], class: 'halo' }));
    g.appendChild(svg('line', { x1: a0[0], y1: a0[1], x2: a1[0], y2: a1[1], 'marker-end': 'url(#arr)' }));
    if (label) g.appendChild(svg('text', { x: a0[0] + 6, y: a0[1] - 6 }, label));
  } else if (kind === 'text') {
    const [p] = pts;
    g.appendChild(svg('circle', { cx: p[0], cy: p[1], r: 3 }));
    g.appendChild(svg('text', { x: p[0] + 8, y: p[1] + 4, class: 'big' }, `${a.caption ?? ''}  ${a.id ?? ''}`));
  } else if (kind === 'points') {
    pts.forEach((p, i) => {
      if (!p) return;
      g.appendChild(svg('circle', { cx: p[0], cy: p[1], r: 4 }));
      g.appendChild(svg('text', { x: p[0] + 6, y: p[1] - 5 }, String(i + 1)));
    });
    const d = pts.filter(Boolean).map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + (a.closed ? ' Z' : '');
    if (pts.length > 1) g.appendChild(svg('path', { d, class: 'thin' }));
    if (label && pts[0]) g.appendChild(svg('text', { x: pts[0][0] + 6, y: pts[0][1] + 14 }, label));
  }
}

$('#a-clear-sel')?.addEventListener('click', () => selectAnn(null));
