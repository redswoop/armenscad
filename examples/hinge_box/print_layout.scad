// Print layouts: each part on the bed (z = 0) in its printing pose.
//   part = "box" | "lid"
include <hinge_box.scad>
show_ghost = false; show_all = false;
part = "box";

if (part == "box") box();
if (part == "lid") translate([0, 0, size_z + lid_t]) rotate([180, 0, 0]) lid();   // top face down
