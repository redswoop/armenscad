// A transform gizmo: handles drawn in the scene at a constant size on screen, picked and dragged with the
// pointer. It knows nothing about what it moves: the owner places it (a position and an orientation), says
// which handles to show, and gets each drag back as numbers to apply.
//
// The frame: local z is the slide axis (a section's normal), local x and y lie in the plane.
//   move    the centre, a reticle that always faces the camera (a HUD mark pinned to the pivot, never squashed
//           into an oval and never hidden by the model): drag gives du, dv (mm along local x, y, in the plane)
//   slide   a dart-headed shaft along z: drag gives t (mm along z)
//   turnX   a graduated dial standing up off the plane about local x (turnY: about y): drag gives deg.
//           Each dial is mirrored toward the camera every frame, so the two never stack behind each other.
// Drag values are pure functions of the pointer (where its ray meets a line or plane fixed at the grab), so
// letting go and re-grabbing continues exactly. Snaps to 1 mm / 1°, alt 0.1, ctrl 15° on a dial.
//
// Strokes are screen-width lines (three's fat lines), drawn twice: solid where they are in front of the
// model, faint and dashed where the model hides them, so the gizmo sits in the scene rather than on the glass.
// While a drag runs, a trace in world space shows the travel: a ruler for slide and move, a protractor for
// a turn. Looks (lab, gizmo.html):
//   reticle  one colour (the skin's --live), thin strokes, a faint glow
//   holo     reticle plus translucent fills with scanlines and a slow sweep
//   tint     reticle in each handle's own colour (setColors), muted toward the base
//   hud      a HUD sheet's language: thick segment bars over hairlines, broken and dotted rings, faint sector
//            fills; the centre is a target reticle in the plane whose outer rings turn slowly
//   pipe     solid glass bands with lit edges (a light pipe): two broken two-tone rings (the handle's colour
//            outside, a deeper shade of it leaning to the accent inside, their breaks offset) turn the plane, a
//            glass rod slides it, a dark glossy orb with a lit core moves it; a thin dashed accent ring lies in
//            the plane to show where it is (not a handle). Options: crisp (less glow and halo), axisEdges
//            (each handle's axis colour, from setColors, on its lit edges; the bodies stay base and accent).
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

const D = THREE.MathUtils.degToRad;
const ARC = [10, 72];                      // the dial's span in degrees, from the plane up toward z (short of the shaft)
const WHITE = new THREE.Color(0xffffff);
const snap = (v, step) => Math.round(v / step) * step;
const sgn = (v) => (v > 0 ? '+' : '');

// a stroke list: flat [x,y,z, x,y,z] pairs, as LineSegmentsGeometry takes them
class Strokes {
  a = [];
  line(p, q) { this.a.push(...p, ...q); return this; }
  poly(pts, closed = false) { for (let i = 1; i < pts.length; i++) this.line(pts[i - 1], pts[i]); if (closed) this.line(pts.at(-1), pts[0]); return this; }
}
// triangles for the holo fills
const tris = (pts) => new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));

