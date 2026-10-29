// The ground: an endless grid in the XY plane (Z = 0), Shapr3D's way, and the print bed on it.
//   grid   one shader on a plane under the camera. Three line levels at a time, 10x apart; the finest cell is held
//          between ~2.4 and 24 CSS px by picking the step from the zoom (CELL / px-per-mm at the orbit target), with the
//          finest level fading out and the coarsest fading in as the zoom crosses a decade, so nothing pops. The X
//          and Y axes run through the origin in their colours. Lines are antialiased by screen-space derivatives,
//          never thinner than a CSS px, with an optional halo (the cyber skin's glow). The far grid fades toward
//          the horizon and at grazing angles so it never moirés.
//   bed    the chosen printer's plate (printers.js), centred on the origin: a lit outline, a faint fill, the
//          exclusion zones hatched, and a wire box of the build height. Chosen in the Display tray, remembered
//          for every model (localStorage), window.viewer.printer(id) from the tools. The size readout (bounds.js)
//          says whether what is measured fits; the outline turns the alarm colour when it does not.
// Colours are CSS tokens (--grid-minor, --grid-major, --grid-glow, --axis-x/y, --plate, --plate-zone, --warn), read
// on the bus's 'skin' event, so each skin lights the floor its own way.
import * as THREE from 'three';
import { scene, view, controls, renderer, stage, bus, frameHooks } from './scene.js';
import { token, numToken } from './tokens.js';
import { PRINTERS, printer as printerById } from './printers.js';
import { st as size } from './bounds.js';

const $ = (s) => document.querySelector(s);
const CELL = 24;                 // CSS px: the finest cells are this big when a decade starts

// ---------- the grid ----------
const gridMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2,     // a face lying on Z = 0 wins over the grid
  uniforms: {
    uMinor: { value: new THREE.Vector4(0.15, 0.16, 0.2, 1) }, uMajor: { value: new THREE.Vector4(0.23, 0.25, 0.29, 1) },
    uX: { value: new THREE.Vector4(0.88, 0.32, 0.32, 1) }, uY: { value: new THREE.Vector4(0.32, 0.77, 0.32, 1) },
    uGlow: { value: 0 }, uStep: { value: 10 }, uFrac: { value: 0 }, uWidth: { value: 2 }, uHalo: { value: 5 },
    uCam: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector3(0, 0, 1) }, uOrtho: { value: 0 }, uRadius: { value: 1000 },
  },
  vertexShader: `
    varying vec3 vPos;
    void main() { vPos = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0); }`,
  fragmentShader: `
    precision highp float;
    uniform vec4 uMinor, uMajor, uX, uY;
    uniform float uGlow, uStep, uFrac, uWidth, uHalo, uRadius, uOrtho;
    uniform vec3 uCam, uDir;
    varying vec3 vPos;
    // distance (device px) from p to the nearest line of a grid of spacing s, per axis
    vec2 linePx(vec2 p, float s) { vec2 c = p / s; vec2 d = max(fwidth(c), 1e-7); return abs(fract(c - 0.5) - 0.5) / d; }
    // the core's edge is softened over one device px, no more: the look must not change with the pixel ratio
    // (scene.js lowers it while the camera moves), and a wider band fattens a line twice as much at 1x as at 2x
    float stroke(float px, float w) { return 1.0 - smoothstep(w * 0.5 - 0.5, w * 0.5 + 0.5, px); }
    float halo(float px, float w) { return exp(-max(px - w * 0.5, 0.0) / uHalo); }
    // a line: a hot core, a halo of its colour (uGlow), composited over what is there
    void lay(inout vec3 rgb, inout float a, vec4 c, float px, float w, float k) {
      float s = stroke(px, w), h = halo(px, w) * uGlow;
      float cov = min((s + h * 0.7) * c.a * k, 1.0);
      vec3 col = mix(c.rgb, vec3(1.0), 0.35 * s * k);
      rgb = mix(rgb, col, cov); a = a + cov * (1.0 - a);
    }
    // A level's place in the zoom, k = log10(spacing) - log10(the cell the zoom asks for), runs -1..2 across the
    // three drawn levels; every look is a smooth function of k, so a level slides from finest to coarsest without a
    // step: it fades in over (-1, 0], holds and turns from the minor to the major colour over (0, 1], fades out
    // over (1, 2].
    void level(inout vec3 rgb, inout float a, vec2 p, float s, float k) {
      vec2 l = linePx(p, s);
      float w = k < 0.0 ? 1.0 + k : k > 1.0 ? 2.0 - k : 1.0;
      vec4 c = mix(uMinor, uMajor, clamp(k, 0.0, 1.0));
      lay(rgb, a, c, min(l.x, l.y), uWidth, w);
    }
    void main() {
      vec2 p = vPos.xy;
      vec3 rgb = vec3(0.0); float a = 0.0;
      level(rgb, a, p, uStep, -uFrac);
      level(rgb, a, p, uStep * 10.0, 1.0 - uFrac);
      level(rgb, a, p, uStep * 100.0, 2.0 - uFrac);
      // the axes: X runs along y = 0, Y along x = 0
      lay(rgb, a, uX, abs(p.y) / max(fwidth(p.y), 1e-7), uWidth + 1.0, 1.0);
      lay(rgb, a, uY, abs(p.x) / max(fwidth(p.x), 1e-7), uWidth + 1.0, 1.0);
      // fade toward the horizon (by distance from the camera, scaled to the orbit) and at grazing angles
      vec3 vdir = uOrtho > 0.5 ? uDir : normalize(uCam - vPos);
      float d = uOrtho > 0.5 ? length(vPos.xy - uCam.xy) : distance(vPos, uCam);
      float fade = (1.0 - smoothstep(uRadius * 0.2, uRadius, d)) * smoothstep(0.0, 0.2, abs(vdir.z));
      gl_FragColor = vec4(rgb, a * fade);
    }`,
});
// A unit plane, moved under the camera and scaled to the fade radius every frame: a plane that is simply huge
// (hundreds of metres) gets its depth interpolated from vertices far outside the screen, and the error lets the
// lines bleed through faces that stand on it.
const grid = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), gridMat);
grid.renderOrder = -2; grid.raycast = () => {}; grid.frustumCulled = false;
scene.add(grid);

