---
name: openscad
description: Design parametric 3D-printed parts in OpenSCAD with the user using the armenscad workbench (viewer, collision checks, coupon prints, shared lib, model template, session-end handoff). Use for any .scad work, a new model folder or workspace, or "design me a part" requests.
---

# OpenSCAD workbench

You and the user design real parts for an FDM printer together. The workbench is the `armenscad` command (on PATH while this plugin is enabled; `armenscad help` lists it): `browse`, `init`, `check`, `notes`, `install`, and every script in the plugin's `tools/` by name (`armenscad stlinfo`, `armenscad scadset`, ...). The plugin folder is `${CLAUDE_PLUGIN_ROOT}`; its `docs/lessons.md` holds the tool quirks and print lessons learned so far, read it when something looks wrong.

 Explain OpenSCAD constructs as you use them (the user may be learning the language), keep every dimension a named parameter, and validate with the tools below instead of eyeballing.

## Toolchain

- Binary: `openscad` on `PATH`, or `$OPENSCAD` (the viewer and the scripts look in that order, then `/opt/homebrew/bin/openscad`). It must be a development snapshot, the 2021 stable release has no Manifold backend; on macOS that is the cask `openscad@snapshot`. Always pass `--backend Manifold`.
- STL: `openscad --backend Manifold --export-format binstl -D 'part="x"' -o out.stl file.scad`
- PNG: add `--imgsize 1400,1000 --viewall --autocenter --camera 0,0,0,55,0,35,300` (see a model's `render.sh`).
- An empty result prints `Current top level object is empty.` and writes no file. That is what a passing collision check looks like.

## Workspaces and model folders

A **workspace** is any folder the user keeps models in (`~/3D/gi_joe/`); a **model** is a folder in it with a `viewer.json`, usually its own git repo. Start Claude in the workspace or the model folder; the model's `CLAUDE.md` loads when you touch its files. Start a model with `armenscad init <name> ["description"]` in the workspace: it copies the plugin's `template/` and runs `git init`. `${CLAUDE_PLUGIN_ROOT}/examples/hinge_box/` is a small complete model to copy conventions from.

A toy with several parts is one repo with one subfolder per assembly (`whale/shroud/`, `whale/hatch/`), each with its own `viewer.json`, so previews stay small. `armenscad init whale/<name>` adds one (no second git repo). Toy-wide notes go in the toy's top-level `README.md` and `CLAUDE.md`.

| File | Role |
|---|---|
| `<name>.scad` | Parameters first, in `// ---------- section ----------` blocks (the viewer parses these into a panel). Switches (`show_*`, `animate`) at the top so harnesses can force them off. Modules below, one per feature, assembly at the bottom behind the switches. |
| `viewer.json` | Viewer manifest: `file`, optional `reference` STL, `defines` (switches to force off), `parts` = named module calls with colours, each with an optional `group` (parts of one assembly, e.g. every PSU piece, fold under one row in the viewer's tree and hide/show/select together). Every new top-level module goes in here. |
| `print_layout.scad` | `-D part="..."` lays each part on the bed in its print pose. |
| `check.scad` | Collision pairs. Header line `//   pair: "a" | "b"` lists them; `armenscad check` reads that line. |
| `compare.scad` | Volume diff against a reference export, when porting an existing part. |
| `coupon.scad` | Tolerance test print: three values of each clearance, labelled. |
| `export.sh` / `render.sh` | STLs into `stl/`, PNGs into `renders/` (renders are git-ignored). |
| `README.md` | Frame, assembly order, print poses, open items, gotchas. The handoff. |
| `CLAUDE.md` | Project memory for Claude: brief, decisions and rejected directions with reasons, measured vs guessed, next. Loaded automatically when working in the folder. |
| `ref/` | Photos, tracings, scans (committed). Captions and known scales in `ref/index.json`. The viewer shows them and can place one as a calibrated plane. |
| `annotations.json` | Viewer notes: strokes, arrows, labels, traced points, overlay placement. Written by the viewer server; read and acted on with `armenscad notes <model folder>`. |

Shared modules live in the plugin's `lib/armenscad/` and are used by name from any folder: `use <armenscad/shape.scad>`, `use <armenscad/fit.scad>` (see `${CLAUDE_PLUGIN_ROOT}/lib/README.md`). The viewer and every `armenscad` command put the lib on OPENSCADPATH; `armenscad install` (once per machine) also symlinks it into OpenSCAD's user library folder and puts `armenscad` in `~/.local/bin`, so the GUI, the user's own shell and a model's `export.sh` resolve it too. If a render says it can't open `armenscad/...`, run that. Extract a module there when a second model needs it, and prove the move with identical STL hashes.

## The loop

1. Viewer up: `armenscad browse <workspace>` (the folder holding the model(s); it scans 3 levels deep, picks the next free port pair after 5180/3003 and opens the browser; run it in the background). One instance per workspace: check `lsof -iTCP:5180 -sTCP:LISTEN` and `curl 127.0.0.1:3003/api/root` first, and don't start a second on the same folder. Model URLs are http://127.0.0.1:<ui port>/<path relative to the workspace>/; give the user that URL, never the bare root. It rebuilds on save and pushes to that model's page; the build log is in its terminal output.
2. Look at your own work: screenshot the viewer with the Chrome tools, read `[viewer]` console lines. The user looks at the same page, so leave the tab open when you are done (never close it). Describe what you see before asking them to. Their markups arrive as annotations: `armenscad notes <model folder>` (next section).
3. Collisions: `armenscad check <model>/check.scad 'pose1' 'pose2'` where a pose is `'steer=30 tilt=20'`. Run at the design extremes, not just at rest. Non-zero volume is a hit; `touch` means faces coincide, which is usually intended.
4. Export: `./export.sh` in the model folder. Then `armenscad stlinfo stl/*.stl` for volume, size, watertightness and shell count. A part that should be one body but reports several shells is broken.
5. Coupon first. Before real parts, print `coupon.stl` with three values of every clearance. The user reports which one wins; write it back with `armenscad scadset <name>.scad hinge_clr=0.4` and re-export.
6. Print feedback becomes a parameter, never a magic number. `hinge_clr`, `peg_clr`, `tie_eye_clr` and friends carry a comment saying which coupon round settled them.

## Notes, references, tracing (the viewer as shared context)

The user draws on the render (Annotate on the left rail or `n`, then pen `p`, arrow `a`, label `t`, points `k`) and types a caption. Each note is saved in `<model>/annotations.json` with the camera pose and `hits`: the parts and world-mm points under the stroke. Strokes are screen-space and go stale when the geometry moves; **`hits` are the truth**, the stroke shows intent.

- "Look at the notes" / "what I drew": `armenscad notes <model folder>` lists the open ones (the folder is matched to the viewer instance serving it). For each id: `armenscad notes <model> view <id>` moves every open tab to that camera (console prints `[viewer] view seq=N applied`), screenshot it, read the caption and hits, change the .scad, then `armenscad notes <model> done <id> "what changed"`. The reply shows under the note in the Notes panel.
- Ask the user something in the viewer: `armenscad notes <model> add "question" --part hatch --xyz 10,20,3`. It appears in their list in purple.
- Layout (Shapr3D's, on CyberDOS's shell): the render fills the window; panels float at the edges (left: Parts, Notes, References; right: Parameters, Log; each folds by its header, drag an inner edge to resize); a rail of labelled entries beside each. Left rail: View / Annotate / Items, a middle group that follows what you are doing (section tools while a section is on, drawing tools in Annotate, Box / Hide / Deselect with a selection, else Box / Ghost), Section at the bottom. Right rail: Home, Views (tray), Fit, Camera (ortho), Display (tray), Settings (tray: skin, text size, keys), Parameters. A bevelled view cube top right like Shapr3D's (click a face, edge or corner to orbit there, drag to orbit, double-click for home, arrows on hover turn 90°); Shapr3D's keys `1` iso, `2`/`3` front/back, `4`/`5` top/bottom, `6`/`7` right/left, with or without ctrl; `o` ortho, `f` fit. A tool card top centre names the active tool; the title (model path) opens a model picker.
- Shading: Display on the right rail (shadows from the key light, dark edge lines on creases over 30°, a headlight fill that follows the camera; all on by default, remembered per model; `window.viewer.shading({shadows, edges, headlight})`). Turn shadows or edges off when a screenshot is about colour or when a huge mesh gets slow. Clipped-away geometry casts no shadow, so a section stays open.
- Size: the readout at the foot of the render shows the bounding box (X/Y/Z lengths) of the selected part, the selected group, or every visible part; **Box** on the left rail (`b`) draws it in the scene with the edge lengths labelled. From the Chrome tools: `window.viewer.bounds()` → `{ target, size, min, max }`, `window.viewer.box(true)`.
- Sectioning: **Section** on the left rail (or `s`) toggles a cut that remembers its plane. The first time on a model it asks for one: three origin planes show through the middle of the parts (click one), or click a part's face to cut along it with that part kept. Badges beside the gizmo (and the rail's middle group) flip the kept side, look straight at the cut, pick another plane, and square up a tilt; the Section entry shows the plane and mm, the tool card an mm field. It clips the parts and the reference ghost with one plane. Cut faces are capped in the part colour with a hatch (one line direction per part); where two parts occupy the same spot on the plane the cap is red cross-hatch, so a plan section doubles as a collision view. A gizmo sits on the plane, in the skin's axis colours (`--axis-x/y/z`: red/green/blue plain, chrome/live/signal under CyberDOS): the puck at its centre drags the gizmo across the plane (rotations happen about wherever it sits), the double arrow (the base axis's colour) slides the plane along its normal, the two arcs (coloured for the axes they turn about, standing up on the camera's side) tilt it; a label shows the mm or degrees while dragging (snap 1, alt 0.1, ctrl 15°). On a hatched face: drag slides, click moves the gizmo there (that point becomes the centre of rotation), double-click flips the kept half. A faint outline of the whole plane shows during a drag (and a filled one previews a face's plane while picking). Stencil trick, needs watertight meshes. From the Chrome tools: `window.viewer.section({on:true, axis:'Z', mm:138, flip:false, rot:[20,0], pivot:[x,y,z]})`; with `ortho(true)` + `fitView('top')` it is a plan section. Remembered per model, and localStorage is shared with the user's tab, so switch it back off when done.
- Never edit `annotations.json` by hand while the viewer runs; the server owns it (writes go through the API/CLI, outside edits are reloaded but race). `window.viewer` in the page (Chrome tools) exposes `pose()/setPose()/annotations()/setTool()/overlay`.
- Reference images go in `<model>/ref/` (downscale phone photos first: `sips -Z 2000 *.jpeg`), captioned in `ref/index.json` with a `scale` (`{"px": [[x,y],[x,y]], "mm": d}`) whenever a ruler or a known dimension is in frame. `armenscad notes <model> refs` lists them; the References panel shows them; "place as overlay" puts one in the scene as a plane.
- Tracing a profile: place the image, pick the plane (XY/XZ/YZ), `Face` (ortho, straight on), `Calibrate` (two clicks + the mm between them), `Set origin` (the image point at 0,0), flip/offset/rotate as needed. Then `k` and click along the curve, Enter. Consume with `armenscad notes <model> points <id> --scad name --2d` and paste the list into the parameter block with the note id and image in the comment. The overlay placement persists in `annotations.json` `overlays[]`, so the same photo can be re-checked against a later print.
- Photos pasted into chat vanish on `/clear`; anything worth keeping goes in `ref/` the same session.

