# Lessons

Things the tools and prints taught us that are not obvious from the code. Dated so you can tell what was checked against which build. Add to this file when a session learns something general; project-specific notes belong in that model's `CLAUDE.md`.

## OpenSCAD

- **Partial-angle `rotate_extrude` renders as one chord** (2026-09, nightly 2026.09.06, Manifold). `rotate_extrude(angle = 6.9, $fn = 720)` produced a single straight segment regardless of `$fn/$fa/$fs` (the inner edge sagged 0.09 mm at r 46). Harmless while buried in a wall; a phantom collision the moment a notch exposed it. Sweep the profile yourself (`arc_sweep()` in `armenscad/shape.scad`: hull of rotated copies) or clip the result to the intended radius. The collision checker found it; keep it in the loop.
- **Touching faces break watertightness.** A union of two solids whose faces merely touch can come out non-watertight from Manifold; sink one 0.1-0.2 mm into the other. Crossed V-grooves of equal depth (a knurl) do the same; cut the second set at 0.8 x depth.
- **`for` inside `intersection()`** unions its iterations into one child; use `intersection_for` to clip by several planes in a loop.
- **Include + override evaluates at the first assignment** (2026-10-26, cardgrid). A game file that does `include <lib.scad>` and then reassigns `layout = style == "a" ? a : b;` gets that expression evaluated where lib.scad first assigned `layout`, before anything the game file defines after the include: every new name reads undef (warnings: "Ignoring unknown variable"). Put data the override reads *above* the include; only the reassignment itself goes below. Plain value overrides (`card_t = 0.30;`) are unaffected.
- **Text width without textmetrics:** for Liberation Sans Bold caps, one character advances about 1.1 x `size`. Size every line of a multi-line label from the longest (`min(max, width / (len * 1.1))`) instead of `resize()` per line, which makes lines of one label different heights.
- **Text on a 0.4 nozzle** (2026-10-30, cardgrid, H2C): Liberation Sans Bold below size 3 loses strokes. Opening the outline by a 0.4 line keeps 1 % of the area at size 2 (punctuated caps, S.H.I.E.L.D.), 71 % at 2.5, 97 % at 3, 99 % at 5.5. Printed size 2-3 labels were unreadable, so use 5 or more. `textmetrics()` works on the snapshot without any --enable flag, so measure widths instead of estimating.
- **Huge helper solids** (half-space cubes) blank `-o png` previews: the preview camera is sized from every primitive. Add `--render`.
- **Install (macOS):** the stable `openscad` cask was disabled by Homebrew on 2026-09-01; use `brew install --cask openscad@snapshot`. Binary at `/opt/homebrew/bin/openscad`, app in /Applications. `--backend Manifold`, `--imgsize`, `--viewall`, `--autocenter`, `--camera` all work headless.

## Measuring and comparing meshes

- **`voxcmp.py` gave confident wrong numbers** until 2026-09-26 on meshes with exact integer coordinates: one cumulative winding sum across all columns meant a single missed crossing (a ray exactly on a triangle edge, which integer coordinates make common) poisoned every later column (a port read 687 L against a 430 L reference). Fixed: depth reset per column, grid origin offset by 1.2137 x res, barycentric tolerance -1e-9. `svgpts.py --pts` also dropped real corners next to duplicated SVG vertices (dedupe before the collinear filter). Rule: when a comparison or section reading looks impossible, run the tool on the reference against itself before believing the geometry.
- **STL exports from CAD may be several overlapping shells.** Mesh booleans on such a file lie; split per shell and compare with `voxcmp`, which counts overlaps once. Downloads (3MF kits, Thingiverse) often have open shells or inverted normals, which print as missing features; `stlshells.py` unions the closed shells and reports the open ones.
- **Scans lie about holes.** On a 3D-scanned part every "obvious" hole picked off the silhouette was wrong; shallow holes get capped by the scanner. Use the viewer's note `hits` (world mm under the user's stroke) and fit the axis from the triangle normals around them, or ask for a photo.
- **Listing photos are 30-50 degrees elevated.** Never read one as an orthographic profile. Solve the camera from a known near/far dimension and express lengths in units of something in frame (a rail diameter) until the real part is measured.

## Reading reference files

