# MODEL_NAME

State as of DATE. One line on what this is and where it goes.

## Files
| File | What |
|---|---|
| `MODEL_NAME.scad` | The model. Parameters at the top, one section per feature. |
| `viewer.json` | Part list for the browser viewer (`armenscad browse` in the workspace folder, http://127.0.0.1:5180/MODEL_NAME/). |
| `print_layout.scad` | `-D part="..."`: each part in its printing pose. |
| `check.scad` | Collision pairs; `armenscad check check.scad 'pose=..'`. Empty = clear. |
| `coupon.scad` | Tolerance test print. |
| `export.sh` / `render.sh` | STLs into `stl/`, PNGs into `renders/`. |
| `ref/` | Photos, tracings, scans; captions and known scales in `ref/index.json`. Shown in the viewer, placeable as a calibrated plane. |
| `annotations.json` | Viewer notes (strokes, arrows, labels, traced points, overlay placement). `armenscad notes .` lists and closes them. |

## Coordinate frame
Z up, part sits on z = 0. FRAME_NOTE

## Parts and how they go together
1. ...

## Design notes
- ...

## Open items
- Coupon not yet printed.

## Gotchas learned
- ...