## Reference material

- The reference is the source of truth. Numbers quoted from memory have been wrong; the files have been right. Read the file, don't ask for dimensions.
- `.shapr` (Shapr3D): `armenscad shapr_dump file.shapr` prints every sketch in mm and the history ops with their measures. Follow the history order in the .scad, one section per op.
- STEP: fillet radii (TOROIDAL_SURFACE minor radius) and face levels.
- STL from a CAD export may be several overlapping shells. Split it per shell (`ref_bodies/`) and compare with `armenscad voxcmp port.stl ref.stl`, which counts overlapping shells once (if the numbers look impossible, run it reference-vs-reference first; see lessons.md). Mesh booleans on such a file lie.
- Photos: scale off a known dimension, say so in the comment, and ask for calipers.

## Print rules that have held

- Every part gets a print pose in `print_layout.scad` with a flat face on the bed and no supports if at all possible. Ask what support material the printer has before designing a face that must be up.
- Print-in-place hinges: teardrop holes (`teardrop_2d`), clearance from `fit_hinge_clr()` in `lib/armenscad/fit.scad` (settle it with a coupon on a new printer), barrel lifted 0.6 off the adjacent edge. Hide hinges on the inside face where possible.
- Snap features that flex have failed twice; rigid features (twist lock, keyhole with a detent) held. Prefer geometry that locks over geometry that springs.

