# TODO: kit pipeline feedback (2026-10-24, bionicle / Hero Factory session)

Notes to fold back into the skill, lessons.md and the tools. Written at the end of the session that built the
"print kit" pipeline for Hero Factory figures (Surge 2.0, LEGO 2141).

## What got built

| Tool | State | Does |
|---|---|---|
| `stlpegfix` | committed | stretches loose peg shells 0.8 mm into the body |
| `stlremesh` | committed | Blender voxel remesh + `stlshells --min-vol`; fuses pegs sitting in zero-clearance holes |
| `kitpage` | committed | kit folder + kit.json -> coloured renders, index.html, README, `print/` (one colour-named STL per piece) |
| `kitrot` | **uncommitted** | reads object rotations out of a hand-made Bambu 3mf into kit.json (`rot`, `rot_matrix`) |
| `kit3mf` | **uncommitted** | writes a Bambu project 3mf from a kit: one plate per colour, settings copied from a template 3mf |

Test kit: `~/Library/CloudStorage/Dropbox/3D/projects/bionicle/kits/surge_2.0/` (kit.json, print/, the hand-made `print/Surge 2.0.3mf`,
the generated `bambu/surge_kit3mf.3mf`).

## 1. Orientation came out wrong: cosmetic faces on the plate

Armen opened the generated 3mf: five plates loaded fine, but chest pieces (chest plate 92201, probably torso
cover 90652 too) lie with the show face down, so the good side gets support scars.

- **Suspected bug, check first:** `kit3mf` may invert the rotations. `kitrot` stores the raw 9 numbers of the 3mf
  transform as `rot_matrix`; `kit3mf` reshapes them to `R` and writes `R.T` back out. That transpose inverts a
  rotation, so a -45 deg tilt becomes +45, which would flip the face the way he saw. Test: round-trip Surge
  (kitrot from his 3mf, kit3mf back out) and compare each item's transform with his file. They should be identical.
- **Rule for the skill, whatever the bug turns out to be:** orientation is chosen per part for the *visible* face.
  Show face up (or toward open air), supports only on the hidden side: the inside of a shell, the back of a
  chest plate, the underside of a foot. Ball sockets and pin holes must not sit on supports either.
- **Data:** kit.json should carry the orientation as Armen sets it in Bambu, imported with `kitrot` after every
  manual fix, so a correction is made once and every later kit inherits it. Same part number = same orientation
  across heroes (Breez reuses most of Surge's parts in other colours).
- **Better still:** bake the orientation into the files in `print/` so dragging the STLs into Bambu Studio is
  already right, with or without the 3mf.

## 2. The process failure (the bigger lesson)

Armen asked "can you use this 3mf as a reference for another kit". Claude spent ~12 minutes silently writing
`kitrot` + `kit3mf` before saying anything. Armen had set the 3mf up by hand in about 2 minutes.

Skill rules to add:
- Before automating something the user just did by hand, say what it would cost and offer the cheap path first.
- If a step has run 3-4 minutes with nothing to show, stop and report. Don't disappear into a tool build.
- A one-time builder is fine (Armen wants one), but agree on it first, then build it in one go.

## 3. Bambu Studio CLI findings (for a future attempt)

`/Applications/BambuStudio.app/Contents/MacOS/BambuStudio` has a real CLI (`--help`).
- `--export-settings out.json` on a 3mf works: pulls the project's full settings (583 keys).
- That file cannot be fed back with `--load-settings` ("from project unsupported"; retagging `from` gives
  "unknown config type").
- `--load-filament-ids` requires `--load-filaments` (preset jsons live in `Contents/Resources/profiles/BBL/filament/`).
- `--export-3mf` wants an absolute output path when run from another dir ("Unable to open the file ... .tmp").
- With system machine + process presets it did write a 3mf, objects got their extruder numbers, but everything
  landed on ONE plate with default settings (0.2 mm, no supports, one green filament). No per-colour plates.
- Conclusion so far: our own writer (`kit3mf`) is the working route; the CLI is useful for `--export-settings`,
  `--export-png` thumbnails and maybe `--slice` for time/material estimates later.

## 4. Smaller things worth recording

- Bambu 3mf structure that worked: `3D/3dmodel.model` (component objects + build items with transforms),
  `3D/Objects/object_N.model` (meshes), `3D/_rels/3dmodel.model.rels`, `Metadata/model_settings.config`
  (object name + extruder, `<plate>` with `plater_name`, `filament_volume_maps`, model_instance list),
  `Metadata/project_settings.config` (JSON, per-filament arrays). No thumbnails needed; Studio makes them.
- Look up LEGO set numbers, don't guess: 2.0 heroes are 2063 Stormer, 2065 Furno, 2067 Evo, 2068 Nex,
  2141 Surge, 2142 Breez. Brickset inventories give element IDs + colours (WebFetch works); Rebrickable gives
  design numbers but sits behind Cloudflare (works in Chrome after a few seconds).
- Thingiverse: Chrome lets the first "Download all files" through, then silently blocks the rest until the
  site is allowed automatic downloads.
- Google Drive zips can be listed without downloading: range-request the tail and parse the central directory
  (worth a `zipls` tool; the scratch version was lost with the session scratchpad).
- Zoingonian Forge's packs have no 5M bones (90617, 90609); every 2.0 hero needs them. A parametric bone in
  `lib/` is the obvious next model.

## 5. Update after the session: the better route (found by search)

- The `kit3mf` rotation bug is FIXED (it wrote the 3mf rotation transposed = inverted). Round-tripping Surge now
  reproduces Armen's hand-set rotations exactly. Still uncommitted, along with `kitrot`.
- Bambu Studio's CLI has `--load-assemble-list plates.json`: named plates, each with STL paths, copy count,
  filament slot per copy, optional fixed positions (`need_arrange: false` + `pos_x/y/z`). Do NOT also pass STLs
  as positional args (that is what dumped everything on one plate; mixing the two aborts).
  Reference: https://printago.io/slicer-cli/load-assemble-list
- It has no per-object rotation. So: kitpage writes `print/` STLs pre-rotated from kit.json `rot_matrix`, then
  writes the assemble-list JSON, then the Bambu CLI writes the real 3mf. That would replace `kit3mf` entirely.
- Breez 2.0 print folder was made by plain copies (pack orientations, not Surge's), Armen arranges it by hand.