// ---------- the handles' shapes, in gizmo units (1 = px on screen) ----------
function moveShape() {
  const s = new Strokes(), d = 0.11, b = 0.24, l = 0.08;
  s.poly([[d, 0, 0], [0, d, 0], [-d, 0, 0], [0, -d, 0]], true);
  for (const [x, y] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) s.poly([[x * b, y * (b - l), 0], [x * b, y * b, 0], [x * (b - l), y * b, 0]]);
  s.line([-0.025, 0, 0], [0.025, 0, 0]).line([0, -0.025, 0], [0, 0.025, 0]);
  const fill = tris([[d, 0, 0], [0, d, 0], [-d, 0, 0], [-d, 0, 0], [0, -d, 0], [d, 0, 0]]);
  return { strokes: s.a, fill, pick: new THREE.SphereGeometry(0.3, 8, 6) };
}
function slideShape() {
  const s = new Strokes(), fins = [];
  const ring = (z, r) => s.poly(Array.from({ length: 13 }, (_, i) => [r * Math.cos(i * Math.PI / 6), r * Math.sin(i * Math.PI / 6), z]));
  for (const k of [1, -1]) {
    s.line([0, 0, k * 0.32], [0, 0, k * 1.28]);
    for (const z of [0.55, 0.75, 0.95]) ring(k * z, z === 0.75 ? 0.05 : 0.032);     // rungs: textured, and they read the axis from any side
    const tip = [0, 0, k * 1.52], notch = [0, 0, k * 1.34];
    for (const w of [[0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]]) {
      const wing = [w[0], w[1], k * 1.26];
      s.line(tip, wing).line(wing, notch);
      fins.push(tip, wing, notch);
    }
  }
  return { strokes: s.a, fill: tris(fins), pick: new THREE.CylinderGeometry(0.18, 0.18, 3.2, 8).rotateX(Math.PI / 2) };
}
// a dial about local x (in the y-z plane) or y (in the x-z plane); `p` runs along the in-plane axis, `q` along z
function turnShape(axis) {
  const at = (p, q) => (axis === 'x' ? [0, p, q] : [p, 0, q]);
  const pol = (deg, r) => at(r * Math.cos(D(deg)), r * Math.sin(D(deg)));
  const s = new Strokes(), band = [];
  s.poly(Array.from({ length: 40 }, (_, i) => pol(ARC[0] + (ARC[1] - ARC[0]) * i / 39, 1)));
  for (let deg = ARC[0]; deg <= ARC[1]; deg += 5) s.line(pol(deg, 1), pol(deg, deg % 15 === 0 ? 1.11 : 1.05));
  for (const [deg, dir] of [[ARC[0], -1], [ARC[1], 1]]) {       // chevrons at both ends, pointing along the turn
    const tip = pol(deg + dir * 5, 1), a = pol(deg, 0.93), b = pol(deg, 1.07);
    s.line(a, tip).line(b, tip);
  }
  for (let i = 0; i < 24; i++) {                                 // the holo band just inside the arc
    const d0 = ARC[0] + (ARC[1] - ARC[0]) * i / 24, d1 = ARC[0] + (ARC[1] - ARC[0]) * (i + 1) / 24;
    band.push(pol(d0, 0.8), pol(d0, 0.98), pol(d1, 0.98), pol(d1, 0.98), pol(d1, 0.8), pol(d0, 0.8));
  }
  const curve = new THREE.CatmullRomCurve3(Array.from({ length: 12 }, (_, i) => new THREE.Vector3(...pol(ARC[0] - 4 + (ARC[1] - ARC[0] + 8) * i / 11, 1))));
  return { strokes: s.a, fill: tris(band), pick: new THREE.TubeGeometry(curve, 24, 0.18, 6) };
}
const SHAPES = { move: moveShape, slide: slideShape, turnX: () => turnShape('x'), turnY: () => turnShape('y') };

