# Spec: components, instances and scenes (2026-11-14)

Status: phase 0 is built (2026-11-14, branch `components`, not yet merged or judged by Armen): `core/`, `scene.json`
without `set` or cross-folder `use`, `armenscad scene`, the scene endpoints in `viewer/server.js`; the viewer shows the
scene (one mesh per placed part, transform audit) and edits it by hand: the light-pipe gizmo on the selected instance
(move along / turn about X, Y, Z about its centre, XY on the orb; `viewer/src/move.js`, maths in `core/transform.ts`),
the Instance panel (typed at, rot, mirror, scale with its warning, colour, material, scratch, rename; `instance.js`),
duplicate / remove, and undo / redo over every scene change including outside ones, hash-checked (`history.js`).
Not in phase 0 yet: the check and export warning on a scaled instance (phase 2 brings both).
Worked out with Armen on 2026-11-14 after a few weeks of daily use.
Covers backlog items 1 and 2 in `docs/NOTES.md` (moving parts by hand, combined projects). Builds the ground
`docs/TODO-kinematics-2026-10-26.md` (joints, poses) stands on.
Revised the same day after a review pass: two layers and one language, the scratch rule, naming rules, the
check as a core operation, phase order.

## Why

- Moving, turning or copying a part by asking Claude is slow and expensive. Armen wants to do it by hand in the
  viewer.
- Saving a move by rewriting the `.scad` is the wrong cost: every save rebuilds every part, and the design source
  fills up with presentation numbers.
- Armen's idea: a layer above the `.scad`, mostly values, that refers to the parts a `.scad` offers. The `.scad`
  *exports* what may be changed from outside; everything else stays internal, so working at assembly level cannot
  quietly break other copies of the same part.

## Two layers, one language

- **Core (headless, TypeScript under Bun).** Knows what a model is. Reads `viewer.json`, the `@export` markers
  and `scene.json`; resolves a scene (instances, overrides, nested paths, scratch, errors); builds and caches
  meshes; generates the harnesses and `_scene.scad`; runs the collision check, renders and exports; is the only
  writer of `scene.json`.
- **Viewer (a client of the core).** Renders the meshes the core hands it and does scene-level operations
  (select, gizmo, typed values, hide, ghost, section, materials, undo). Every edit is a small request to the core
  ("move `knee_L`", "set `knee_L.arm_t`"), never its own file write.
- **The test for the boundary:** everything except looking and dragging works from the CLI with no viewer
  running. `armenscad scene`, `check`, `render`, `parts3mf` and Claude are other clients of the same core, so
  they cannot disagree with the viewer about what a scene is.
- **One language: JS/TS.** Anything that needs a model, a scene or a build moves into the core as its phase
  touches it (`check` first, then `parts3mf`, `scadset`, `notes`). Mesh maths uses Manifold's WASM package
  (`manifold-3d`), the kernel OpenSCAD already builds with. Pure file utilities that know nothing about models
  (`stlinfo`, the decoders) stay standalone and get ported when touched; `step2stl.py` (OpenCascade through
  Python) stays Python until something forces it.
- **Browser-only stays possible, not planned.** The core's logic does not touch the filesystem or spawn
  processes directly: "read a file" and "run a build" sit behind two small interfaces (today Bun's filesystem and
  native OpenSCAD).

### Keeping the layer thin

OpenSCAD has file inclusion, not a module system: no namespaces, no private, no parameterised import. So the
component boundary is ours, and it stays small:

- A comment marker (`@export`, `@pose`), a JSON file of values (`scene.json`), and a generator that writes
  ordinary OpenSCAD.
- **Every model still builds with stock OpenSCAD and no armenscad tools**, and anything the layer does can be
  written out as a generated `.scad` a person could have typed.
- No expressions in `scene.json`, no conditionals or loops over instances, no preprocessor, no import syntax of
  our own. If a scene needs logic, the logic belongs in a `.scad`.
- The boundary is a tooling convention: the core refuses a `set` on an unmarked value, but the OpenSCAD GUI or a
  model's own `export.sh` can still reach anything.

## Terms

