// The page's skin: plain (style.css alone) or CyberDOS (github.com/redswoop/cyberdos) in one of its palettes,
// with theme-cyber.css wiring this page's selectors to the skin's tokens. The choice is a cookie, not
// localStorage: cookies ignore the port, so every viewer instance (5180, 5181, ...) shares it. ?skin=<id> sets it.
// The render is not CSS, so the skin also hands scene.js a backdrop, and fires 'skin' on the bus for whatever
// paints CSS tokens into the render (the view cube, the section gizmo, the selection highlight).
// Text size is the same kind of choice: --fs, a multiplier every font size in style.css (and the skin) reads.
import '@redswoop/cyberdos/web/cyber.css';
import '@redswoop/cyberdos/web/shell.css';
import './theme-cyber.css';
import { GOOGLE_FONTS_URL, PALETTES, DEFAULT_PALETTE, applyPalette, setSkin, startCyberFx, stopCyberFx,
         setRainColors, rainColors, bootLog, hostLabel, mix } from '@redswoop/cyberdos/web';
import { MODEL } from './api.js';
import { setBackdrop, bus } from './scene.js';

const KEY = 'armenscad.skin';
const DEFAULT = DEFAULT_PALETTE.id;
const SCRAMBLE = '#pick h1, .cd-panel-title';
export const SKINS = [{ id: 'plain', name: 'plain' }, ...PALETTES.map((p) => ({ id: p.id, name: p.name }))];
const known = (v) => (SKINS.some((s) => s.id === v) ? v : null);

const cookie = (k) => document.cookie.match(new RegExp(`(?:^|;\\s*)${k.replace('.', '\\.')}=([^;]*)`))?.[1];
const setCookie = (k, v) => { document.cookie = `${k}=${v}; Path=/; Max-Age=31536000; SameSite=Lax`; };
function load() {
  const q = known(new URLSearchParams(location.search).get('skin'));
  if (q) { save(q); return q; }
  return known(cookie(KEY)) ?? DEFAULT;
}
const save = (id) => setCookie(KEY, id);

export let skin = load();

export function setTheme(id, { flip = false } = {}) {
  skin = id; save(id);
  const pal = PALETTES.find((p) => p.id === id);
  setSkin(!!pal);
  if (!pal) {
    applyPalette({});
    stopCyberFx();
    setBackdrop(0x14161a);
    bus.dispatchEvent(new Event('skin'));
    return;
  }
  if (!document.getElementById('cyber-fonts')) {
    const l = Object.assign(document.createElement('link'), { id: 'cyber-fonts', rel: 'stylesheet', href: GOOGLE_FONTS_URL });
    document.head.appendChild(l);
  }
  const c = pal.colors;
  applyPalette(pal.stock ? {} : c);
  setRainColors(rainColors(c));
  startCyberFx({ scramble: SCRAMBLE });
  // the page's own backdrop (theme-cyber.css on #stage) shows through the render; the grid is lit by the chrome
  setBackdrop(null, mix(c.bg, c.chrome, 0.4), mix(c.bg, c.chrome, 0.16));
  bus.dispatchEvent(new Event('skin'));
  if (flip) bootLog({ short: true });
  else if (!booted()) bootLog({ title: 'ARMENSCAD//OS', host: hostLabel(location.hostname),
    steps: ['> manifold kernel ............ OK', `> mounting ${MODEL ?? 'workspace'} ..... OK`], last: 'JACKED IN' });
}

// the long boot log plays once per tab
function booted() {
  try { if (sessionStorage.getItem('armenscad.booted')) return true; sessionStorage.setItem('armenscad.booted', '1'); } catch {}
  return false;
}

export function installSkinPicker(sel) {
  if (!sel) return;
  sel.innerHTML = SKINS.map((s) => `<option value="${s.id}" ${s.id === skin ? 'selected' : ''}>${s.name}</option>`).join('');
  sel.onchange = () => setTheme(sel.value, { flip: true });
}

setTheme(skin);

// ---------- text size ----------
const FS_KEY = 'armenscad.fs';
export const FS_STEPS = [0.85, 1, 1.15, 1.3, 1.5, 1.75, 2];
export let fs = FS_STEPS.includes(+cookie(FS_KEY)) ? +cookie(FS_KEY) : 1;
export function setTextSize(v) {
  fs = v; setCookie(FS_KEY, v);
  document.documentElement.style.setProperty('--fs', v);
  const out = document.querySelector('#fs-val'); if (out) out.textContent = `${Math.round(v * 100)}%`;
}
// one step bigger (+1) or smaller (-1)
export const stepTextSize = (d) => setTextSize(FS_STEPS[Math.max(0, Math.min(FS_STEPS.length - 1, FS_STEPS.indexOf(fs) + d))]);
setTextSize(fs);
