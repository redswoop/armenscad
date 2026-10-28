// The dock's ⚙ popover (render switches, skin, text size, the key list) and the sidebar's foldable sections.
// The dock's other buttons belong to their modules (section.js, bounds.js, parts.js); the view cube is
// viewcube.js.
import { stepTextSize } from './theme.js';

const $ = (s) => document.querySelector(s);

// ---------- popover ----------
const pop = $('#pop'), btn = $('#pop-btn');
const setPop = (open) => { pop.hidden = !open; btn.classList.toggle('on', open); };
btn.onclick = () => setPop(pop.hidden);
// a click anywhere else closes it
addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) setPop(false); }, true);
// Esc: true when it closed the popover
export function closePop() { if (pop.hidden) return false; setPop(false); return true; }
$('#fs-down').onclick = () => stepTextSize(-1);
$('#fs-up').onclick = () => stepTextSize(1);

// ---------- foldable sidebar sections ----------
// Click a section's heading (not its controls) to fold it. Remembered across models; Log starts folded.
const KEY = 'armenscad.folded';
let folded;
try { folded = new Set(JSON.parse(localStorage.getItem(KEY) ?? '["log"]')); } catch { folded = new Set(['log']); }
for (const sec of document.querySelectorAll('#side > section')) {
  const h = sec.querySelector(':scope > h2');
  const id = sec.dataset.fold ?? h.firstChild.textContent.trim().toLowerCase();
  sec.classList.toggle('folded', folded.has(id));
  h.classList.add('fold');
  h.addEventListener('click', (e) => {
    if (e.target.closest('input, button, label, select')) return;
    const on = sec.classList.toggle('folded');
    on ? folded.add(id) : folded.delete(id);
    try { localStorage.setItem(KEY, JSON.stringify([...folded])); } catch {}
  });
}