// ---------- the hud look's shapes: stroke sets with a weight (w, x the hairline) and a spin about z (rad/s) ----------
const circ = (r, a0, a1, n, z = 0) => Array.from({ length: n + 1 }, (_, i) => { const a = D(a0 + (a1 - a0) * i / n); return [r * Math.cos(a), r * Math.sin(a), z]; });
// dots: very short bold segments along an arc, every `step` degrees
const dots = (s, pt, a0, a1, step) => { for (let a = a0; a <= a1 + 1e-6; a += step) s.line(pt(a - 0.4), pt(a + 0.4)); return s; };
// annulus sectors as triangles, for the faint fills
function sectors(pt, r0, r1, spans) {
  const t = [];
  for (const [a0, a1] of spans) for (let i = 0; i < 12; i++) {
    const b0 = a0 + (a1 - a0) * i / 12, b1 = a0 + (a1 - a0) * (i + 1) / 12;
    t.push(pt(b0, r0), pt(b0, r1), pt(b1, r1), pt(b1, r1), pt(b1, r0), pt(b0, r0));
  }
  return tris(t);
}
function moveHud() {
  const xy = (a, r) => [r * Math.cos(D(a)), r * Math.sin(D(a)), 0];
  const core = new Strokes().poly(circ(0.16, 0, 360, 48)), coreB = new Strokes().poly(circ(0.085, 0, 360, 32));
  for (const a of [0, 90, 180, 270]) core.line(xy(a, 0.19), xy(a, 0.26));
  const ring = new Strokes(); for (const a of [0, 120, 240]) ring.poly(circ(0.3, a, a + 70, 14));
  const outer = dots(new Strokes(), (a) => xy(a, 0.36), 0, 354, 6), outerT = new Strokes(), blocks = new Strokes();
  for (const a of [20, 200]) { outerT.poly(circ(0.43, a, a + 110, 22)); blocks.line(xy(a - 6, 0.43), xy(a - 1, 0.43)).line(xy(a + 111, 0.43), xy(a + 116, 0.43)); }
  return {
    sets: [{ a: core.a, w: 1 }, { a: coreB.a, w: 2.4 }, { a: ring.a, w: 2.6, speed: 0.35 },
      { a: outer.a, w: 2.2, speed: -0.2 }, { a: outerT.a, w: 1, speed: -0.2 }, { a: blocks.a, w: 2.6, speed: -0.2 }],
    fill: sectors((a, r) => xy(a, r), 0.17, 0.29, [[30, 60], [210, 240]]),
    pick: new THREE.SphereGeometry(0.45, 10, 8),
  };
}
function slideHud() {
  const thin = new Strokes(), bold = new Strokes();
  for (const k of [1, -1]) {
    thin.line([0, 0, k * 0.47], [0, 0, k * 1.3]);
    bold.line([0, 0, k * 0.98], [0, 0, k * 1.2]);
    for (let i = 0; i < 4; i++) {                    // hatch: ////, in both planes through the shaft
      const z = k * (0.56 + i * 0.07);
      thin.line([-0.05, 0, z], [0.05, 0, z + k * 0.05]).line([0, -0.05, z], [0, 0.05, z + k * 0.05]);
    }
    const tip = [0, 0, k * 1.5];
    for (const [x, y] of [[0.09, 0], [-0.09, 0], [0, 0.09], [0, -0.09]]) bold.line(tip, [x, y, k * 1.36]);
  }
  return { sets: [{ a: thin.a, w: 1 }, { a: bold.a, w: 2.6 }], fill: null, pick: new THREE.CylinderGeometry(0.18, 0.18, 3.2, 8).rotateX(Math.PI / 2) };
}
function turnHud(axis) {
  const at = (p, q) => (axis === 'x' ? [0, p, q] : [p, 0, q]);
  const pol = (deg, r) => at(r * Math.cos(D(deg)), r * Math.sin(D(deg)));
  const arc = (r, a0, a1, s) => s.poly(Array.from({ length: 24 }, (_, i) => pol(a0 + (a1 - a0) * i / 23, r)));
  const thin = arc(1, ARC[0], ARC[1], new Strokes()), bold = new Strokes();
  for (const [a0, a1] of [[13, 27], [33, 47], [53, 67]]) arc(1.07, a0, a1, bold);
  for (let deg = 15; deg < ARC[1]; deg += 15) thin.line(pol(deg, 0.86), pol(deg, 1.13));
  for (const deg of ARC) bold.line(pol(deg, 0.94), pol(deg, 1.12));
  const dotted = dots(new Strokes(), (a) => pol(a, 0.9), ARC[0] + 2, ARC[1] - 2, 3);
  const curve = new THREE.CatmullRomCurve3(Array.from({ length: 12 }, (_, i) => new THREE.Vector3(...pol(ARC[0] - 4 + (ARC[1] - ARC[0] + 8) * i / 11, 1))));
  return {
    sets: [{ a: thin.a, w: 1 }, { a: bold.a, w: 2.6 }, { a: dotted.a, w: 2 }],
    fill: sectors((a, r) => pol(a, r), 0.8, 1, [ARC]),
    pick: new THREE.TubeGeometry(curve, 24, 0.18, 6),
  };
}
const HUD = { move: moveHud, slide: slideHud, turnX: () => turnHud('x'), turnY: () => turnHud('y') };