// CSS px per mm at the orbit target, for the step (CSS, not device: the pixel ratio changes while the camera
// moves, and the spacing must not move with it)
function pxPerMm() {
  const cam = view.camera, h = stage.clientHeight;
  const halfMm = cam.isOrthographicCamera ? cam.top / cam.zoom : cam.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
  return h / (2 * halfMm);
}
function tick() {
  const u = gridMat.uniforms, cam = view.camera;
  const L = Math.log10(CELL / pxPerMm()), fl = Math.floor(L);
  u.uStep.value = 10 ** fl; u.uFrac.value = L - fl;
  // 1.25 CSS px of core, a halo 2.5 CSS px wide, whatever the ratio (never under 1.5 device px: that aliases)
  const r = renderer.getPixelRatio();
  u.uWidth.value = 1.25 * r; u.uHalo.value = 2.5 * r;
  u.uCam.value.copy(cam.position);
  cam.getWorldDirection(u.uDir.value);
  u.uOrtho.value = cam.isOrthographicCamera ? 1 : 0;
  // the fade: in perspective, by distance from the camera (the target sits at 1 orbit); in ortho, by distance
  // across the plane from the camera's foot, one visible height out
  // across the plane from the camera's foot, one visible height out. The orbit distance alone is not enough: zoomed
  // onto a feature 50 mm up, the orbit is 5 mm and the floor would fade to nothing, so the camera's height counts too.
  u.uRadius.value = cam.isOrthographicCamera ? 5 * cam.top / cam.zoom : 7 * Math.max(cam.position.distanceTo(controls.target), Math.abs(cam.position.z));
  const foot = cam.isOrthographicCamera ? controls.target : cam.position;
  grid.position.set(foot.x, foot.y, 0); grid.scale.set(u.uRadius.value, u.uRadius.value, 1);
  // the spacing the rail shows: the middle level, the one drawn in full
  const mid = u.uStep.value * 10, label = mid >= 1000 ? `${mid / 1000} m` : `${+mid.toPrecision(3)} mm`;
  if (label !== st.spacing) { st.spacing = label; bus.dispatchEvent(new Event('ui')); }
}
frameHooks.add(tick);