| Term | Meaning |
|---|---|
| **Component** | Something reusable with an interface. A model folder (`devastator/knee`): its `.scad`, `viewer.json`, exported values. |
| **Part** | One printed piece (one STL) a component makes. The knee makes `thigh` and `connector`. |
| **Instance** | One placed copy of a component in a scene: its own position, rotation, scale, colour, material and value overrides. |
| **Scene** | The list of instances a model shows: `scene.json`. |
| **Assembly** | A component whose parts come from instances of other components (e.g. devastator's legs). |

## Two files, split by what a change costs

- **`viewer.json` = what can be built.** The `.scad` file, its parts (module calls), and for an assembly its
  re-exports. Changing it rebuilds. Edited by hand, rarely. Unchanged in shape for existing models.
- **`scene.json` = what is shown, and where.** Instances with placement, looks and value overrides. Written by the
  viewer on every drag and by Claude by hand. A change that only moves things never runs OpenSCAD; one that changes
  an instance's values rebuilds that instance only.
- **No `scene.json` = today.** The default scene is one instance of the model's own component at identity, so
  every existing model keeps working untouched.
- **A component's scene is what it contributes when used.** For an assembly the instance list, each `set` and
  the placements are the design, not presentation. Anything that is only for looking (a test variant set to one
  side) is marked `"scratch": true` and stays out of any parent that uses the component, the check and the
  export.

```json
{
  "version": 1,
  "instances": [
    { "id": "knee_L", "use": "../knee", "set": { "arm_t": 1.3 },
      "at": [16.8, 0, -66], "rot": [0, 0, 0] },
    { "id": "knee_R", "use": "../knee",
      "at": [-16.8, 0, -66], "mirror": [1, 0, 0], "color": "#c8823a", "material": "petg" },
    { "id": "thigh_test", "use": ".", "parts": ["thigh"], "set": { "arm_t": 1.1 },
      "at": [40, 0, 0], "scale": 1, "scratch": true }
  ]
}
```

- `use`: the component, as a folder relative to this one (`.` = this model). Cross-folder `use` is what makes an
  assembly (phase 3).
- `parts`: optional subset of the component's parts to show (default: all).
- `set`: overrides of the component's **exported** values. Anything else is refused with an error.
- `at` / `rot` / `scale` / `mirror`: mean exactly `translate(at) rotate(rot) mirror(mirror) scale(scale) part();`
  in OpenSCAD. A placement is a move *from where the `.scad` draws the part*, not from the origin, so parts drawn
  in their assembled position stay correct and a fresh instance sits where it always did. `rot` therefore pivots
  about the `.scad` origin and uses OpenSCAD's order (X, then Y, then Z); the gizmo turns a part about its own
  centre and folds the difference into `at`.
- A part inside an instance is addressed `instance.part` (`knee_L.thigh`); nested assemblies chain
  (`leg_L.knee.thigh`).
- **Names.** Instance ids are unique within a scene; ids and part names contain no dots (the dot is the path
  separator). No namespacing of `.scad` names is needed, because scenes compose meshes, not source: each instance
  builds in its own OpenSCAD run from a harness that includes exactly one component. **No generated file ever
  includes two components.**
- `use` stays inside the model's own git repo for now; a component in another repo would be unversioned.

## The interface: exported values

Marked in the `.scad`, so default, range and description sit beside the value:

```openscad
// ---- knee ring ----
arm_t  = 1.5;   // @export [1.0:0.1:2.0] flex-arm thickness; 1.5 printed best
ring_d = 9.6;   // internal: not reachable from a scene
lug_w  = arm_t * 2 + 0.4;
bend   = 0;     // @export @pose [0:15:135] knee angle
```

- **Marker.** `@export` in the trailing comment, then OpenSCAD Customizer's `[min:step:max]` (or `[a, b, c]` for a
  pick list), then the description. A per-line marker, not an "exported" section, because parameters are grouped
  by design operation (one `// ---- section ----` per op) and exported values are scattered across them. (Open
  question 1.) To verify: OpenSCAD's own Customizer may only read the range when the comment starts with the
  bracket; if so the form is `// [1.0:0.1:2.0] @export ...`.
- **Defaults are literals.** The default is the value in the file, readable without running OpenSCAD. A computed
  default shows its expression, plus its value after a build.
- **An override is an assignment after the include.** The viewer already builds every part through a harness
  `include <file>; <assignments>; <call>`; an instance's `set` goes into its harness. Internal values computed from
  an exported one (`lug_w`) recompute, because OpenSCAD's last assignment wins file-wide. No source is rewritten.
- **Cache key = source content (the file and what it includes) + part + override set.** Two instances with the same overrides share one build; three
  variants are three builds (render time, not edits). Today the cache is keyed by part name only
  (`viewer/server.js`, `build()`).
- **Overrides are always visible.** The panel shows each exported value against its default, a dot when
  overridden, reset per value. When the default in the `.scad` changes, instances that never overrode it follow;
  instances that did keep their value and show "default is now X".
- **Values belong to the component, not each part.** Mating parts share clearances: one `arm_t` drives both the
  thigh and the connector of *one* knee instance, so its two halves always agree, while two knee instances can
  differ.