// ---------- the pipe look: glass solids. Each shape gives `glass` [{ geo, tone: base | accent }], `glow` strokes
// (centre lines, drawn as a wide additive line for the bloom) and a pick mesh ----------
// an arc of a ring with a rectangular section in the xy plane: radius r, a0..a1 degrees, w wide (radially),
// t thick (along z), flat ends. `edge` runs 0..1 across each face, so the shader can light the rims.
function bandGeo(r, a0, a1, w, t, n = 32) {
  const P = [], E = [], C = [[-w / 2, -t / 2], [w / 2, -t / 2], [w / 2, t / 2], [-w / 2, t / 2]];
  const pt = (a, [dr, dz]) => [(r + dr) * Math.cos(a), (r + dr) * Math.sin(a), dz];
  const quad = (p0, p1, p2, p3) => { P.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3); E.push(0, 1, 1, 0, 1, 0); };
  for (let i = 0; i < n; i++) {
    const A = D(a0 + (a1 - a0) * i / n), B = D(a0 + (a1 - a0) * (i + 1) / n);
    for (let k = 0; k < 4; k++) quad(pt(A, C[k]), pt(A, C[(k + 1) % 4]), pt(B, C[(k + 1) % 4]), pt(B, C[k]));
  }
  for (const a of [D(a0), D(a1)]) quad(...C.map((c) => pt(a, c)));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('edge', new THREE.Float32BufferAttribute(E, 1));
  geo.computeVertexNormals();
  return geo;
}
// a smooth solid (rod, cone) gets a constant edge: it is lit by its silhouette instead
const solid = (geo) => { geo = geo.toNonIndexed(); geo.setAttribute('edge', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count).fill(0.5), 1)); return geo; };
const ringStrokes = (r, rot) => new Strokes().poly(circ(r, 0, 360, 72).map((p) => new THREE.Vector3(...p).applyMatrix4(rot).toArray())).a;
function turnPipe(axis) {
  const rot = new THREE.Matrix4().makeRotationFromEuler(axis === 'x' ? new THREE.Euler(0, Math.PI / 2, 0) : new THREE.Euler(Math.PI / 2, 0, 0));
  const glass = [];
  for (const [a0, a1] of [[8, 112], [128, 232], [248, 352]]) glass.push({ geo: bandGeo(1, a0, a1, 0.085, 0.05).applyMatrix4(rot), tone: 'base' });
  for (const [a0, a1] of [[68, 172], [188, 292], [308, 412]]) glass.push({ geo: bandGeo(0.885, a0, a1, 0.045, 0.045).applyMatrix4(rot), tone: 'accent' });
  return { glass, glow: ringStrokes(1, rot), pick: new THREE.TorusGeometry(1, 0.15, 6, 48).applyMatrix4(rot) };
}
function slidePipe() {
  const glass = [];
  for (const k of [1, -1]) {
    const flip = (g) => (k < 0 ? g.rotateX(Math.PI) : g);
    glass.push({ geo: solid(flip(new THREE.CylinderGeometry(0.028, 0.028, 1.0, 12).rotateX(Math.PI / 2).translate(0, 0, 0.68))), tone: 'base' });
    glass.push({ geo: solid(flip(new THREE.ConeGeometry(0.085, 0.24, 20).rotateX(Math.PI / 2).translate(0, 0, 1.3))), tone: 'base' });
    glass.push({ geo: flip(bandGeo(0.06, 0, 360, 0.03, 0.05, 24).translate(0, 0, 0.3)), tone: 'accent' });     // a collar near the orb
  }
  const s = new Strokes().line([0, 0, -1.4], [0, 0, 1.4]);
  return { glass, glow: s.a, pick: new THREE.CylinderGeometry(0.18, 0.18, 3.2, 8).rotateX(Math.PI / 2) };
}
function movePipe() {
  return { orb: true, glass: [], glow: [], pick: new THREE.SphereGeometry(0.22, 10, 8) };
}
// the plane marker: dashed segments of a thin accent band in the plane (xy), a little outside the rings
function planeMarker() {
  const geos = []; for (let a = 0; a < 360; a += 24) geos.push(bandGeo(1.14, a, a + 14, 0.025, 0.012, 4));
  return geos;
}
const PIPE = { move: movePipe, slide: slidePipe, turnX: () => turnPipe('x'), turnY: () => turnPipe('y') };

