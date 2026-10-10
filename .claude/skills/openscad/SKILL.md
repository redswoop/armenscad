---
name: openscad
description: Design parametric 3D-printed parts in OpenSCAD with the user using the scad/ workbench: model folder layout, the viewer, collision checks, coupon prints, export, and the session-end handoff. Use for any .scad work, new model folders, or "design me a part" requests here.
---

# OpenSCAD workbench

You and the user design real parts for an FDM printer together. Explain OpenSCAD constructs as you use them (the user may be learning the language), keep every dimension a named parameter, and validate with the tools below instead of eyeballing.

## Toolchain

- Binary: `openscad` on `PATH`, or `$OPENSCAD` (the viewer and the scripts look in that order, then `/opt/homebrew/bin/openscad`). It must be a development snapshot, the 2021 stable release has no Manifold backend; on macOS that is the cask `openscad@snapshot`. Always pass `--backend Manifold`.
- STL: `openscad --backend Manifold --export-format binstl -D 'part="x"' -o out.stl file.scad`
- PNG: add `--imgsize 1400,1000 --viewall --autocenter --camera 0,0,0,55,0,35,300` (see a model's `render.sh`).
- An empty result prints `Current top level object is empty.` and writes no file. That is what a passing collision check looks like.

## A model folder

Each model is its own folder in `scad/` (this repo's root) and its own git repo, ignored by this one. `examples/hinge_box/` is a small complete model to copy conventions from. Start one with `tools/new-model.sh <name>`; it copies `template/` and runs `git init`.

A toy with several parts is one repo with one subfolder per assembly (`whale/shroud/`, `whale/hatch/`), each with its own `viewer.json`, so previews stay small. `tools/new-model.sh whale/<name>` adds one. From a subfolder, `lib/` and `tools/` are `../../`; the viewer URL is http://127.0.0.1:5180/whale/<name>/ and `check.sh` takes `whale/<name>/check.scad`. Toy-wide notes go in the toy's top-level `README.md`.

| File | Role |
|---|---|
| `<name>.scad` | Parameters first, in `// ---------- section ----------` blocks (the viewer parses these into a panel). Switches (`show_*`, `animate`) at the top so harnesses can force them off. Modules below, one per feature, assembly at the bottom behind the switches. |
| `viewer.json` | Viewer manifest: `file`, optional `reference` STL, `defines` (switches to force off), `parts` = named module calls with colours, each with an optional `group` (parts of one assembly, e.g. every PSU piece, fold under one row in the viewer's tree and hide/show/select together). Every new top-level module goes in here. |
| `print_layout.scad` | `-D part="..."` lays each part on the bed in its print pose. |
| `check.scad` | Collision pairs. Header line `//   pair: "a" | "b"` lists them; `tools/check.sh` reads that line. |
| `compare.scad` | Volume diff against a reference export, when porting an existing part. |
| `coupon.scad` | Tolerance test print: three values of each clearance, labelled. |
| `export.sh` / `render.sh` | STLs into `stl/`, PNGs into `renders/` (renders are git-ignored). |
| `README.md` | Frame, assembly order, print poses, open items, gotchas. The handoff. |
| `ref/` | Photos, tracings, scans (committed). Captions and known scales in `ref/index.json`. The viewer shows them and can place one as a calibrated plane. |
| `annotations.json` | Viewer notes: strokes, arrows, labels, traced points, overlay placement. Written by the viewer server; read and acted on with `tools/notes`. |

Shared modules live in `lib/` (`use <../lib/shape.scad>`, `use <../lib/fit.scad>`; see `lib/README.md`). Extract a module there when a second model needs it, and prove the move with identical STL hashes.

## The loop

1. Viewer up: check `lsof -iTCP:5180 -sTCP:LISTEN`; if nothing, `cd viewer && bun run dev`. One server serves every model, so never start a second. Open http://127.0.0.1:5180/<name>/ (API :3003, `curl 127.0.0.1:3003/api/models` for status). It rebuilds on save and pushes to that model's page. Check `viewer/.dev.log` if a part shows as failed.
2. Look at your own work: screenshot the viewer with the Chrome tools, read `[viewer]` console lines. The user looks at the same page, so leave the tab open when you are done (never close it). Describe what you see before asking them to. Their markups arrive as annotations: `tools/notes <model>` (next section).
3. Collisions: `tools/check.sh <name>/check.scad 'pose1' 'pose2'` where a pose is `'steer=30 tilt=20'`. Run at the design extremes, not just at rest. Non-zero volume is a hit; `touch` means faces coincide, which is usually intended.
4. Export: `./export.sh` in the model folder. Then `tools/stlinfo.py stl/*.stl` for volume, size, watertightness and shell count. A part that should be one body but reports several shells is broken.
5. Coupon first. Before real parts, print `coupon.stl` with three values of every clearance. The user reports which one wins; write it back with `tools/scadset <name>.scad hinge_clr=0.4` and re-export.
6. Print feedback becomes a parameter, never a magic number. `hinge_clr`, `peg_clr`, `tie_eye_clr` and friends carry a comment saying which coupon round settled them.

## Notes, references, tracing (the viewer as shared context)

The user draws on the render (pen `p`, arrow `a`, label `t`, points `k` in the toolbar over the stage) and types a caption. Each note is saved in `<model>/annotations.json` with the camera pose and `hits`: the parts and world-mm points under the stroke. Strokes are screen-space and go stale when the geometry moves; **`hits` are the truth**, the stroke shows intent.

- "Look at the notes" / "what I drew": `tools/notes <model>` lists the open ones. For each id: `tools/notes <model> view <id>` moves every open tab to that camera (console prints `[viewer] view seq=N applied`), screenshot it, read the caption and hits, change the .scad, then `tools/notes <model> done <id> "what changed"`. The reply shows under the note in the sidebar.
- Ask the user something in the viewer: `tools/notes <model> add "question" --part hatch --xyz 10,20,3`. It appears in their list in purple.
- Shading: the **Shading** panel (shadows from the key light, dark edge lines on creases over 30°, a headlight fill that follows the camera; all on by default, remembered per model; `window.viewer.shading({shadows, edges, headlight})`). Turn shadows or edges off when a screenshot is about colour or when a huge mesh gets slow. Clipped-away geometry casts no shadow, so a section stays open.
- Size: the **Size** panel shows the bounding box (X/Y/Z lengths and min…max) of the selected part, the selected group, or every visible part; **box** (`b`) draws it in the scene with the edge lengths labelled. From the Chrome tools: `window.viewer.bounds()` → `{ target, size, min, max }`, `window.viewer.box(true)`.
- Sectioning: the **Section** panel (axis, mm slider, flip; `s` toggles) clips the parts and the reference ghost with one plane. Cut faces are capped in the part colour with a hatch (one line direction per part); where two parts occupy the same spot on the plane the cap is red cross-hatch, so a plan section doubles as a collision view. A gizmo sits on the plane: the yellow knob at its centre drags the gizmo across the plane (rotations happen about wherever it sits), the yellow double arrow slides the plane along its normal, the two rings (coloured for the world axes they start as, they follow the plane once tilted) turn it about the in-plane axes; a label shows the mm or degrees while dragging (snap 1, alt 0.1, ctrl 15°). On a hatched face: drag slides, click moves the gizmo there (that point becomes the centre of rotation), double-click flips the kept half. A faint outline of the whole plane shows during a drag. The panel's tilt row takes degrees about the other two axes; ⟲ goes back to axis-aligned. Stencil trick, needs watertight meshes. From the Chrome tools: `window.viewer.section({on:true, axis:'Z', mm:138, flip:false, rot:[20,0], pivot:[x,y,z]})`; with `ortho(true)` + `fitView('top')` it is a plan section. Remembered per model, and localStorage is shared with the user's tab, so switch it back off when done.
- Never edit `annotations.json` by hand while the viewer runs; the server owns it (writes go through the API/CLI, outside edits are reloaded but race). `window.viewer` in the page (Chrome tools) exposes `pose()/setPose()/annotations()/setTool()/overlay`.
- Reference images go in `<model>/ref/` (downscale phone photos first: `sips -Z 2000 *.jpeg`), captioned in `ref/index.json` with a `scale` (`{"px": [[x,y],[x,y]], "mm": d}`) whenever a ruler or a known dimension is in frame. `tools/notes <model> refs` lists them; the gallery in the sidebar shows them; "place as overlay" puts one in the scene as a plane.
- Tracing a profile: place the image, pick the plane (XY/XZ/YZ), `Face` (ortho, straight on), `Calibrate` (two clicks + the mm between them), `Set origin` (the image point at 0,0), flip/offset/rotate as needed. Then `k` and click along the curve, Enter. Consume with `tools/notes <model> points <id> --scad name --2d` and paste the list into the parameter block with the note id and image in the comment. The overlay placement persists in `annotations.json` `overlays[]`, so the same photo can be re-checked against a later print.
- Photos pasted into chat vanish on `/clear`; anything worth keeping goes in `ref/` the same session.

## Reference material

- The reference is the source of truth. Numbers quoted from memory have been wrong; the files have been right. Read the file, don't ask for dimensions.
- `.shapr` (Shapr3D): `tools/shapr_dump.py file.shapr` prints every sketch in mm and the history ops with their measures. Follow the history order in the .scad, one section per op.
- STEP: fillet radii (TOROIDAL_SURFACE minor radius) and face levels.
- STL from a CAD export may be several overlapping shells. Split it per shell (`ref_bodies/`) and compare with `tools/voxcmp.py port.stl ref.stl`, which counts overlapping shells once. Mesh booleans on such a file lie.
- Photos: scale off a known dimension, say so in the comment, and ask for calipers.

## Print rules that have held

- Every part gets a print pose in `print_layout.scad` with a flat face on the bed and no supports if at all possible. Ask what support material the printer has before designing a face that must be up.
- Print-in-place hinges: teardrop holes (`teardrop_2d`), clearance from `fit_hinge_clr()` in `lib/fit.scad` (settle it with a coupon on a new printer), barrel lifted 0.6 off the adjacent edge. Hide hinges on the inside face where possible.
- Snap features that flex have failed twice; rigid features (twist lock, keyhole with a detent) held. Prefer geometry that locks over geometry that springs.

## Gotchas

- `for` inside `intersection()` unions its iterations into one child; use `intersection_for` to clip by several planes in a loop.
- Huge helper solids (half-space cubes) make `-o png` previews blank: the preview camera is sized from every primitive. Add `--render` to the PNG command to the model's `render.sh`.
- Small-angle `rotate_extrude` renders as one straight chord on this build. Use `arc_sweep()` from `lib/shape.scad`. Buried fillets hide it; exposed arcs collide.
- Bun's server drops idle SSE after 10 s; the viewer already sets `idleTimeout: 0` and heartbeats. If live reload dies, check that first.
- Synced folders (Dropbox, iCloud): the file watcher works, but confirm a rebuild happened more than 10 s after page load before trusting it.
- Scratch scripts in the session scratchpad are wiped. Anything run twice goes in `tools/`.

## Session end

1. Update the model's `README.md`: state date, open items, what to print next (and the toy-level README's state table if there is one).
2. Commit in the model repo (and in `scad/` if tooling changed).
3. Save memory notes for anything non-obvious learned; link them.
