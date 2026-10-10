# Making the OpenSCAD workflow real

_Design diary: how the workbench grew out of one project (a toy boat's fan shroud, `whale/`). Kept as written; paths and model names are from the author's own folder._

Notes started 2026-09-09 after the WHALE shroud sessions (2026-09-07 to 09-09).
Goal: turn what we improvised for `whale/` into something we reach for on every part.

## What the whale sessions actually produced (the workflow, as it exists)

A part is a folder with a fixed set of files:

| File | Role |
|---|---|
| `<part>.scad` | Parameters at the top in `// ---- section ----` blocks, one section per design op, modules below, assembly at the bottom. Switches (`show_*`, `animate`) are top-level so harnesses can force them off. |
| `viewer.json` | Manifest for the browser viewer: which file, reference STL, switches to force off, named module calls with colours. |
| `print_layout.scad` | `-D part="..."` lays each part flat in its print pose. |
| `check.scad` | `-D pair="..."` intersects two subassemblies at a pose. Empty STL (84 bytes) = clear. |
| `compare.scad` | Volume diff against a reference export, per body group. |
| `hinge_coupon.scad` | Tolerance test print: three values of each clearance, labelled. |
| `export.sh` / `render.sh` | STLs into `stl/`, PNGs into `renders/`. |
| `README.md` | Frame, assembly order, print poses, open items, gotchas. The handoff document. |

The loop we ran, over and over:

1. Edit parameters or modules.
2. Viewer rebuilds on save (server watches the folder, SSE to the page). I screenshot it through the Chrome tools to check my own work; Armen looks at the same page.
3. Run the collision pairs at the design poses.
4. `./export.sh`, Armen prints, reports back.
5. Print feedback becomes a named tolerance parameter, never a magic number.
6. State goes to `README.md` and to memory notes.

Things that worked and should be kept as rules:

- **Reference is the source of truth.** Dimensions from memory were wrong; the `.shapr` file was right. Read the file, don't ask for numbers.
- **Empty-intersection collision checks** caught a real bug (the rotate_extrude chord) that no render would have shown.
- **Coupon first.** One 15-minute print settles clearances before the real parts go on the bed.
- **Tolerances as parameters** with the printed winner written back in.
- **README + memory at the end of each session.** Cold-start on 09-09 worked from those alone.

## What's whale-specific vs. reusable

Reusable already (just not extracted):

- `viewer/` is generic and multi-model: one server, `/<model>/` per folder with a `viewer.json`, root URL is a picker. Each model has its own watcher, cache and SSE clients, created on first visit.
- The shell scripts, apart from the part-name lists.
- The harness patterns (`check.scad`, `print_layout.scad`, `compare.scad`) are the same three files with different module names.
- A pile of generic modules buried in `shroud.scad`: `arc_sweep`, `rounded_pad`, `wall_blend`, `annulus_2d`, `pin_prism`, `teardrop_prism`, `barrel`, `stroke_2d`, `grooves_2d`, `lay_flat`, the PIP hinge trio (`hinge_root`, `hinge_fin_knuckle`, `hinge_fin_cut`), the keyhole eye, the twist-lock rib/shoe, the coupon layout.

Whale-only: the geometry, the +Y-is-bottom frame, the Shapr3D history order.

## Friction and losses

- **Scratch tools evaporated.** `voxcmp.py` (column ray-cast volume compare, needed because the reference STL is four overlapping shells), `decode.py` and `params.py` (Shapr3D history decoders) lived in the session scratchpad. They're gone. Anything we run twice belongs in the repo.
- **No git.** `scad/` is not a repository. Every experiment overwrote the previous state in place; "did we already talk about this" had to be answered from memory notes.
- **Collision runs are hand-typed loops.** Nine pairs times three steer angles times three tilts, re-typed in the shell each time, results read as byte counts.
- **The viewer sees one file.** It can't show `print_layout` poses or a `check.scad` intersection, so those are verified by CLI export and squinting at file sizes.
- **Parameter edits are string replaces.** Forty-odd python heredocs to change one number each. The viewer already has a parameter override POST; a CLI to write a parameter back to the file would close that loop.
- **Switching projects means restarting the server** with a different env var.

## Proposal: three layers

### 1. A skill: `~/.claude/skills/openscad/SKILL.md`

The playbook, so a new session starts at the level we ended at instead of re-deriving it. Contents:

- Toolchain: nightly cask, `/opt/homebrew/bin/openscad`, `--backend Manifold`, `--export-format binstl`, `--imgsize/--viewall/--autocenter/--camera` for PNGs, the rotate_extrude quirk.
- Project skeleton: the file table above and what each is for.
- The loop: viewer up, screenshot to self-check, collision pairs, export, coupon, tolerances as parameters, README at the end.
- Conventions: params at top in sections, switches at top, harness files force switches off, every clearance is a named parameter, one section per reference operation.
- Reference ingestion: `.shapr` is zip+SQLite (link to the decoder once it's back in the repo), STEP for fillet radii, STL split per shell for comparison.
- Print rules we settled on: print pose in `print_layout.scad`, no supports where a flat face can go down, coupon before parts, Bambu H2C support PLA is available when a face must be up.

### 2. A shared library + template: `scad/lib/` and `scad/template/`

- `lib/print.scad`: `lay_flat`, `teardrop_prism`, `pin_prism`, `barrel`, PIP hinge trio, `hinge_clr`-style clearance parameters as defaults, a coupon generator (`coupon(values, label)` that lays out N labelled samples).
- `lib/shape.scad`: `arc_sweep`, `rounded_pad`, `wall_blend`, `annulus_2d`, `stroke_2d`, `grooves_2d`, keyhole.
- `template/`: `part.scad`, `viewer.json`, `check.scad`, `print_layout.scad`, `export.sh`, `render.sh`, `README.md` with placeholders. New part = copy the folder.
- `tools/`: `voxcmp.py` (rewrite), `shapr_decode.py` (rewrite), `check.sh` (run every pair at every pose, print a table, exit nonzero on any non-empty), `scadset` (write a top-level parameter value back into a file).
- `git init` at `scad/`, ignore `viewer/.cache`, `viewer/node_modules`, `.dev.log`. Keep `stl/` and `renders/` tracked or not: decide. Leaning tracked for `stl/` (they're the deliverable) and ignored for `renders/`.

### 3. Viewer upgrades (only the ones that remove real friction)

- ~~Project switcher: list every folder with a `viewer.json`, pick in the UI, no restart.~~ Done (2026-09-12): URL per model, picker at `/`, dropdown in the header.
- Multiple files per manifest: a `views` list so `print_layout` poses and `check` pairs show as tabs.
- Collision panel: run the pairs from the UI, show volume per pair, red if non-zero.
- Parameter write-back: the existing override panel gets a "save to file" button that calls `scadset`.
- ~~Reference images, notes drawn on the render, tracing off a photo.~~ Done (2026-09-12), see below.

### Done 2026-09-12 (the viewer as shared context)

Armen's ask: "some kind of meta CAD", the things that make sense for interactive AI CAD. Built in one pass:
- `<model>/ref/` images served and listed (`GET /api/<m>/refs`), captions + known scales in `ref/index.json`, gallery + lightbox in the sidebar.
- Drawing on the render: SVG layer, pen/arrow/label/points tools; every stroke stores the camera pose and `hits` (part + world mm under it). Saved to `<model>/annotations.json` by the server (POST/PATCH/DELETE, atomic writes, SSE `annotations`), listed in the sidebar with done/reply, re-projected onto the geometry when the camera moves.
- Reference image as a calibrated plane (XY/XZ/YZ, mm/px from two clicks, origin click, flip/rotate/offset/opacity), ortho camera (`o`), point picking on it -> mm coordinates -> `tools/notes <m> points <id> --scad name --2d`.
- `POST /api/<m>/view` moves every tab's camera (`tools/notes <m> view <id>`), the tab reports its pose back, `window.viewer` for the Chrome tools.
- Watcher only rebuilds on `.scad` / `viewer.json` now. Client split into `api/app/scene/parts/params/annotate/refs/overlay/debug.js`.
- Not done: a screen-space (uncalibrated) photo overlay for perspective shots; occlusion of re-projected strokes; thumbnails cache.

## Order of work

1. `git init`, `.gitignore`, first commit of the current state. Ten minutes, and everything after it is recoverable.
2. Rewrite the lost tools into `scad/tools/` while the details are still in memory notes.
3. Extract `lib/` from `shroud.scad` and make `shroud.scad` include it. Verify with `compare.scad` and `export.sh` that nothing moved.
4. Write the skill from these notes.
5. Template folder.
6. Viewer switcher and check panel, when the next part needs them.

## Decisions (2026-09-09)

- **Each model is its own git repo**, everything tracked except `renders/`. STLs, the originals and `ref_bodies/` are in (about 20 MB for whale).
- **The base folder is the tooling repo**: `viewer/`, `lib/`, `tools/`, `template/`, `CLAUDE.md`, `NOTES.md`, `.claude/skills/`. Its `.gitignore` ignores everything except those paths, so a new model folder is ignored automatically.
- **The skill lives here, not globally**: `scad/.claude/skills/openscad/SKILL.md`. Claude is always started from `scad/`, and the skill points at `lib/`, `tools/` and `viewer/` in this folder. `CLAUDE.md` is the two-paragraph pointer.
- Models reach shared code with `use <../lib/….scad>` (`../../lib/` from a toy subfolder such as `whale/hatch/`). This ties a model to living inside `scad/`; acceptable.
- 2026-09-12: `whale/` and `whale_hatch/` merged into one repo, `whale/shroud/` + `whale/hatch/`. The viewer discovers `<toy>/<name>/viewer.json` one level down and names the model `toy/name`. One scad per assembly, never one file for the whole toy: every save re-renders every part in a manifest.
- Git inside Dropbox: works, but Dropbox syncs every object file. If it gets noisy, the fix is to mark `.git` folders as "ignored" in Dropbox (`xattr -w com.dropbox.ignored 1 .git`).

## Done 2026-09-09 (evening)

- `tools/`: `shapr_dump.py` (sketches in mm + history ops), `stlinfo.py` (tris, bbox, volume, watertight, shells), `voxcmp.py` (column-cast volume diff, 2 s on the shroud), `check.sh` (all pairs x poses, table, exit code), `scadset` (parameter write-back), `new-model.sh` (stamp a model from `template/`).
- `lib/shape.scad` + `lib/fit.scad` extracted from the shroud; all seven whale STLs hash-identical after the move.
- `.claude/skills/openscad/SKILL.md` written. `template/` written and proven by creating `sink_rack/` with it.
- Whale collision table: all ten pairs clear at steer 0/30/-30+tilt 20 and steer 40.

## Still open

- Is the next part the fans and spin box, or something unrelated? Decides what tests the template first.
