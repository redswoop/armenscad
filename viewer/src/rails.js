// The two rails (CyberDOS shell, @redswoop/cyberdos/web/shell.ts), Shapr3D's way: labelled entries, the
// state under the label, the shortcut beside it.
//   left   top     spaces: View, Annotate; Items shows / hides the left panels
//          middle  what fits now: the section's tools while it is on, the drawing tools in Annotate, the
//                  selection's (Box, Hide, Deselect) with one, else Box and Ghost
//          bottom  modes: Section
//   right  top     camera: Home, Views (tray), Fit, Camera (perspective / ortho)
//          middle  Display (tray: shadows, edges, headlight, ghost opacity)
//          bottom  Settings (tray: skin, text size, keys); Parameters shows / hides the right panels
// The modules own the state and fire 'ui' on the bus when it changes; sync() redraws every entry from it. The
// middle group swaps (animated) only when what it offers changes. Also the tool card over the render (top
// centre): the active tool and its readout or hint. Folded groups and hidden slots are remembered.
import { Rail } from '@redswoop/cyberdos/web';
import { createElement, Rotate3d, PenTool, PanelLeft, PanelRight, MousePointer2, MoveUpRight, Type, Crosshair, Box, Ghost,
         EyeOff, X, SquareSplitVertical, FlipVertical2, Focus, Replace, RotateCcw, Home, View, Maximize, Axis3d, SunMedium,
         Settings2 } from 'lucide';
import { bus, fit, setOrtho, isOrtho } from './scene.js';
import { getSelection, hideSelection, clearSelect, toggleGhost, ghostState } from './parts.js';
import * as annotate from './annotate.js';
import { toggleSection, sectionUI, flipSection, lookAtCut, replaneSection, untiltSection, section, SECTION_HELP } from './section.js';
import { st as box, toggleBox } from './bounds.js';
import { st as shade } from './shading.js';
import { home } from './viewcube.js';

