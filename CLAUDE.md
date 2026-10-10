# scad/ — OpenSCAD workbench

This folder is the tooling repo. Each model (e.g. `sink_rack/`) is a separate git repo nested here and ignored by this one; `examples/` holds the demo models that ship with it. A toy with several assemblies is one repo with one subfolder per assembly (`whale/shroud/`, `whale/hatch/`); the viewer and tools treat `toy/name` as the model name.

- `viewer/` browser viewer, one server for every model: `cd viewer && bun run dev` (once; it may already be running), then open http://127.0.0.1:5180/<model>/ or /<toy>/<model>/ (API :3003). Root URL lists the models. Reads `<model>/viewer.json`. Also shows `<model>/ref/` images, lets the user draw notes on the render (saved to `<model>/annotations.json`) and trace profiles off a calibrated photo.
- `lib/` shared OpenSCAD modules; models use `use <../lib/….scad>` (`../../lib/` from a toy subfolder).
- `tools/` scripts we run more than once (collision runner, reference decoders, parameter write-back, `notes` for viewer annotations).
- `template/` skeleton for a new model folder.
- `docs/NOTES.md` workflow retrospective and roadmap.

Start Claude from this folder so the `openscad` skill in `.claude/skills/` loads. Use it for any `.scad` work.
When a model's design state changes, update that model's `README.md` before ending the session.