- **`.shapr` (Shapr3D)** is a zip with `.metadata` (JSON) and `workspace` (SQLite). Verified on Shapr3D 26.91 (HistoryVersion 87). `SketchControllers` = sketch name + plane (center, normal, U); `SketchCurves.Data` is JSON in metres (type 0 line, 1 arc, 2 circle); `HistoryTreeNodes.Properties` is MessagePack: type 0 root (ordered op ids), type 2 op `[ver, ver, name, opName, [paramNodeIds]]`, type 3 param `[[[kind, payload]]]` with kind 12 = measure `[[1,1], metres]` (unit 2 = radians), 9 refs, 7 name ref, 10 sketch ref. `PersistedCalls` holds extrude transforms and pattern matrices. `tools/shapr_dump.py` prints all of it in mm. The file beats the owner's memory of the dimensions every time.
- **STEP**: fillet radii are the minor radius of `TOROIDAL_SURFACE`; face levels are readable too.

## Placing parts without mirroring them

A frame built from "u along this edge, v in, w up" is left-handed half the time. Pick two axes as unit vectors in the case frame and take their cross product for the third; never mirror by hand. Graphics card: with a = bracket to tip and c = PCB to fans, the PCIe fingers edge runs along a x c (seen from the fan side with the ports on the left, the fingers are along the bottom edge). Sanity-check any new orientation against an ordinary ATX tower (fingers toward the board wall, fans down, bracket rear). Getting this wrong cost two sessions on a case layout.

## Print design rules that held

- **Rigid beats springy.** Snap features that flex (PLA, PETG) failed twice; twist locks, keyholes with a detent, captured parts with a pin, and serrated bolted joints held. PLA snaps need under 3 % strain, which thin printed arms do not get.
- **Split the part under iteration.** When one region keeps changing, make it its own print joined by a long sliding dovetail along one axis (rail on the small part, groove open at both ends in the big one). A one-sided dovetail, flat on the bed face and tapered on the other, prints flat with no overhang. Clearance is a coupon parameter (`slide_clr`); a 1.2 mm rail was far too loose at 0.1-0.25 per face, a 2.5 mm rail was tried at -0.1/0/0.1. Brackets that fix to a host get glued in place using the assembled part as the jig.
- **Settled clearances are functions in `armenscad/fit.scad`** (`fit_pin_clr()` 0.3 on the diameter, `fit_hinge_clr()` 0.15 per side, `fit_fil_clr()` 0.15 per side; Bambu H2C, 0.4 nozzle, PLA Matte, 0.2 layers). Every turning fit landed on 0.15 per side. Call the function and cite it; add one when a coupon settles something new. On another printer, re-settle with the coupon first.
- **Fairings must overlap the edge they join at full width.** A cone tapering to a point right at an edge is a failure point; so is a thin plate printed on end (strong holes, fragile plate; 45 degrees was the compromise).
- **Hinge barrels** lift 0.6 mm off the adjacent edge or they fuse; teardrop holes point up in the print pose.

## The viewer (for whoever works on it)

