# lib/ shared OpenSCAD modules

Pull in with `use <../lib/shape.scad>` from a model folder. `use` (not `include`) so the
library sees no model globals: every module takes what it needs as parameters. `$fn`
still flows in from the caller.

| File | Contents |
|---|---|
| `shape.scad` | `rounded_pad(h, r, fn)`, `fillet_collar(r, fn)`, `bar_profile_2d(w, h, r)`, `frame_sweep(x, y, r, w)`, `stadium_sweep(l)` + `stadium_2d(l, w)`, `full_profile()`, `annulus_2d`, `wall_blend(R, w, z0, h, r, fn)`, `arc_sweep(a0, a1)`, `arc_pts(arc, n)`, `stroke_2d(pts, w)`, `grooves_2d(x0, x1, pitch, groove)` |
| `lego.scad` | LEGO / Technic nominal sizes as functions (`lego_pitch`, `lego_stud_d`, `lego_pin_d`, `lego_axle_w/t`, `lego_ball_d`, `lego_beam_w`), `axle_2d(clr)`, `pin_hole_2d(clr)`. Nominal only; clearances live in the model |
| `fit.scad` | `teardrop_2d(r, dir)`, `keyhole_2d(d_pin, d_big, off, throat)`; known H2C clearances as functions: `fit_pin_clr()`, `fit_hinge_clr()`, `fit_fil_clr()` |
| `psu.scad` | ATX PSU stand-in in its own frame (u across, v up from the fan face, w back from the inlet face): `psu_size()`, `psu_holes()`, `psu_fan_c()`, `psu_body()`, `psu_fan()`, `psu_rear()`, `psu_modular()`, `psu_screws(plate_t)`, `psu_zones(ac, mod, ac_off)`, `psu_all()`. Spec box 150 x 86 x 140 |
| `ff04_ring.scad` | Ring blocks of an FF04-style stacked PC case, measured off a reference model: `rrect`, `envelope(L, W, H, R, ...)` with seam rebates, `walls_2d`, `steps_2d`, `column_2d`, `column_band_2d`, `vent_slots_2d`, `front_slot_2d`, `rear_groove`, `ramp`, `slot_y`, box helpers |

Not yet extracted (still inside the model that first needed them): the print-in-place hinge
trio (`hinge_root`, `hinge_fin_knuckle`, `hinge_fin_cut`), the twist-lock rib/shoe, the
coupon layout. Port them here the first time a second model needs one.

Rule: the model's exported STLs must hash identically before and after moving a module
here. `tools/` has nothing for that yet; export to a scratch folder and `md5` both sets.
