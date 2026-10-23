// lego.scad: the LEGO / Technic interface vocabulary, nominal moulded sizes.
//   use <../lib/lego.scad>
// Everything a printed part needs to mate with real bricks: stud pitch, pin and axle holes, the
// Technic axle cross, the Bionicle ball. Nominal numbers; a printed part adds its own clearance
// (settled with a coupon) on top of these, never inside them.
function lego_pitch()   = 8;      // stud pitch, and one Technic "L"
function lego_stud_d()  = 4.8;    // stud diameter; also fits a Technic axle hole (stud-in-axle-hole is official)
function lego_pin_d()   = 4.8;    // Technic pin shank / pin hole
function lego_pin_ctr() = 6.2;    // pin hole countersink diameter (the flare at each face)
function lego_axle_w()  = 4.8;    // Technic axle across the arms
function lego_axle_t()  = 1.8;    // Technic axle arm thickness
function lego_ball_d()  = 10.2;   // Bionicle / Technic ball joint
function lego_beam_w()  = 7.8;    // liftarm thickness

// Technic axle cross, as the 2D profile. clr is on the overall width (both sides).
// A hole for an axle is axle_2d(clr) subtracted; a printed axle is axle_2d(-clr).
module axle_2d(clr = 0) {
    w = lego_axle_w() + clr; t = lego_axle_t() + clr;
    square([w, t], center = true);
    square([t, w], center = true);
}
// Round pin hole profile (Technic pin, or a stud). clr on the diameter.
module pin_hole_2d(clr = 0) { circle(d = lego_pin_d() + clr); }
