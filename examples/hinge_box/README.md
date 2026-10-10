# hinge_box: a small box with a hinged lid (workbench demo)

State as of 2026-10-10: modelled, collision-checked, not printed. The demo model that ships with the workbench: small enough to read in one sitting, and it uses every file a model folder has.

## Files
| File | What |
|---|---|
| `hinge_box.scad` | The model. Parameters at the top, one section per feature. |
| `viewer.json` | Part list for the browser viewer (`../../viewer`, `bun run dev`, http://127.0.0.1:5180/examples/hinge_box/). |
| `print_layout.scad` | `-D part="..."`: each part in its printing pose. |
| `check.scad` | Collision pairs; `../../tools/check.sh check.scad 'pose=..'`. Empty = clear. |
| `coupon.scad` | Tolerance test print. |
| `export.sh` / `render.sh` | STLs into `stl/`, PNGs into `renders/`. |
| `ref/` | Photos, tracings, scans; captions and known scales in `ref/index.json`. Shown in the viewer, placeable as a calibrated plane. |
| `annotations.json` | Viewer notes (strokes, arrows, labels, traced points, overlay placement). `../../tools/notes hinge_box` lists and closes them. |

## Coordinate frame
Z up, the box sits on z = 0. +Y is the back (hinge side), X runs along the hinge pin.

## Parts and how they go together
1. `box` prints as modelled, open side up. Its knuckles hang off the back wall on 45 degree gussets.
2. `lid` prints top face down (`print_layout.scad`). The knuckle radius equals the plate thickness so everything touches the bed.
3. Close the lid on the box and push a 44 mm length of 1.75 filament through the five knuckles.

## Design notes
- `lid_deg` is the pose: 0 closed, 180 folded flat behind the box. Change it in the viewer's parameter panel.
- Pin holes are teardrops (`teardrop_2d` from `lib/fit.scad`), each pointing up in its own part's print pose.
- The lid's lip locates it inside the walls with `lip_clr` per side.
- Collision table (`../../tools/check.sh check.scad 'lid_deg=0' 'lid_deg=45' 'lid_deg=90' 'lid_deg=135' 'lid_deg=180'`): all clear; box and lid touch along the rim when closed.

## Open items
- Coupon not yet printed: `pin_clr` is 0.15 from another printer (`fit_fil_clr()`); `coupon.scad` prints 0.10 / 0.15 / 0.20.
- No catch on the front: the lid stays shut by gravity.

## Gotchas learned
- A wider web between the lid plate and its knuckles dips into the back wall when the lid closes. Keep the web's root on the lid's back edge.
