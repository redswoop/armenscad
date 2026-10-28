// The page's skin: plain (style.css alone) or CyberDOS (github.com/redswoop/cyberdos) in one of its palettes,
// with theme-cyber.css wiring this page's selectors to the skin's tokens. The choice is a cookie, not
// localStorage: cookies ignore the port, so every viewer instance (5180, 5181, ...) shares it. ?skin=<id> sets it.
// The render is not CSS, so the skin also hands scene.js a backdrop and parts.js a selection glow.
import '@redswoop/cyberdos/web/cyber.css';
import './theme-cyber.css';
import { GOOGLE_FONTS_URL, PALETTES, DEFAULT_PALETTE, applyPalette, setSkin, startCyberFx, stopCyberFx,
         setRainColors, rainColors, bootLog, hostLabel, mix } from '@redswoop/cyberdos/web';
import { MODEL } from './api.js';
import { app } from './app.js';
import { setBackdrop } from './scene.js';

const KEY = 'armenscad.skin';
const DEFAULT = DEFAULT_PALETTE.id;
const SCRAMBLE = '#title, #pick h1, #side h2';
export const SKINS = [{ id: 'plain', name: 'plain' }, ...PALETTES.map((p) => ({ id: p.id, name: p.name }))];
const known = (v) => (SKINS.some((s) => s.id === v) ? v : null);

function load() {
  const q = known(new URLSearchParams(location.search).get('skin'));
  if (q) { save(q); return q; }
  return known(document.cookie.match(/(?:^|;\s*)armenscad\.skin=([^;]*)/)?.[1]) ?? DEFAULT;
}
const save = (id) => { document.cookie = `${KEY}=${id}; Path=/; Max-Age=31536000; SameSite=Lax`; };

export let skin = load();

export function setTheme(id, { flip = false } = {}) {
  skin = id; save(id);
  const pal = PALETTES.find((p) => p.id === id);
  setSkin(!!pal);
  if (!pal) {
    applyPalette({});
    stopCyberFx();
    setBackdrop(0x14161a);
    app.selGlow = 0x334466;
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
  app.selGlow = mix('#000000', c.live, 0.3);
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
