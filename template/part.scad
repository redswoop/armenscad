// =====================================================================
//  MODEL_NAME
//
//  Units mm. Frame: FRAME_NOTE (e.g. Z up, part sits on z = 0, +Y = back).
//  Parameters first, one section per feature; modules below; assembly last.
// =====================================================================

// ---------- switches ----------
show_ghost = false;    // overlay a reference STL, if there is one
show_all   = true;

// ---------- overall ----------
size_x = 100;
size_y = 60;
size_z = 20;
wall   = 2;

// ---------- fits (settle these with the coupon) ----------
clr = 0.2;             // general clearance per side

$fn = 96;
eps = 0.01;

use <../lib/shape.scad>   // rounded_pad, annulus_2d, wall_blend, arc_sweep, arc_pts, stroke_2d, grooves_2d
use <../lib/fit.scad>     // teardrop_2d, keyhole_2d

// =====================================================================
//  parts
// =====================================================================
module body() {
    difference() {
        cube([size_x, size_y, size_z]);
        translate([wall, wall, wall]) cube([size_x - 2 * wall, size_y - 2 * wall, size_z]);
    }
}

// =====================================================================
//  assembly
// =====================================================================
if (show_ghost) %import("reference.stl");
if (show_all) color("SteelBlue") body();
