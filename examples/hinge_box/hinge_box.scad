// =====================================================================
//  hinge_box: a small box with a hinged lid (the workbench demo model)
//
//  Units mm. Frame: Z up, the box sits on z = 0, +Y = back (the hinge side), X runs along the hinge.
//  Box and lid print separately, no supports; a length of 1.75 filament is the hinge pin.
//  Parameters first, one section per feature; modules below; assembly last.
// =====================================================================

// ---------- switches ----------
show_ghost = false;    // overlay a reference STL, if there is one
show_all   = true;

// ---------- pose ----------
lid_deg = 35;          // 0 = closed, 180 = folded flat behind the box

// ---------- box ----------
size_x   = 60;
size_y   = 40;
size_z   = 22;         // outside height of the box, without the lid
wall     = 2;
floor_t  = 1.6;
corner_r = 4;          // outside corner radius, seen from above

// ---------- lid ----------
lid_t = 3;             // plate thickness; also the knuckle radius, so the lid prints flat, top face down
lip_h = 1.6;           // locating lip under the lid, drops inside the walls
lip_w = 1.2;
lip_clr = 0.3;         // lip to wall, per side

// ---------- hinge ----------
hinge_inset = 8;       // from each end of the box to the first knuckle
knuckles    = 5;       // odd: the box gets the two ends, the lid the ones between
knuckle_gap = 0.4;     // along the pin, between neighbouring knuckles
hinge_gap   = 0.4;     // knuckle to the back wall
pin_d       = 1.75;    // filament

// ---------- fits (settle these with the coupon) ----------
use <armenscad/fit.scad>     // teardrop_2d, fit_fil_clr
pin_clr = fit_fil_clr();     // per side, pin in its hole. 0.15 on a Bambu H2C; coupon.scad prints 0.10 / 0.15 / 0.20

// ---------- derived (not for editing) ----------
$fn = 96;
eps = 0.01;
knuckle_r = lid_t;
hinge_off = knuckle_r + hinge_gap;               // hinge axis behind the back wall
hinge_len = size_x - 2 * hinge_inset;
seg       = hinge_len / knuckles;
axis      = [hinge_inset, size_y + hinge_off, size_z];   // start of the pin; the axis runs +X from here

// =====================================================================
//  helpers
// =====================================================================
module rrect_2d(x, y, r) { translate([r, r]) offset(r) square([x - 2 * r, y - 2 * r]); }

// A 2D profile drawn in the hinge's own section plane (2D x = world y, 2D y = world z, origin on the
// axis), extruded along the pin for every knuckle that belongs to `side` (0 = box, 1 = lid).
module knuckle_run(side) {
    translate(axis) for (i = [0 : knuckles - 1]) if (i % 2 == side)
        translate([i * seg + knuckle_gap / 2, 0, 0])
            rotate([90, 0, 90]) linear_extrude(seg - knuckle_gap) children();
}

// Pin hole: a teardrop, point towards `up` (degrees in the section plane) so its roof prints unsupported.
module pin_hole_2d(up) { rotate(up) teardrop_2d(pin_d / 2 + pin_clr); }

// =====================================================================
//  parts
// =====================================================================
// Prints as modelled. The web under each knuckle is a 45 degree gusset off the back wall.
module box() {
    difference() {
        linear_extrude(size_z) rrect_2d(size_x, size_y, corner_r);
        translate([wall, wall, floor_t])
            linear_extrude(size_z) rrect_2d(size_x - 2 * wall, size_y - 2 * wall, max(corner_r - wall, 0.5));
    }
    knuckle_run(0) difference() {
        hull() { circle(knuckle_r); translate([-hinge_off - eps, -3 * knuckle_r]) square([eps, 2 * knuckle_r]); }
        pin_hole_2d(90);                       // box prints upright: up is +z
    }
}

// Modelled closed, in the box's frame. Prints top face down: the knuckle radius equals the plate
// thickness, so plate, web and knuckle all touch the bed.
module lid() {
    translate([0, 0, size_z]) linear_extrude(lid_t) rrect_2d(size_x, size_y, corner_r);
    translate([wall + lip_clr, wall + lip_clr, size_z - lip_h]) linear_extrude(lip_h + eps) {
        ix = size_x - 2 * (wall + lip_clr); iy = size_y - 2 * (wall + lip_clr); ir = max(corner_r - wall - lip_clr, 0.5);
        difference() {
            rrect_2d(ix, iy, ir);
            translate([lip_w, lip_w]) rrect_2d(ix - 2 * lip_w, iy - 2 * lip_w, max(ir - lip_w, 0.3));
        }
    }
    knuckle_run(1) difference() {
        hull() { circle(knuckle_r); translate([-hinge_off - eps, 0]) square([eps, lid_t]); }
        pin_hole_2d(-90);                      // lid prints top down: up is -z
    }
}

// The lid swung open by `deg` about the hinge axis.
module lid_at(deg) {
    translate([0, axis.y, axis.z]) rotate([-deg, 0, 0]) translate([0, -axis.y, -axis.z]) lid();
}

// Not printed: a cut length of filament.
module pin() { translate(axis) rotate([0, 90, 0]) cylinder(d = pin_d, h = hinge_len, $fn = 24); }

// =====================================================================
//  assembly
// =====================================================================
if (show_ghost) %import("reference.stl");
if (show_all) {
    color("SteelBlue") box();
    color("Goldenrod") lid_at(lid_deg);
    color("Crimson") pin();
}
