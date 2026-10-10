# scad workbench

A workbench for designing 3D-printable parts in [OpenSCAD](https://openscad.org) together with an AI coding agent. It was built around [Claude Code](https://claude.com/claude-code), and the viewer and tools are also useful on their own.

![The viewer showing the hinge_box example with a section cut](docs/viewer.png)

OpenSCAD models are code, which an agent writes well, but neither of you can see what the other means. This repo is the shared surface:

- **`viewer/`**: a browser viewer that rebuilds every part on save. Per-part colours and groups, a parameter panel read from the `.scad` file, section cuts with hatched caps (overlapping parts show in red), bounding-box sizes, reference photos, and notes you draw on the render that the agent can read back with the parts and millimetre coordinates under each stroke.
- **`tools/`**: command-line checks the agent runs instead of eyeballing: collision tables across poses, STL facts (volume, watertightness, shell count), parameter write-back, volume comparison against a reference mesh, STL cross-sections, 3MF and Shapr3D readers.
- **`lib/`**: shared OpenSCAD modules (printable fillets, sweeps, teardrop holes, settled clearances).
- **`template/`**: the skeleton of a model folder: model, viewer manifest, print layout, collision pairs, tolerance coupon, export scripts, README.
- **`.claude/skills/openscad/`**: the playbook that tells Claude how to use all of the above.

## Requirements

- macOS or Linux. Windows is untested (the tools are bash and Python; WSL should work).
- **OpenSCAD, a development snapshot.** The 2021.01 stable release has no Manifold backend and will not work. macOS: `brew install --cask openscad@snapshot`. Linux: a nightly AppImage or package from [openscad.org/downloads](https://openscad.org/downloads.html#snapshots). It must be on `PATH` as `openscad`, or set `OPENSCAD=/path/to/openscad`.
- [Bun](https://bun.sh) for the viewer.
- Python 3 and [uv](https://docs.astral.sh/uv/) for the tools. `stlinfo.py`, `voxcmp.py` and `shapr_dump.py` are `uv run --script` files that fetch their own dependencies (numpy, msgpack); the collision check and the export scripts call `stlinfo.py`.
- Claude Code, if you want the agent side.

## Quick start

```sh
git clone https://github.com/redswoop/scad-workbench.git scad
cd scad/viewer
bun install
bun run dev
```

Open http://127.0.0.1:5180/examples/hinge_box/. Then:

- Edit `examples/hinge_box/hinge_box.scad` and save: the page rebuilds.
- Change `lid_deg` in the parameter panel and press Apply.
- Press `s` for a section cut and drag the hatched face.
- Run the collision table: `tools/check.sh examples/hinge_box/check.scad 'lid_deg=0' 'lid_deg=90' 'lid_deg=180'`

The viewer listens on localhost only. `HOST=0.0.0.0 bun run dev` opens it to your network; the API has no authentication, so do that only on a network you trust.

## Your own model

```sh
tools/new-model.sh bracket "wall bracket for the router"
```

This copies `template/` to `bracket/`, makes it its own git repo (this repo ignores model folders, so your designs stay yours), and it shows up at http://127.0.0.1:5180/bracket/. Something with several assemblies is one repo with a subfolder each: `tools/new-model.sh boat/hull`, `tools/new-model.sh boat/hatch`.

## With Claude Code

Start `claude` in the repo root so `CLAUDE.md` and the `openscad` skill load, and ask for a part. The skill has Claude keep every dimension a named parameter, look at its own work in the viewer, run the collision pairs at the design extremes, print a tolerance coupon before the real parts, and leave each model's `README.md` as a handoff for the next session. A browser tool (Claude in Chrome or similar) lets it take screenshots of the viewer and drive it through `window.viewer`.

Draw on the render (pen `p`, arrow `a`, label `t`, points `k`), type a caption, and tell Claude to look at the notes: `tools/notes <model>` gives it each note with the camera pose and the geometry under it.

## Layout

| Path | What |
|---|---|
| `viewer/` | Bun API server (`server.js`, port 3003) and Vite + three.js front end (port 5180). One server for every model. |
| `tools/` | `check.sh`, `stlinfo.py`, `scadset`, `notes`, `voxcmp.py`, `slice.sh`, `svgpts.py`, `stlshift.py`, `3mfinfo.py`, `3mf2stl.py`, `shapr_dump.py`, `new-model.sh`. Usage is in each file's header comment. |
| `lib/` | Shared modules, see `lib/README.md`. |
| `template/` | New-model skeleton. |
| `examples/` | Demo models tracked in this repo. |
| `.claude/skills/openscad/SKILL.md` | The workflow, written for the agent; a good read for humans too. |
| `docs/NOTES.md` | Design diary: how this grew and what is still on the list. |

The clearances in `lib/fit.scad` were settled on one printer (Bambu H2C, 0.4 nozzle, PLA). Treat them as starting points and print the coupon.

## Licence

GPL-3.0-or-later, see `LICENSE`. Copyright 2026 Armen Nakashian.
