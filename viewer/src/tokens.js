// CSS tokens for things drawn in WebGL (the view cube, the section gizmo, the world axes). A token may be
// color-mix() or a var() of a var(), so the browser resolves it on a hidden element and the pixel is read back.
// Redraw on the bus's 'skin' event (theme.js fires it after a skin change).
const probe = document.createElement('span'); probe.style.display = 'none'; document.body.appendChild(probe);
const px = document.createElement('canvas').getContext('2d', { willReadFrequently: true });

// { css, hex, a } of a colour token
export function token(name, fallback) {
  probe.style.color = fallback; probe.style.color = `var(${name}, ${fallback})`;
  px.clearRect(0, 0, 1, 1); px.fillStyle = getComputedStyle(probe).color; px.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = px.getImageData(0, 0, 1, 1).data;
  return { css: `rgba(${r},${g},${b},${a / 255})`, hex: (r << 16) | (g << 8) | b, a: a / 255 };
}
// a number token (e.g. --gizmo-glow: 0.3)
export function numToken(name, fallback) {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
}
// a font-family token
export function fontToken(name, fallback) { probe.style.fontFamily = `var(${name}, ${fallback})`; return getComputedStyle(probe).fontFamily; }
// the three axis colours (--axis-x/y/z), as hex numbers
export const axisColors = () => [token('--axis-x', '#e05252').hex, token('--axis-y', '#52c452').hex, token('--axis-z', '#5a8cf0').hex];