- `armenscad scene <m>` lists instances and their overrides; `armenscad scene <m> set knee_L.arm_t 1.3` writes one.
  The same file Armen's drags write, so Claude never edits the `.scad` to try a variant.

## Assemblies and re-exports

An assembly is a folder whose `scene.json` has instances of other components. For each inner exported value it
decides one of three things:

- **Fixed:** `set` on the instance. Invisible from outside.
- **Re-exported:** shown as the assembly's own value, possibly renamed, and fanned out to several instances.
- **Left alone:** the inner default holds.

```json
// viewer.json of devastator/robot (an assembly: no "file", no "parts" of its own)
{
  "exports": {
    "leg_flex": { "to": ["leg_L.knee.arm_t", "leg_R.knee.arm_t"], "default": 1.5, "range": [1.0, 0.1, 2.0],
                  "doc": "knee flex-arm thickness, both legs" }
  },
  "reexport": { "thigh_L": "leg_L.knee.thigh", "thigh_R": "leg_R.knee.thigh" }
}
```

- `reexport` (optional) shows inner parts under the assembly's own names; without it every inner part is
  visible by its path. (Not `parts`: that key is already the list of module calls in a leaf's `viewer.json`.)
- Two re-exports cannot share an outer name; fan-out is the `to: [...]` list. Re-exports are the nearest this
  layer comes to a language of its own, so they are built last and in this form only: one outer name, a list of
  inner paths.
- Drill down: double-click an instance (or its row) opens that component's own page (`/devastator/knee/`) with the
  instance's overrides shown as a banner, the way the override banner works today. The breadcrumb walks back up.
- Builds: an assembly reuses each component's cache, so nothing re-renders as a whole toy (the
  "one scad per assembly" rule stays true). The server watches every folder an assembly uses and rebuilds only the
  instances whose component changed.
- This replaces hand-made scenes like `devastator/legs/legs.scad`, which imports everyone's meshes and rebuilds them
  all on every save.

## Repetition: where it stops

Templates (an `arm_count` that makes N arms, each with its own `finger_count`) are where CAD systems get hairy.
Fusion and Onshape draw the same line:

- **Uniform repetition stays inside the `.scad`.** `arm_count = 4` makes four identical arms in a loop. A scene
  cannot address "arm 3": generated copies have no lasting identity (change the count and which one is arm 3?).
- **Per-copy variation is a list value the component exports**, e.g. `fingers = [3, 4, 4, 5]; // @export`. The
  component decides what may vary; nobody reaches inside.
- **Per-copy identity (own position, pose, anything) means a real instance in the scene**, not a generated copy.

## Transforms and looks

- **Position, rotation** about X, Y, Z: the move gizmo (`viewer/src/gizmo.js`, the "light pipe" handle) on the
  selected instance, plus typed values in a panel. Snap: grid steps, 15° turns, alt for free.
- **Scale: allowed, flagged.** Scaling a printed part scales its clearances; non-uniform scale turns holes into
  ovals. Fine for presentation, wrong for a print. A scaled instance shows a badge; export and the collision check
  warn. For a real part, size is an exported value.
- **Mirror** is ordinary (left/right limbs), its own field so it is never mistaken for a scale.
- **Colour** per instance, carried into the Bambu 3mf (`armenscad parts3mf`).
- **Material instead of texture**: a few presets (matte PLA, PETG gloss, die-cast metal for Hook, translucent).
  Image textures need UV data STLs don't have; materials give most of the look for little cost.

## Geometry values vs pose values

- A **geometry** value (`arm_t`) changes the mesh: rebuild, seconds.
- A **pose** value (`bend`, marked `@pose`) only moves parts. Until joints exist it rebuilds like any other value;
  once the joint is declared (kinematics TODO, attach points) the viewer applies it as a transform, instantly.
- Placement (`at`, `rot`) is always instant.
- The panel shows the difference (pose values as sliders that move live, geometry values with a rebuild cue).

## Saving and undo

- **Every change saves at once** to `scene.json` (atomic write, like `annotations.json`). Undo / redo in the viewer
  (ctrl-z / shift-ctrl-z) walks the session's changes; git holds history beyond the session.
- **A content hash guards against two writers.** The core hashes `scene.json`; a write names the hash it was
  based on, and one based on an old hash is refused, so the viewer reloads and reapplies. Armen's drag and
  Claude's edit at the same moment cannot overwrite each other, a hand edit of the file is caught too, and no
  counter churns in git. Claude's edits arrive by SSE (`scene` event) and join the undo stack.
- The watcher treats `scene.json` apart from `.scad` / `viewer.json`: a change re-places, and builds only
  instances whose override set has no cached STL.