- **Bun drops idle SSE after 10 s** (`Bun.serve` default `idleTimeout`). Behind the Vite proxy the browser side stayed open, so `EventSource` never errored and the page went deaf after the first build. Fix in place: `idleTimeout: 0`, a `ping` every 15 s, a client watchdog that reconnects after 45 s. Test live reload with a build more than 10 s after page load.
- **Section caps** (`viewer/src/section.js`) are stencil-based, hatched per part, red cross-hatch where two parts overlap on the plane. A `Group`'s renderOrder sorts its children as a block before everything else, which silently drew caps before their stencil masks: every stencil/cap mesh sits in the scene directly. State is axis + mm + flip + rot [a,b] + pivot; the gizmo (arrow = slide, two arcs = tilt, centre puck = move the pivot across the plane) came after two direct-manipulation attempts (trackball, hinge swing) that felt wrong: treat it as a transform of the plane with explicit handles, not a camera move. alt = fine steps, ctrl = 15 degrees. Full rings crossing at the pivot read as a tangle; short arcs mirrored each frame to the camera's side of the plane read as handles.
- **Shading** (`viewer/src/shading.js`): key-light PCF shadows with the shadow camera refit to the visible bounds each frame and `clipShadows` so sectioned-away geometry casts nothing; `EdgesGeometry` lines per part sharing its clipping plane; headlight fill aimed at the orbit target; `polygonOffset` on part materials so the lines sit on top.
- **The ground grid is one shader on a plane** (`viewer/src/grid.js`): three 10x line levels picked from the zoom and cross-faded across a decade, axis lines through the origin, halo from `--grid-glow`, fade to the horizon. The plane is a unit quad moved under the camera and scaled to the fade radius each frame; a plane simply made huge has its depth interpolated from vertices far off screen and bleeds through faces. The print bed (`viewer/src/printers.js`, figures from Bambu Studio's machine profiles) draws on the same plane, centred on the origin.
- **A part modelled below Z = 0 sits under the grid**, so the grid's lines draw over its faces (pc_feet hangs from its mount face at Z = 0). That is the plane in front of the part, not a depth bug: an hour went into "fixing" it. Check the part's bounding box first.
- **Section and shading state is in localStorage, shared with the user's tab.** Switch a section back off after testing.
- **Part names in `viewer.json` must not contain spaces** (the STL route 500s).
- **The camera far plane follows orbit distance**, so metre-scale models (a room in inches) show.
- **UI reference is Shapr3D.** Read its help pages before designing an interaction (support.shapr3d.com blocks plain fetches; read it in the browser). Section view there is a toggle that remembers its plane, the plane comes from clicking a plane or face, and flip is a badge on the canvas, not a panel.
- **Anything drawn in WebGL takes its colours from CSS tokens** through `viewer/src/tokens.js` (resolve on a hidden element, read the pixel back, because tokens are `color-mix()` and nested `var()`), re-read on the bus's `skin` event. Never hard-code a hex in the render: the CyberDOS rules (one chrome, one live, one signal) break the moment an RGB axis or a yellow arrow appears.
- **Selection outline is an inverted hull in screen space**: back faces pushed out N px along smoothed normals in the vertex shader (`onBeforeCompile` on a `MeshBasicMaterial`, so clipping still works). The normals must come from welded vertices (`mergeVertices` on position only) or the shell cracks at every crease; that weld takes ~350 ms on a 400k-triangle part, so hulls are built when the page is idle. An emissive tint alone vanishes on parts near the selection colour.
- **Testing in Chrome**: `?skin=` writes the shared skin cookie (put it back). Synthetic `PointerEvent`s break where a handler calls `setPointerCapture`; use a real drag. Editing a module Vite can't hot-swap reloads the page and drops in-page state such as a half-done pick.

## Pegs that fall off a mesh-soup print (2026-10-24, Hero Factory visors)
Two ways a download's peg prints with no bond, both invisible in the slicer preview:
1. The peg is its own closed shell floating 0.02-0.4 mm off the body (stlinfo: shells > 1; the pegfix script
   measures the gap). `armenscad stlpegfix` stretches each such shell 0.8 mm into the body along its axis.
2. The peg sits in a zero-clearance hole in the body: coincident contours, edges shared by 4 faces, winding
   consistent, is_volume False. A layer through it shows the peg as a separate loop inside a round notch, so the
   slicer draws peg and body as separate perimeters. Manifold and Blender's exact boolean both pass the mesh
   through unchanged. `armenscad stlremesh` (Blender voxel remesh, then stlshells --min-vol) fuses it; verify by
   sectioning through the peg (trimesh `section`, plot the loops) and seeing one outline, not a circle in a notch.
- **Part photos (2026-10-26):** BrickLink and Rebrickable serve 200 px part images to curl; BrickOwl's
  `img.brickowl.com/files/image_cache/larger/<slug>.jpg` is 700 px and curl-able (find the slug through the
  part page in a browser tab; the search page blocks curl). Good enough to read holes, plates and fillets.
  LDraw gives the numbers (read the .dat subparts directly, 1 LDU = 0.4 mm) but simplifies shapes.
- **`armenscad check` threshold:** overlaps under ~0.02 mm3 print as clear. A soft stop a few degrees away
  (a rim rising into a plate) will not show; reason about it geometrically.
- **Fillet strips need to overlap the faces they fill.** Quarter-round strips laid exactly on a wall and a
  floor face left 98 open edges in a Manifold union (cardgrid, 2026-10-27). Sink the 2D profile `eps` into both
  faces (`translate([-eps, -eps]) square(r + eps)` minus the circle) and the part comes out watertight.
- **Side-by-side mock-up rows beat abstract options.** For a design fork, put each variant in the same model as
  its own module call in a row beside the assembly (one viewer group), with print poses, so the user can compare
  and print one. Keep the variants as switches afterwards rather than deleting them.
