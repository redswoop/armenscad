// The panels around the render (CyberDOS shell panels): click a panel's header (not its controls) to fold it,
// drag a slot's inner edge to size it. Both remembered across models; Log starts folded. The Settings tray's
// text-size buttons. The rails and their trays are rails.js.
import { foldable, resizable } from '@redswoop/cyberdos/web';
import { stepTextSize } from './theme.js';

const $ = (s) => document.querySelector(s);
const recall = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

$('#fs-down').onclick = () => stepTextSize(-1);
$('#fs-up').onclick = () => stepTextSize(1);

// ---------- foldable panels ----------
const FOLD = 'armenscad.folded';
const folded = new Set(recall(FOLD, ['log']));
for (const p of document.querySelectorAll('.cd-panel[data-fold]')) {
  p.toggleAttribute('data-collapsed', folded.has(p.dataset.fold));
  foldable(p, (c) => { c ? folded.add(p.dataset.fold) : folded.delete(p.dataset.fold); store(FOLD, [...folded]); });
}

// ---------- slot widths ----------
const WIDTH = 'armenscad.slotw';
const widths = recall(WIDTH, {});
for (const side of ['left', 'right']) {
  const slot = $(`#${side}`);
  if (widths[side]) slot.style.setProperty('--cd-slot-w', `${widths[side]}px`);
  resizable(slot, { onChange: (w) => { widths[side] = w; store(WIDTH, widths); } });
}