## OpenSCAD sees the scene too

The CLI side (collision check, export, renders) must test the arrangement the viewer shows, or the two drift.

- `armenscad scene <m> scad` writes `_scene.scad` (generated, gitignored): per instance,
  `translate(at) rotate(rot) mirror(m) scale(s) part();`. From phase 0, so the CLI and the viewer never show
  different arrangements.
- While a scene has one component and no overrides (phase 0) the generated file calls the modules. With overrides
  or other folders it `import()`s each instance's cached STL instead: an override is file-global, so two override
  sets cannot share one OpenSCAD file, and no generated file includes two components. Same meshes as the viewer,
  by construction.
- **The collision check is a core operation**, not a script beside it: "intersect these two instances as
  placed", from the cached meshes and transforms, volume by Manifold. `armenscad check knee_L.thigh
  knee_L.connector`, or every pair in the scene; poses are overrides (`bend=0,45,90`) through the same cache. The
  CLI prints the table, Claude calls it mid-design, the viewer can show the hit volume. No `check.scad` for the
  common case; a hand-written one stays for odd cases (a swept volume).

## What changes

Core (new, lifted out of `viewer/server.js`): the build (`build()`), per-instance harness and cache key, scene
resolution and validation, the `scene.json` write and hash check. `server.js` shrinks to HTTP, SSE and file
watching around it.

Viewer: every module that assumes a part sits where the `.scad` put it, with one mesh per part name:
- `parts.js`: meshes keyed by `instance.part`, not part name; one STL loaded once and shared by instances with the
  same build; selection, hide and ghost per instance; the part list grouped by instance.
- `bounds.js` (says outright that parts carry no transform), `section.js` (caps, hatch, stencil), `shading.js`
  (edge lines, children of the mesh: probably fine), `annotate.js` (hits are world mm: store the instance and its
  local point, so a note follows a moved part).
- `params.js`: the selected instance's exported values, default vs override; internal values only on the
  component's own page.
- Mirror is a negative scale in three.js and flips the winding: section caps, the stencil and edge lines need
  checking under it.
- `server.js`: `scene.json` watch, SSE, POST/PATCH passed to the core, like annotations.

## Phases

| Phase | Work |
|---|---|
| 0 | Core module with `build()` lifted out of `server.js`. Instances of the model's own parts in `scene.json`: copies, move gizmo + typed values, mirror, scale badge, colour, materials, scratch, undo, hash check. `_scene.scad` in its module-call form. Viewer transform audit (list above). No overrides, no other folders. |
| 1 | `@export` / `@pose` parsing, per-instance overrides, cache by override set, panel default vs override, `armenscad scene` CLI. |
| 2 | `_scene.scad` by STL import; the check as a core operation (Manifold); render / export read the scene; scale warnings. |
| 3 | Assemblies: `use` across folders, cross-folder watch, drill down and back; re-exports last. First real use: devastator (see question 3). |
| 4 | Joints and named poses: `docs/TODO-kinematics-2026-10-26.md`, with attach points echoed from each `.scad` and joints joined in the assembly (decided 2026-11-14). |

## Not in scope

- Addressing generated copies inside a component (see Repetition).
- Constraints between instances other than joints (mates, point-on-face): a different product.
- Image textures.
- Rewriting the `.scad` from the viewer, beyond the existing Parameters save.

## Open questions for Armen

1. **Marker:** per-line `@export` in the comment (proposed, because sections follow design operations), or an
   `// ---- exported ----` section?
2. **Models with nothing marked:** everything counts as exported (today's behaviour, and the parameter panel keeps
   working as is), or nothing until marked? Proposed: everything, until the first `@export` appears in the file,
   then only those.
3. **First test case:** devastator, with `knee/` as the first component and the legs as the first assembly of
   instances, replacing `legs/legs.scad`?
4. **Folder for an assembly:** a new folder (`devastator/robot/`) with only `viewer.json` + `scene.json`, or allow a
   model folder to carry both its own `.scad` parts and instances of others?
5. **Reference meshes:** half of `legs/viewer.json` is the original toys (`hook_toy`, `scrapper_toy`). Replacing
   `legs.scad` needs a component that is only a mesh, with no values. A `viewer.json` naming an STL instead of a
   `.scad`?

Claude's recommendations from the review (not decided): 1 per line; 2 everything counts as exported until the
file opts in with one explicit line (`// @exports-only`), not on the first `@export`, which would silently turn
other scenes' overrides into errors; 3 the knee, but as two instances with different `arm_t` in a small new
assembly before touching `legs.scad`; 4 allow both in one folder, since the scratch rule covers it.
