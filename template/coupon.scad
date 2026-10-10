// Tolerance coupon: three values of each clearance, labelled, on one small print.
include <MODEL_NAME.scad>
show_ghost = false; show_all = false;

clrs = [0.15, 0.2, 0.3];
module label(t) { linear_extrude(0.6) text(t, size = 3, halign = "center"); }

for (i = [0 : len(clrs) - 1]) translate([i * 20, 0, 0]) {
    // sample: a 6 mm peg hole with clearance clrs[i] and a loose 6 mm peg beside it
    difference() { cube([14, 14, 4]); translate([7, 7, -1]) cylinder(d = 6 + 2 * clrs[i], h = 6); }
    translate([7, 15, 0]) label(str(clrs[i]));
}
translate([-12, 0, 0]) cylinder(d = 6, h = 8);   // the loose peg
