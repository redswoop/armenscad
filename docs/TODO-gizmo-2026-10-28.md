# Handoff: the section gizmo redesign (2026-10-28)

Armen's ask: the section gizmo is "garish and crazy looking"; he wants something "elegant, cyber-y", "some kind
of futuristic thing floating in there, not overly detailed but textured". And it must be factored so other
tools can use it (moving annotation endpoints later; the joints plan's drag-to-pose too).
Status: a lab, not wired into the viewer. `section.js` still uses its own old gizmo. Nothing committed.

## Files (all uncommitted)

- `viewer/src/gizmo.js`: the reusable `Gizmo` class. Knows nothing about sections: the owner calls
  `place(pos, quat)`, `update(camera, w, h)` each frame, `pick(ndc, camera)`, `begin/move/end` for a drag, and
  applies the numbers it gets back (`slide` t mm, `move` du/dv mm, `turnX/turnY` deg about an axis). The drag
  maths (nearestT, ringAngle, onPlane, snapping, alt/ctrl steps) was lifted from `section.js`, so section.js can
  drop its copy. Draws a ruler / protractor trace during a drag. Several looks live in it (`look:` reticle, holo,
  tint, hud, pipe); only the pipe look is still in the running, the rest go once one is chosen.
- `viewer/gizmo.html` + `src/gizmo-lab.js` + `src/gizmo-lab.css`: the lab, http://localhost:5180/gizmo.html.
  Loads `?model=` (default bones), one shared camera and section plane, one cell per look (row of 3, or 2x2),
  keys 1..n solo a look, 0 all, +/- gizmo size (viewer uses 64 px). Drag any gizmo and all follow. Always uses
  the default palette (it does not read the skin cookie), so `--live` comes out teal there, not kabuki cyan.
- Also uncommitted from this session, unrelated and done: the parts-tree fold chevrons are a lucide
  ChevronDown in a 22 px box (`parts.js`, `style.css`, `theme-cyber.css`); Armen said "looks good".

## How the look got here (Armen's reactions, in order)

1. A reticle (thin one-colour lines), B holo (+ scanline fills), C tinted (muted axis colours): no strong
   reaction. Dropped from the lab.
2. He sent a HUD sprite sheet (segmented rings, thick bars over hairlines, dotted rings, chamfered frames).
   D · HUD built from it: "getting better", but "the arcs look a little weird... oval segments" (flat
   hairline arcs in perspective). Fix tried: the centre reticle billboards (always round). Dials kept 3D:
   screen-flat dials break the turn maths when the axis lies across the screen.
3. He sent a Grok mock (glowing two-tone cyan/violet tube rings, glossy orb). Built E · light pipe: glass
   bands with rectangular section and lit rims, two broken two-tone rings (turn about the in-plane axes), a
   glass rod (slide), a dark glossy orb with violet core (move), a dashed violet ring in the cut plane (shows
   the plane; not a handle). He: "the light pipe is pretty good... we need more colors, one for each axis."
   Solid bands make perspective ovals read as rings, which is what fixed his oval complaint.
4. Per-axis colours (red/green/blue stand-ins on the bands): "those colors kind of ruin it", and "a bit
   overdone, fuzzy, we need something crisper".
5. Crisper attempt (dark near-opaque bodies, hard rims, glow nearly gone, softer RGB, inner band a darker
   shade): **"it really looks awful."** Reverted entirely.
6. Now in the lab: E1 = the light pipe as he liked it (cyan/violet, full glow), E2 = E1 with only glow and
   halo cut back (`crisp: true`), E3 = E2 with axis colour on the lit edges only (`axisEdges: true`). E3 is
   nearly invisible: the green axis sits on the cyan. He has not picked yet.

Lessons: per-axis colour fights a two-house-colour glass look; recolouring bodies or killing the glow loses
what he liked. Change one thing at a time and show it beside the version he approved.

## Found 2026-10-28 (Fable): the lab was showing every look through CyberDOS's CRT overlay

cyber.css paints `body::after` over the whole page (a 1 px dark line every 3 px, multiply, z 999). The viewer
is exempt (`body:has(.cd-shell)::after { display: none }`), the lab was not, so every look since A was judged
under a 33% stripe mask over the canvas: that is the "pixelated, fuzzy, broken" look, not the meshes. Fixed in
`gizmo-lab.css`. With the mask off and the gizmo at 128-192 px, Armen: "the thing was beautiful". At 64 px the
bands are 5 and 3 px and the glass rims are sub-pixel, so the viewer size needs to go up (he has not picked).
The section badges (DOM buttons) looked ragged because their ring was a 1 px curved border: on a 1x display Chrome
antialiases that to 2 px at the cardinal points and almost nothing at the diagonals (verified with 1x and 2x
device-pixel captures through DevTools). Done: the ring is 2 px, the box and its per-frame position are whole
pixels, the glyphs (⇅ ◎ ▱ ⟲, not in Share Tech Mono) are the rail's lucide icons. Armen has not judged it yet.
Then (same day): Armen's viewer window is on a 1x 2560x1440 display (Brave, devicePixelRatio 1; my first checks
hit the lab on the 2x laptop screen). The 2 px ring still read as low quality next to CyberDOS's pixel-straight
chrome, as did the grid and the Z axis (1 px GL lines, which MSAA does not touch). Done: the badges are
`.cd-entry-tile` tiles (chamfered, filled, straight edges), and `scene.js`, `viewcube.js` and the lab render at
pixel ratio 2 always, so a 1x display gets a supersampled frame (hairlines, rims and curves come out antialiased).
Lesson: judge every canvas look at 1x; anything thinner than 2 device px, and any curve, aliases there.

## Open

- Which of E1/E2/E3, or what's wrong with them in his words. Axis identity without recolouring the glass was
  offered: a small axis letter / coloured tick at each ring's end, or axis colour only on the hovered/dragged
  ring.
- Then: wire `section.js` onto `Gizmo` (keep its badges, label, cut-face gestures, picking-mode; delete its
  own gizmo and drag maths), take colours from skin tokens (`--gizmo-accent` for the violet; base `--live`),
  delete the losing looks and the lab's extra cells. The pipe look sizes: rings radius = px (64), bands
  0.085 x 0.05 of that.
- Banked for after the gizmo lands: moving annotations with it (see NOTES.md "Still open").

## Proposed, waiting on Armen: a 16-colour named palette in CyberDOS

He wants every CyberDOS theme to carry 16 named colours "that are in fact the colour they say they are", each
tuned to the theme, for content that legitimately needs a hue (axes, part colours, charts, syntax, terminal).
Proposal sent (not built; CyberDOS's CLAUDE.md says Armen makes every visual call):
- ANSI names (black red green yellow blue magenta cyan white + bright-*), tokens `--c-red`, `--c-bright-red`...,
  and the same in the native tokens. A separate layer from the roles, documented as content colour only, so the
  "no rainbow" rule (`test/core/palettes.test.ts`) still governs the chrome.
- Derived per palette in OKLCH: hue fixed by the name; lightness/chroma from the palette's character; snap to a
  palette role when within ~15-20° (Kabuki magenta = its chrome); black/white from bg/text; per-palette
  overrides like `derived`. A test keeps each within a few degrees of its named hue.
- First step offered: a swatch page (9 palettes x 16) for him to judge before wiring anything.
Question left open: ANSI names vs the DOS/CGA names.