// ---------- the bed ----------
const MAX_ZONES = 4;
const bedMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  uniforms: {
    uRect: { value: new THREE.Vector4() }, uZones: { value: Array.from({ length: MAX_ZONES }, () => new THREE.Vector4()) }, uZoneN: { value: 0 },
    uLine: { value: new THREE.Vector4(1, 1, 1, 1) }, uZone: { value: new THREE.Vector4(1, 0.8, 0.2, 1) }, uWarn: { value: new THREE.Vector4(1, 0.3, 0.3, 1) },
    uAlarm: { value: 0 }, uGlow: { value: 0 }, uWidth: { value: 2 },
  },
  vertexShader: `
    varying vec3 vPos;
    void main() { vPos = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0); }`,
  fragmentShader: `
    precision highp float;
    uniform vec4 uRect, uZones[${MAX_ZONES}], uLine, uZone, uWarn;
    uniform int uZoneN; uniform float uAlarm, uGlow, uWidth;
    varying vec3 vPos;
    // signed distance (mm) to a rect's edge: positive inside
    float sdRect(vec2 p, vec4 r) { vec2 d = min(p - r.xy, r.zw - p); return min(d.x, d.y); }
    float stroke(float px, float w) { return 1.0 - smoothstep(w * 0.5 - 0.5, w * 0.5 + 0.5, px); }
    float halo(float px, float w) { return exp(-max(px - w * 0.5, 0.0) * 0.18); }
    void lay(inout vec3 rgb, inout float a, vec4 c, float s) { s = min(s, 1.0) * c.a; rgb = mix(rgb, c.rgb, s); a = a + s * (1.0 - a); }
    void main() {
      vec2 p = vPos.xy; float pxmm = 1.0 / max(fwidth(p.x), 1e-7);
      vec3 rgb = vec3(0.0); float a = 0.0;
      vec4 line = mix(uLine, uWarn, uAlarm);
      float sd = sdRect(p, uRect);
      if (sd > 0.0) lay(rgb, a, line, 0.07);                                       // the plate
      for (int i = 0; i < ${MAX_ZONES}; i++) {
        if (i >= uZoneN) break;
        float sz = sdRect(p, uZones[i]);
        if (sz > 0.0) lay(rgb, a, uZone, 0.10 + 0.22 * step(0.5, fract((p.x + p.y) / 5.0)));   // hatched
        lay(rgb, a, uZone, stroke(abs(sz) * pxmm, uWidth) * 0.7);
      }
      float epx = abs(sd) * pxmm;
      lay(rgb, a, line, stroke(epx, uWidth + 1.0) + halo(epx, uWidth + 1.0) * uGlow * 0.6);   // the lit edge
      gl_FragColor = vec4(rgb, a);
    }`,
});
const bed = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bedMat);
bed.renderOrder = -1; bed.raycast = () => {}; bed.visible = false;
scene.add(bed);
const volMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false });
const vol = new THREE.LineSegments(new THREE.BufferGeometry(), volMat);
vol.raycast = () => {}; vol.visible = false; vol.renderOrder = -1;
scene.add(vol);

const KEY = 'armenscad.printer';
export const st = { printer: printerById(localStorage.getItem(KEY)) ?? null, fits: null, spacing: '' };

function layBed() {
  const p = st.printer;
  bed.visible = vol.visible = !!p;
  if (!p) return;
  const [w, d, h] = p.size, x0 = -w / 2, y0 = -d / 2;
  const u = bedMat.uniforms;
  u.uRect.value.set(x0, y0, x0 + w, y0 + d);
  p.zones.forEach((z, i) => u.uZones.value[i].set(z.rect[0] + x0, z.rect[1] + y0, z.rect[2] + x0, z.rect[3] + y0));
  u.uZoneN.value = Math.min(p.zones.length, MAX_ZONES);
  const m = Math.max(w, d) * 0.25;         // room for the halo
  bed.scale.set(w + 2 * m, d + 2 * m, 1);
  // the build volume: the four uprights and the top rectangle
  const c = (x, y, z) => [x0 + x * w, y0 + y * d, z * h];
  const pts = [];
  for (const [x, y] of [[0, 0], [1, 0], [1, 1], [0, 1]]) pts.push(...c(x, y, 0), ...c(x, y, 1));
  for (const [[ax, ay], [bx, by]] of [[[0, 0], [1, 0]], [[1, 0], [1, 1]], [[1, 1], [0, 1]], [[0, 1], [0, 0]]]) pts.push(...c(ax, ay, 1), ...c(bx, by, 1));
  vol.geometry.dispose(); vol.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
}