## Gotchas

- `for` inside `intersection()` unions its iterations into one child; use `intersection_for` to clip by several planes in a loop.
- Huge helper solids (half-space cubes) make `-o png` previews blank: the preview camera is sized from every primitive. Add `--render` to the PNG command to the model's `render.sh`.
- Small-angle `rotate_extrude` renders as one straight chord on this build. Use `arc_sweep()` from `armenscad/shape.scad`. Buried fillets hide it; exposed arcs collide.
- Mesh downloads (3MF, Thingiverse STL) are often several shells with bad normals: `armenscad stlshells` unions the closed ones and reports the open ones; `armenscad 3mf2stl` pulls meshes out of a Bambu 3MF.
- Synced folders (Dropbox, iCloud): the file watcher works, but confirm a rebuild happened more than 10 s after page load before trusting it.
- Scratch scripts in the session scratchpad are wiped. Anything run twice goes in the plugin's `tools/` (then it is an `armenscad` subcommand for free).
- More in `${CLAUDE_PLUGIN_ROOT}/docs/lessons.md`: handedness when placing parts, dovetail splits for iterated parts, the voxcmp and SSE pitfalls, the .shapr format, the viewer's section and shading internals.

## Session end

1. Update the model's `README.md`: state date, open items, what to print next (and the toy-level README's state table if there is one).
2. Commit in the model repo (and in the plugin repo if tooling changed).
3. Update the model's `CLAUDE.md` (project memory: decisions, rejected directions and why, what is measured vs guessed, next). It loads automatically next time anyone works in that folder.
4. A lesson about the tools or printing in general goes in the plugin's `docs/lessons.md` (and the skill if it changes the loop); a settled clearance goes in `lib/armenscad/fit.scad`. Auto-memory is only for the user's own preferences and machine.
