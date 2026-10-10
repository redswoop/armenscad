// Tolerance coupon: the hinge pin hole at three clearances, labelled, on one small print.
// Push a length of 1.75 filament through each; pick the one that turns freely without rattling
// and write it back: ../../tools/scadset hinge_box.scad pin_clr=0.15
include <hinge_box.scad>
show_ghost = false; show_all = false;

clrs = [0.10, 0.15, 0.20];     // per side
pitch = 16;
module label(t) { linear_extrude(0.6) text(t, size = 3.5, halign = "center"); }

base_t = 1.2;
translate([0, 0, knuckle_r + 2 + base_t])       // up onto the bed
for (i = [0 : len(clrs) - 1]) translate([i * pitch, 0, 0]) {
    // one knuckle, printed the way the box prints it: hole horizontal, teardrop point up
    translate([2, 0, 0]) rotate([90, 0, 90]) linear_extrude(8) difference() {
        hull() { circle(knuckle_r); translate([-knuckle_r, -knuckle_r - 2]) square([2 * knuckle_r, eps]); }
        rotate(90) teardrop_2d(pin_d / 2 + clrs[i]);
    }
    translate([0, -knuckle_r, -knuckle_r - 2 - base_t]) cube([pitch, 2 * knuckle_r + 8, base_t + eps]);
    translate([pitch / 2, knuckle_r + 2, -knuckle_r - 2 - eps]) label(str(clrs[i]));
}
