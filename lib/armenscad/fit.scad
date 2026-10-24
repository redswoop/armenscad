// fit.scad: features for printed fits (holes that print without support, snaps), and the
// clearances we KNOW for one printer: a Bambu H2C, 0.4 nozzle, Bambu PLA Matte, 0.2 layers.
// Treat them as starting points and re-settle each with a coupon on your own printer.
//   use <armenscad/fit.scad>
// `use` imports functions and modules only, so the known numbers are functions:
//   pin_clr = fit_pin_clr();

// ---------- known clearances (H2C, 0.4 nozzle, PLA Matte) ----------
// Each one names the coupon that settled it. Add a line here rather than a magic number in a model.
// Turning fits all landed on 0.15 PER SIDE, whatever the pin:
function fit_pin_clr()   = 0.3;   // ON THE DIAMETER (0.15 per side): a 2.6 pin printed lying on the bed,
                                  // turning in a hole printed vertically through a flat plate. Free turning
                                  // fit, no slop. whale/hatch coupon, 2026-09-13 (+0.3 / 0.4 / 0.5 tried).
function fit_hinge_clr() = 0.15;  // PER SIDE: print-in-place hinge, 1.4 printed pin in a teardrop hole.
                                  // whale/shroud, 2026-09-11 (0.4 printed too loose, 0.15 from the
                                  // tolerance tests).
function fit_fil_clr()   = 0.15;  // PER SIDE: 1.75 filament as a hinge pin in a teardrop hole (2.05 hole).
                                  // whale/shroud filament coupon, 2026-09-12 (0.10 / 0.15 / 0.20 tried).
// Dovetail slide (one-sided, rail printed flat, groove printed as a vertical slot): NOT settled.
// A 1.2 mm rail at 0.1 / 0.15 / 0.25 per face was far too loose (whale/hatch, 2026-09-13);
// round 2 is a 2.5 mm rail at -0.1 / 0 / 0.1.

// Teardrop hole profile: a circle of radius r with a 45 deg point on the side
// that faces UP while printing (dir = +1 for +x, -1 for -x), so the roof of the
// hole bridges itself. A pin turns on the circular part. Extrude along the axis.
// (A diamond pin in a diamond hole was the first attempt: it cannot rotate.)
module teardrop_2d(r, dir = 1) {
    eps = 0.01;
    hull() { circle(r); translate([dir * (r * sqrt(2) - eps), 0]) square(eps, center = true); }
}

// Keyhole for a bulb-ended pin: the bulb passes through the big hole (d_big),
// the part slides so the pin's shank sits in the working hole (d_pin) at the
// origin, clicking through a throat that is `throat` wide (a little under the
// shank diameter for a detent). The big hole sits `off` in -y.
module keyhole_2d(d_pin, d_big, off, throat) {
    circle(d = d_pin);
    translate([0, -off]) circle(d = d_big);
    translate([-throat / 2, -off]) square([throat, off]);
}