// does what the size readout measures fit the printable volume (ignoring the zones: the part can be placed clear of them)?
function checkFit() {
  const out = $('#size-fit');
  const p = st.printer;
  if (!p || size.empty) { st.fits = null; bedMat.uniforms.uAlarm.value = 0; if (out) { out.hidden = true; out.textContent = ''; } return; }
  const s = size.box.getSize(new THREE.Vector3()).toArray();
  const [w, d, h] = p.size;
  const flat = Math.max(s[0], s[1]) <= Math.max(w, d) && Math.min(s[0], s[1]) <= Math.min(w, d) && s[2] <= h;   // either way round
  const over = ['X', 'Y', 'Z'].filter((_, i) => s[i] > p.size[i]);
  st.fits = flat;
  bedMat.uniforms.uAlarm.value = flat ? 0 : 1;
  if (out) {
    out.hidden = false;
    out.textContent = flat ? (over.length ? `fits ${p.name} turned` : `fits ${p.name}`) : `over ${p.name} in ${over.join(' ')}`;
    out.classList.toggle('bad', !flat);
  }
}
bus.addEventListener('bounds', checkFit);

export function setPrinter(id) {
  st.printer = printerById(id);
  if (st.printer) localStorage.setItem(KEY, st.printer.id); else localStorage.removeItem(KEY);
  layBed(); checkFit();
  const sel = $('#printer'); if (sel) sel.value = st.printer?.id ?? '';
  bus.dispatchEvent(new Event('ui'));
  console.log(`[viewer] printer ${st.printer?.name ?? 'none'}`);
  return st.printer;
}
export const toggleGrid = (on = !grid.visible) => { grid.visible = on; const c = $('#sh-grid'); if (c) c.checked = on; localStorage.setItem('armenscad.grid', on ? '1' : '0'); bus.dispatchEvent(new Event('ui')); };
grid.visible = localStorage.getItem('armenscad.grid') !== '0';

// ---------- the skin's colours ----------
function paint() {
  const v4 = (name, fb) => { const t = token(name, fb); return new THREE.Vector4(((t.hex >> 16) & 255) / 255, ((t.hex >> 8) & 255) / 255, (t.hex & 255) / 255, t.a); };
  const g = gridMat.uniforms, b = bedMat.uniforms;
  g.uMinor.value = v4('--grid-minor', '#262a33'); g.uMajor.value = v4('--grid-major', '#3a3f4a');
  g.uX.value = v4('--axis-x', '#e05252'); g.uY.value = v4('--axis-y', '#52c452');
  g.uGlow.value = numToken('--grid-glow', 0.25);
  b.uLine.value = v4('--plate', '#d8dbe2'); b.uZone.value = v4('--plate-zone', '#ffd166'); b.uWarn.value = v4('--warn', '#e05252');
  b.uGlow.value = g.uGlow.value;
  volMat.color.setRGB(b.uLine.value.x, b.uLine.value.y, b.uLine.value.z);
}
bus.addEventListener('skin', paint);
paint();

// ---------- the tray ----------
const sel = $('#printer');
if (sel) {
  sel.innerHTML = `<option value="">none</option>` + PRINTERS.map((p) => `<option value="${p.id}">${p.name} · ${p.size.join('×')}</option>`).join('');
  sel.value = st.printer?.id ?? '';
  sel.onchange = () => setPrinter(sel.value);
}
const chk = $('#sh-grid');
if (chk) { chk.checked = grid.visible; chk.onchange = () => toggleGrid(chk.checked); }
layBed(); checkFit();