const $ = (s) => document.querySelector(s);
const svg = (icon) => createElement(icon).outerHTML;
const store = (k, v) => { try { v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const recall = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };

const COMPACT = 'armenscad.compact';
const compact = new Set(recall(COMPACT, []));
const group = (id, anchor, entries = []) => ({
  id, anchor, entries, handle: true, compact: compact.has(id),
  onCompact: (c) => { c ? compact.add(id) : compact.delete(id); store(COMPACT, [...compact]); },
});

// a tray shows a node kept in #trays (the modules bind to its inputs by id at load)
const tray = (id) => () => $(id);

// ---------- spaces ----------
const DRAW = ['pen', 'arrow', 'text', 'points'];
let space = 'view';
export const toggleAnnotate = () => setSpace(space === 'annotate' ? 'view' : 'annotate');
function setSpace(s) {
  space = s;
  if (s === 'view' && annotate.getTool() !== 'select') annotate.setTool('select');   // fires 'ui'
  else sync();
}

// ---------- slots ----------
const SLOTS = 'armenscad.slots';
const slots = recall(SLOTS, {});
function showSlot(side, on) {
  $(`#${side}`).hidden = !on;
  slots[side] = on; store(SLOTS, slots);
  sync();
}
for (const side of ['left', 'right']) $(`#${side}`).hidden = slots[side] === false;

// ---------- the rails ----------
export const left = new Rail('left', [
  group('spaces', 'top', [
    { id: 'view', label: 'View', icon: svg(Rotate3d), onSelect: () => setSpace('view') },
    { id: 'annotate', label: 'Annotate', icon: svg(PenTool), keys: ['N'], onSelect: toggleAnnotate },
    { id: 'items', label: 'Items', icon: svg(PanelLeft), onSelect: () => showSlot('left', $('#left').hidden) },
  ]),
  group('context', 'middle'),
  group('modes', 'bottom', [
    { id: 'section', label: 'Section', icon: svg(SquareSplitVertical), keys: ['S'], title: SECTION_HELP, onSelect: toggleSection },
  ]),
]);

export const right = new Rail('right', [
  group('camera', 'top', [
    { id: 'home', label: 'Home', icon: svg(Home), keys: ['1'], onSelect: () => home() },
    { id: 'views', label: 'Views', icon: svg(View), tray: tray('#tray-views') },
    { id: 'fit', label: 'Fit', icon: svg(Maximize), keys: ['F'], onSelect: () => fit() },
    { id: 'ortho', label: 'Camera', icon: svg(Axis3d), keys: ['O'], onSelect: () => setOrtho(!isOrtho()) },
  ]),
  group('look', 'middle', [
    { id: 'display', label: 'Display', icon: svg(SunMedium), tray: tray('#tray-display') },
  ]),
  group('app', 'bottom', [
    { id: 'settings', label: 'Settings', icon: svg(Settings2), tray: tray('#tray-settings') },
    { id: 'params', label: 'Parameters', icon: svg(PanelRight), onSelect: () => showSlot('right', $('#right').hidden) },
  ]),
]);

$('#frame').append(left.el, right.el);

// ---------- the middle group: what fits now ----------
const onOff = (on) => (on ? 'On' : 'Off');
function contextEntries() {
  const sec = sectionUI();
  if (sec.on || sec.picking) return ['section', [
    { id: 'flip', label: 'Flip side', icon: svg(FlipVertical2), on: sec.flip, title: 'keep the other side (or double-click a cut face)', onSelect: flipSection },
    { id: 'look', label: 'Normal to section', icon: svg(Focus), onSelect: lookAtCut },
    { id: 'replane', label: 'Pick another plane', icon: svg(Replace), on: sec.picking, onSelect: replaneSection },
    ...(sec.tilted ? [{ id: 'untilt', label: 'Untilt', icon: svg(RotateCcw), title: 'back to axis-aligned', onSelect: untiltSection }] : []),
    { id: 'off', label: 'Section off', icon: svg(X), keys: ['S'], onSelect: () => section({ on: false }) },
  ]];
  const tool = annotate.getTool();
  if (space === 'annotate') return ['annotate', [
    { id: 'select', label: 'Select', icon: svg(MousePointer2), keys: ['V'] },
    { id: 'pen', label: 'Pen', icon: svg(PenTool), keys: ['P'] },
    { id: 'arrow', label: 'Arrow', icon: svg(MoveUpRight), keys: ['A'] },
    { id: 'text', label: 'Label', icon: svg(Type), keys: ['T'] },
    { id: 'points', label: 'Pick points', icon: svg(Crosshair), keys: ['K'] },
  ].map((e) => ({ ...e, on: tool === e.id, onSelect: () => annotate.setTool(e.id) }))];
  const boxEntry = { id: 'box', label: 'Box', icon: svg(Box), keys: ['B'], on: box.on, state: onOff(box.on), title: 'wire box with the edge lengths', onSelect: toggleBox };
  const { part, group: g } = getSelection();
  if (part || g) return ['part', [
    boxEntry,
    { id: 'hide', label: g ? 'Hide group' : 'Hide', icon: svg(EyeOff), onSelect: hideSelection },
    { id: 'deselect', label: 'Deselect', icon: svg(X), keys: ['esc'], onSelect: clearSelect },
  ]];
  const ghost = ghostState();
  return ['none', [
    boxEntry,
    ...(ghost.available ? [{ id: 'ghost', label: 'Ghost', icon: svg(Ghost), keys: ['G'], on: ghost.on, state: onOff(ghost.on), title: 'the reference model, see-through', onSelect: toggleGhost }] : []),
  ]];
}

let shown = '';
export function sync() {
  const tool = annotate.getTool();
  if (DRAW.includes(tool)) space = 'annotate';           // a drawing key (p a t k) switches the space too
  left.entry('view').on = space === 'view';
  left.entry('annotate').update({ on: space === 'annotate', state: space === 'annotate' ? ({ select: 'Select', pen: 'Pen', arrow: 'Arrow', text: 'Label', points: 'Pick points' }[tool] ?? tool) : undefined });
  left.entry('items').on = !$('#left').hidden;
  right.entry('params').on = !$('#right').hidden;

  const sec = sectionUI();
  left.entry('section').update({ on: sec.on || sec.picking, state: sec.picking ? 'Pick a plane' : sec.on ? `${sec.plane} ${sec.mm} mm` : 'Off' });
  right.entry('ortho').update({ state: isOrtho() ? 'Orthographic' : 'Perspective' });
  right.entry('display').update({ state: ['Shaded', shade.edges && 'edges', shade.shadows && 'shadows'].filter(Boolean).join(' · ') });

  const [kind, entries] = contextEntries();
  const key = kind + ':' + entries.map((e) => e.id).join(',');
  const ctx = left.group('context');
  if (key !== shown) { shown = key; ctx.set(entries); }
  else for (const e of entries) ctx.entry(e.id)?.update(e);

  card(sec, tool);
}

// ---------- the tool card (top centre) ----------
function card(sec, tool) {
  const name = sec.picking || sec.on ? 'Section' : tool !== 'select' ? { pen: 'Pen', arrow: 'Arrow', text: 'Label', points: 'Pick points', calib: 'Calibrate', origin: 'Set origin' }[tool] ?? tool : '';
  $('#card-name').textContent = name;
  $('#card').hidden = !name;
}

for (const ev of ['ui', 'select', 'parts']) bus.addEventListener(ev, sync);
sync();
