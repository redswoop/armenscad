# armenscad/ — OpenSCAD workbench plugin

This folder is the tooling repo (github.com/redswoop/armenscad, public) and a Claude Code plugin (`.claude-plugin/`, `skills/openscad/`, `bin/armenscad`), installed on this machine from a local marketplace and read in place, so edits here are live at the next session or `/reload-plugins`. Models live elsewhere (Armen's are in `../projects/`, toys grouped like `projects/gi_joe/whale/`), each its own git repo; `examples/` holds the demo models that ship with the plugin. A toy with several assemblies is one repo with one subfolder per assembly (`whale/shroud/`, `whale/hatch/`); the viewer and tools treat `toy/name` as the model name.

- `viewer/` browser viewer. `armenscad browse [DIR]` serves every model under DIR (default: the current folder, up to 3 levels deep) and opens it; the root URL lists the models, each at /<relative path>/. Ports 5180/3003 by default, the next free pair if those are busy, so one workspace per instance is fine. `lsof -iTCP:5180 -sTCP:LISTEN` shows whether one is already up here. Reads `<model>/viewer.json`. Also shows `<model>/ref/` images, lets the user draw notes on the render (saved to `<model>/annotations.json`) and trace profiles off a calibrated photo.
- `lib/armenscad/` shared OpenSCAD modules; models write `use <armenscad/shape.scad>` from any folder. Resolved via OPENSCADPATH (the viewer and `tools/` set it) or the user-library symlink made once by `tools/install-lib.sh` (also covers the OpenSCAD GUI and a model's own export.sh).
- `tools/` scripts we run more than once; each is an `armenscad <name>` subcommand (collision runner `check`, `notes` for viewer annotations, `init` for a new model, reference decoders, parameter write-back).
- `template/` skeleton for a new model folder.
- `docs/NOTES.md` workflow retrospective and roadmap; `docs/lessons.md` the general tool and print lessons (the skill points at it).

The `openscad` skill comes from the plugin (`skills/openscad/SKILL.md`), so it loads in any folder; use it for any `.scad` work. Models can live anywhere.
Each model repo has its own `CLAUDE.md` holding that project's memory (brief, decisions and rejected directions with the user's reasons, state, what to print next); Claude Code loads it when it works in that folder. `template/CLAUDE.md` seeds it. Auto-memory under `~/.claude/projects/...scad/memory/` is for workbench-wide notes only (viewer, tools, settled fits, preferences), never project detail.
When a model's design state changes, update that model's `README.md` and `CLAUDE.md` before ending the session.