// ---------- materials ----------
const lineMat = (o) => new LineMaterial({ transparent: true, depthWrite: false, linewidth: 1.25, side: THREE.DoubleSide, ...o });      // double-sided: the dials are mirrored
const holoMat = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  uniforms: { color: { value: new THREE.Color() }, opacity: { value: 0 }, time: { value: 0 } },
  vertexShader: 'varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform vec3 color; uniform float opacity; uniform float time; varying vec3 vP;
    void main() {
      float scan = 0.55 + 0.45 * sin(gl_FragCoord.y * 1.7);                    // scanlines, on the screen
      float sweep = pow(1.0 - fract(length(vP) * 1.4 - time * 0.35), 6.0);     // a pulse running outward
      gl_FragColor = vec4(color, opacity * scan * (0.55 + 0.9 * sweep));
    }`,
});
// glass: brighter where the face turns away (the silhouette) and along each face's rims, translucent elsewhere;
// the rims and silhouette take `edge` (the band's own colour, or the handle's axis colour)
const glassMat = (o = {}) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, ...o,
  uniforms: { color: { value: new THREE.Color() }, edgeColor: { value: new THREE.Color() }, edgeWhite: { value: 0.55 }, opacity: { value: 0 } },
  vertexShader: `attribute float edge; varying vec3 vN; varying vec3 vV; varying float vE;
    void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vE = edge; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 color; uniform vec3 edgeColor; uniform float edgeWhite; uniform float opacity; varying vec3 vN; varying vec3 vV; varying float vE;
    void main() {
      float facing = abs(dot(normalize(vN), normalize(vV)));
      float rim = pow(abs(vE * 2.0 - 1.0), 8.0), sil = pow(1.0 - facing, 3.0);
      vec3 c = color * (0.55 + 0.45 * facing) + mix(edgeColor, vec3(1.0), edgeWhite) * (rim * 0.9 + sil * 0.6);
      gl_FragColor = vec4(c, opacity * (0.5 + 0.5 * max(rim, sil)));
    }`,
});
// the orb: a dark glossy ball, a rim in the base colour, a core in the accent seen through it, one glint
const orbMat = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, depthTest: false,
  uniforms: { rimColor: { value: new THREE.Color() }, coreColor: { value: new THREE.Color() }, hot: { value: 0 } },
  vertexShader: `varying vec3 vN; varying vec3 vV;
    void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 rimColor; uniform vec3 coreColor; uniform float hot; varying vec3 vN; varying vec3 vV;
    void main() {
      vec3 n = normalize(vN), v = normalize(vV);
      float f = 1.0 - max(dot(n, v), 0.0), core = pow(max(dot(n, v), 0.0), 7.0);
      float glint = pow(max(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0), 40.0);
      vec3 c = vec3(0.03, 0.02, 0.07) + rimColor * pow(f, 2.2) * (0.9 + hot) + coreColor * core * (1.1 + hot) + vec3(glint * 0.8);
      gl_FragColor = vec4(c, 0.94);
    }`,
});
// a soft round glow (the orb's halo), a sprite
let glowTex = null;
function haloTex() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return (glowTex = new THREE.CanvasTexture(c));
}
const flatMat = () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
const pickMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false, colorWrite: false, side: THREE.DoubleSide });

export class Gizmo {
  // handles: which to show; px: the dial radius on screen; look: reticle | holo | tint | hud; layer: three layer
  constructor({ handles = ['move', 'slide', 'turnX', 'turnY'], px = 64, look = 'reticle', layer = 0, crisp = false, axisEdges = false } = {}) {
    this.px = px; this.look = look; this.crisp = crisp; this.axisEdges = axisEdges;
    this.object = new THREE.Group();          // add this to the scene; it stays at the origin
    this.body = new THREE.Group();            // the handles, placed and scaled every frame
    this.trace = null;                        // the drag's ruler / protractor, in world space
    this.base = new THREE.Color(0x00e5ff); this.accent = new THREE.Color(0x9a5cff); this.colors = {};
    this.hover = null; this.active = null; this.drag = null;
    this.ray = new THREE.Raycaster(); this.ray.layers.enableAll();
    this.lineMats = []; this.handles = new Map(); this.picks = [];
    this.mirror = { x: new THREE.Group(), y: new THREE.Group() };
    this.body.add(this.mirror.x, this.mirror.y);
    this.traceMat = lineMat({ depthTest: false, linewidth: 1.25 }); this.lineMats.push(this.traceMat);
    for (const name of handles) {
      if (look === 'pipe') { this.addPipe(name); continue; }
      const s = (look === 'hud' ? HUD : SHAPES)[name](), g = new THREE.Group(), sets = [];
      const screen = name === 'move';         // faces the camera, drawn over everything
      // each stroke set drawn three times: hidden part (dashed, faint), glow, visible part
      for (const { a, w = 1, speed = 0 } of s.sets ?? [{ a: s.strokes }]) {
        const geo = new LineSegmentsGeometry().setPositions(a);
        const back = new LineSegments2(geo, lineMat({ depthTest: false, dashed: true, dashSize: 0.035, gapSize: 0.035 }));
        back.computeLineDistances(); back.visible = !screen;
        const glow = new LineSegments2(geo, lineMat({ depthTest: false, blending: THREE.AdditiveBlending, linewidth: 6 }));
        const front = new LineSegments2(geo, lineMat(screen ? { depthTest: false } : { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }));
        back.renderOrder = 1000; glow.renderOrder = 1001; front.renderOrder = 1003;
        const holder = speed ? new THREE.Group() : g;
        holder.add(back, glow, front); if (speed) g.add(holder);
        this.lineMats.push(back.material, glow.material, front.material);
        sets.push({ back, glow, front, w, speed, holder });
      }
      const fill = look === 'holo' ? new THREE.Mesh(s.fill, holoMat()) : look === 'hud' && s.fill ? new THREE.Mesh(s.fill, flatMat()) : null;
      const pick = new THREE.Mesh(s.pick, pickMat); pick.userData.handle = name; this.picks.push(pick);
      g.add(pick);
      if (fill) { fill.renderOrder = 1002; g.add(fill); }
      this.handles.set(name, { g, sets, fill, screen });
      (name === 'turnX' ? this.mirror.x : name === 'turnY' ? this.mirror.y : this.body).add(g);
    }
    if (look === 'pipe') {
      this.marker = planeMarker().map((geo) => { const m = new THREE.Mesh(geo, glassMat()); m.renderOrder = 1002; this.body.add(m); return m; });
    }
    this.object.add(this.body);
    this.object.traverse((o) => o.layers.set(layer)); this.layer = layer;
  }
  // a pipe handle: each glass piece twice (a faint x-ray over everything, the solid where it is in front), a
  // wide additive line along it for the glow, the orb with its halo
  addPipe(name) {
    const s = PIPE[name](), g = new THREE.Group(), glass = [];
    for (const { geo, tone } of s.glass) {
      const xray = new THREE.Mesh(geo, glassMat({ depthTest: false })), main = new THREE.Mesh(geo, glassMat({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }));
      xray.renderOrder = 1000; main.renderOrder = 1003; g.add(xray, main);
      glass.push({ xray, main, tone });
    }
    let glow = null;
    if (s.glow.length) {
      glow = new LineSegments2(new LineSegmentsGeometry().setPositions(s.glow), lineMat({ depthTest: false, blending: THREE.AdditiveBlending }));
      glow.renderOrder = 1001; g.add(glow); this.lineMats.push(glow.material);
    }
    let orb = null, halo = null;
    if (s.orb) {
      orb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 32, 24), orbMat()); orb.renderOrder = 1005;
      halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(), transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.scale.setScalar(this.crisp ? 0.34 : 0.46); halo.renderOrder = 1004; g.add(halo, orb);
    }
    const pick = new THREE.Mesh(s.pick, pickMat); pick.userData.handle = name; this.picks.push(pick); g.add(pick);
    this.handles.set(name, { g, sets: [], glass, glow, orb, halo, pipe: true });
    this.body.add(g);
  }
  // the base colour (reticle, holo) and per-handle colours (tint) as hex numbers
  setColors(base, perHandle = {}, accent = 0x9a5cff) { this.base.setHex(base); this.accent = new THREE.Color(accent); for (const [k, v] of Object.entries(perHandle)) this.colors[k] = new THREE.Color(v); }
  place(position, quaternion) { this.body.position.copy(position); this.body.quaternion.copy(quaternion); }
  get visible() { return this.object.visible; }
  set visible(v) { this.object.visible = v; }

  // world mm per screen pixel at the gizmo, for a viewport `h` px tall
  mmPerPixel(camera, h, p = this.body.position) {
    if (camera.isOrthographicCamera) return (camera.top - camera.bottom) / camera.zoom / h;
    return 2 * camera.position.distanceTo(p) * Math.tan(D(camera.fov / 2)) / h;
  }
  colorOf(name) {
    if (!this.colors[name] || (this.look !== 'tint' && this.look !== 'pipe')) return this.base.clone();
    if (this.look === 'pipe') return this.colors[name].clone();       // the axis colour, for axisEdges
    const c = this.colors[name].clone().lerp(this.base, 0.25), hsl = {};
    c.getHSL(hsl); return c.setHSL(hsl.h, hsl.s * 0.7, Math.min(hsl.l, 0.62));
  }
  // before rendering into a w x h viewport with `camera`
  update(camera, w, h, time = performance.now() / 1000) {
    const s = this.px * this.mmPerPixel(camera, h);
    this.body.scale.setScalar(s); this.scale = s;
    if (!this.drag && this.look !== 'pipe') {        // stand the dials up on the camera's side of each axis (pipe rings are whole)
      const cam = camera.position.clone().sub(this.body.position).applyQuaternion(this.body.quaternion.clone().invert());
      const side = (v) => (v < 0 ? -1 : 1);
      this.mirror.x.scale.set(1, side(cam.y), side(cam.z)); this.mirror.y.scale.set(side(cam.x), 1, side(cam.z));
    }
    for (const m of this.lineMats) m.resolution.set(w, h);
    const facing = this.body.quaternion.clone().invert().multiply(camera.quaternion);      // body-local turn that faces the camera
    for (const [name, h_] of this.handles) {
      const hot = this.active === name || (!this.active && this.hover === name), idle = !!this.active && !hot;
      const c = this.colorOf(name); if (hot) c.lerp(WHITE, 0.4);
      if (h_.screen) h_.g.quaternion.copy(facing);
      for (const { back, glow, front, w, speed, holder } of h_.sets) {
        front.material.color.copy(c); front.material.opacity = idle ? 0.12 : hot ? 1 : 0.72; front.material.linewidth = 1.25 * w + (hot ? 0.75 : 0);
        back.material.color.copy(c); back.material.opacity = idle ? 0.04 : hot ? 0.4 : 0.22; back.material.linewidth = 1.25 * w;
        glow.material.color.copy(c); glow.material.opacity = idle ? 0 : hot ? 0.2 : 0.07; glow.material.linewidth = 4 + 1.5 * w + (hot ? 3 : 0);
        if (speed) holder.rotation.z = time * speed * (hot ? 2.5 : 1);
      }
      if (h_.pipe) {
        const b = this.base.clone(), a = this.accent.clone(), ax = this.colorOf(name);
        if (hot) { b.lerp(WHITE, 0.4); a.lerp(WHITE, 0.3); ax.lerp(WHITE, 0.3); }
        for (const { xray, main, tone } of h_.glass) {
          const col = tone === 'accent' ? a : b, edge = this.axisEdges ? ax : col;
          for (const m of [main, xray]) { const u = m.material.uniforms; u.color.value.copy(col); u.edgeColor.value.copy(edge); u.edgeWhite.value = this.axisEdges ? 0.1 : 0.55; }
          main.material.uniforms.opacity.value = idle ? 0.12 : hot ? 0.95 : 0.72;
          xray.material.uniforms.opacity.value = idle ? 0.02 : hot ? 0.22 : this.crisp ? 0.06 : 0.1;
        }
        if (h_.glow) {
          const m = h_.glow.material; m.color.copy(this.axisEdges ? ax : b);
          m.opacity = idle ? 0 : this.crisp ? (hot ? 0.12 : 0.05) : hot ? 0.22 : 0.09;
          m.linewidth = this.crisp ? (hot ? 10 : 7) : hot ? 20 : 13;
        }
        if (h_.orb) {
          const u = h_.orb.material.uniforms; u.rimColor.value.copy(this.base); u.coreColor.value.copy(this.accent); u.hot.value = hot ? 1 : 0;
          h_.halo.material.color.copy(this.accent); h_.halo.material.opacity = idle ? 0.1 : hot ? 0.7 : this.crisp ? 0.22 : 0.32;
        }
        continue;
      }
      const { fill } = h_;
      if (fill?.material.uniforms) { const u = fill.material.uniforms; u.color.value.copy(c); u.opacity.value = idle ? 0.04 : hot ? 0.6 : 0.3; u.time.value = time; }
      else if (fill) { fill.material.color.copy(c); fill.material.opacity = idle ? 0.02 : hot ? 0.16 : 0.07; }
    }
    for (const m of this.marker ?? []) { m.material.uniforms.color.value.copy(this.accent); m.material.uniforms.opacity.value = this.drag ? 0.75 : 0.4; }
    this.traceMat.color.copy(this.colorOf(this.active ?? 'move')).lerp(WHITE, 0.4);
  }

  // ---------- picking and dragging (ndc: the pointer in the viewport's -1..1) ----------
  pick(ndc, camera) {
    if (!this.visible) return null;
    this.ray.setFromCamera(ndc, camera);
    return this.ray.intersectObjects(this.picks, false)[0]?.object.userData.handle ?? null;
  }
  line(ndc, camera) { this.ray.setFromCamera(ndc, camera); return { o: this.ray.ray.origin.clone(), d: this.ray.ray.direction.clone() }; }
  axis(i) { return new THREE.Vector3().setComponent(i, 1).applyQuaternion(this.body.quaternion); }
  // begin a drag on a handle; false when it cannot start (a dial or the plane seen edge-on)
  begin(handle, ndc, camera) {
    const p0 = this.body.position.clone(), x = this.axis(0), y = this.axis(1), z = this.axis(2);
    const d = { handle, p0, x, y, z };
    if (handle === 'turnX' || handle === 'turnY') {
      d.ax = handle === 'turnX' ? x : y;
      d.a0 = this.ringAngle(ndc, camera, p0, d.ax, z); if (d.a0 === null) return false;
    } else if (handle === 'move') {
      d.q0 = this.onPlane(ndc, camera, p0, z); if (!d.q0) return false;
    }
    this.drag = d; this.active = handle;
    return true;
  }
  // the drag so far: { handle, t } (slide, mm), { handle, du, dv } (move, mm), { handle, deg, axis } (turn),
  // each snapped, plus `text` for a label. Apply it to the start pose (p0 and the rotation at begin).
  move(ndc, camera, { alt = false, ctrl = false } = {}, viewportH = 1) {
    const d = this.drag; if (!d) return null;
    const mm = alt ? 0.1 : 1, f = alt ? 1 : 0;
    let r = null;
    if (d.handle === 'slide') {
      const { o, d: dir } = this.line(ndc, camera), t = snap(nearestT(d.p0, d.z, o, dir), mm);
      r = { handle: 'slide', t, text: `${sgn(t)}${t.toFixed(f)} mm` };
    } else if (d.handle === 'move') {
      const q = this.onPlane(ndc, camera, d.p0, d.z); if (!q) return null;
      const dl = q.sub(d.q0), du = snap(dl.dot(d.x), mm), dv = snap(dl.dot(d.y), mm);
      r = { handle: 'move', du, dv, text: `${sgn(du)}${du.toFixed(f)} / ${sgn(dv)}${dv.toFixed(f)} mm` };
    } else {
      const a = this.ringAngle(ndc, camera, d.p0, d.ax, d.z); if (a === null) return null;
      const deg = snap(THREE.MathUtils.radToDeg(a - d.a0), alt ? 0.1 : ctrl ? 15 : 1);
      r = { handle: d.handle, deg, axis: d.ax.clone(), text: `${sgn(deg)}${deg.toFixed(f)}°` };
    }
    this.drawTrace(r, camera, viewportH);
    return r;
  }
  end() { this.drag = null; this.active = null; this.setTrace(null); }

  // where the pointer ray meets the plane through c with normal n; null edge-on
  onPlane(ndc, camera, c, n) {
    const { o, d } = this.line(ndc, camera), dn = d.dot(n);
    return Math.abs(dn) < 1e-3 ? null : o.addScaledVector(d, c.clone().sub(o).dot(n) / dn);
  }
  // the pointer's angle about `axis` through c, from e1, in the dial's plane; null edge-on
  ringAngle(ndc, camera, c, axis, e1) {
    const { o, d } = this.line(ndc, camera), dn = d.dot(axis);
    if (Math.abs(dn) < 1e-3) return null;
    const q = o.addScaledVector(d, c.clone().sub(o).dot(axis) / dn).sub(c);
    return Math.atan2(q.dot(axis.clone().cross(e1)), q.dot(e1));
  }

  // ---------- the trace ----------
  setTrace(strokes) {
    if (this.trace) { this.object.remove(this.trace); this.trace.geometry.dispose(); this.trace = null; }
    if (!strokes?.length) return;
    this.trace = new LineSegments2(new LineSegmentsGeometry().setPositions(strokes), this.traceMat);
    this.trace.renderOrder = 1004; this.trace.layers.set(this.layer);
    this.object.add(this.trace);
  }
  drawTrace(r, camera, viewportH) {
    const d = this.drag, s = new Strokes(), ppx = this.mmPerPixel(camera, viewportH, d.p0);
    const v = (p) => p.toArray();
    // a ruler from a along dir for len mm, ticks on the side `side`: every step (8 px or more), long every 5th
    const ruler = (a, dir, len, side) => {
      const b = a.clone().addScaledVector(dir, len); s.line(v(a), v(b));
      const step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].find((st) => st / ppx >= 8) ?? 1000;
      for (let k = 0, n = Math.floor(Math.abs(len) / step + 1e-6); k <= n; k++) {
        const p = a.clone().addScaledVector(dir, Math.sign(len) * k * step), L = (k % 5 === 0 ? 9 : 4) * ppx;
        s.line(v(p), v(p.clone().addScaledVector(side, L)));
      }
      s.line(v(b.clone().addScaledVector(side, -6 * ppx)), v(b.clone().addScaledVector(side, 12 * ppx)));
    };
    if (r.handle === 'slide') ruler(d.p0, d.z, r.t, d.x);
    else if (r.handle === 'move') {
      const off = d.x.clone().multiplyScalar(r.du).addScaledVector(d.y, r.dv), len = off.length();
      if (len > 1e-6) ruler(d.p0, off.normalize(), len, d.z.clone().cross(off).normalize());
    } else {        // a protractor: spokes at the start and current normal, the arc between, a tick every 5°
      const R = 0.62 * this.scale, rot = (deg) => d.z.clone().applyAxisAngle(r.axis, D(deg));
      s.line(v(d.p0), v(d.p0.clone().addScaledVector(rot(0), R * 1.15)));
      s.line(v(d.p0), v(d.p0.clone().addScaledVector(rot(r.deg), R * 1.15)));
      const n = Math.max(2, Math.ceil(Math.abs(r.deg) / 2));
      s.poly(Array.from({ length: n + 1 }, (_, i) => v(d.p0.clone().addScaledVector(rot(r.deg * i / n), R))));
      for (let a = 0; a <= Math.abs(r.deg) + 1e-6; a += 5) {
        const u = rot(Math.sign(r.deg) * a);
        s.line(v(d.p0.clone().addScaledVector(u, R)), v(d.p0.clone().addScaledVector(u, R * (a % 15 === 0 ? 1.1 : 1.05))));
      }
    }
    this.setTrace(s.a);
  }
}

// parameter t of the point on the line p0 + a·t nearest to the line o + d·s
function nearestT(p0, a, o, d) {
  const w = p0.clone().sub(o), ad = a.dot(d), aw = a.dot(w), dw = d.dot(w);
  const den = 1 - ad * ad; if (den < 1e-6) return 0;
  return (ad * dw - aw) / den;
}
