// =====================================================================
//  psu.scad — an ATX power supply stand-in with the features a case has to work around
//
//  PSU frame: u (x) across the width, from the left when you look at the REAR face; v (y) up the height,
//  v = 0 is the big FAN face; w (z) the depth, w = 0 is the REAR face (AC inlet, switch, mounting screws,
//  exhaust grille), w = depth is the FRONT face (modular sockets). Sheet-metal box, so the features are
//  recesses and holes in a solid block; nothing here is meant to print.
//
//  Spec: ATX12V rear panel 150 x 86, four 6-32 screws at (6, 80) (144, 80) (120, 6) (6, 16) from the
//  bottom-left of the rear face (three on a 138 x 64 rectangle, the fourth pulled 24 in and 10 down to
//  make room for the inlet stack). Depth 140 is the spec minimum; big units run 160-180 (MEASURE).
//  Fan, inlet, switch and modular-socket positions are typical, GUESS until the real unit is measured.
//
//  `use <psu.scad>`; psu_size(), psu_holes(), psu_fan_c() are the numbers the case needs from it.
// =====================================================================
$fn = 48;
show = true;

// ---------- box (spec) ----------
size    = [150, 86, 140];               // width (u), height (v), depth (w). Depth: MEASURE the real unit
sheet   = 1;                            // how deep the grille and fan recess read
// ---------- rear face: mounting holes (spec) ----------
hole_d  = 3.5;                          // 6-32 clearance in the case bracket; the PSU carries the thread
holes   = [[6, 80], [144, 80], [120, 6], [6, 16]];   // [u, v] on the rear face
screw_head = [7, 2.5];                  // 6-32 pan head: diameter, height (what sits proud of the bracket)
screw_in   = 6;                         // thread reach into the PSU
// ---------- rear face: inlet, switch, grille (typical) ----------
inlet   = [[108, 48], [138, 72]];       // C14 inlet flange [u, v] .. [u, v], in the inset-hole corner. GUESS
inlet_depth = 16;                       // pin cavity
switch  = [[112, 24], [134, 38]];       // rocker switch face, under the inlet. GUESS
grille  = [[8, 8], [100, 78]];          // exhaust area beside the inlet stack
grille_pitch = 6;  grille_slot = 3;     // vertical slots
// ---------- fan face (v = 0) ----------
fan_d   = 120;                          // 120 on a 140 deep unit (135 / 140 on longer ones). GUESS
fan_c   = [75, 70];                     // [u, w] centre: across the middle, half the depth back from the rear. GUESS
fan_hub = 40;
// ---------- front face (w = depth): modular sockets ----------
mod_rows  = [[14, 6, 20], [42, 6, 20]]; // [v of the row, sockets in it, pitch]
mod_u0    = 18;                         // first socket from the left
mod_sock  = [16, 11, 1.5];              // socket body across, up, proud of the face

function psu_size()  = size;
function psu_holes() = holes;
function psu_fan_c() = fan_c;

// ---------- parts ----------
module psu_body() difference() {
    cube(size);
    // rear face (w = 0): the four thread holes, the inlet cavity, the switch face, the grille
    for (h = holes) translate([h[0], h[1], -1]) cylinder(d = hole_d, h = screw_in + 1);
    translate([inlet[0][0] + 2, inlet[0][1] + 2, -1]) cube([inlet[1][0] - inlet[0][0] - 4, inlet[1][1] - inlet[0][1] - 4, inlet_depth + 1]);
    translate([switch[0][0], switch[0][1], -1]) cube([switch[1][0] - switch[0][0], switch[1][1] - switch[0][1], sheet + 1]);
    for (u = [grille[0][0] : grille_pitch : grille[1][0] - grille_slot])
        translate([u, grille[0][1], -1]) cube([grille_slot, grille[1][1] - grille[0][1], sheet + 1]);
    // fan face (v = 0): the fan opening
    translate([fan_c[0], -1, fan_c[1]]) rotate([-90, 0, 0]) cylinder(d = fan_d, h = sheet + 1);
}
// the fan itself, sitting in the opening: hub and blades, so the face reads as a fan
module psu_fan() translate([fan_c[0], 0, fan_c[1]]) rotate([-90, 0, 0]) {
    translate([0, 0, 0.5]) cylinder(d = fan_hub, h = sheet + 1);
    for (i = [0 : 6]) rotate([0, 0, i * 360 / 7]) translate([fan_hub * 0.4, -2, 0.5]) cube([fan_d / 2 - fan_hub * 0.4 - 3, 4, sheet + 1]);
}
// the inlet flange and the switch body, proud of the rear face
module psu_rear() {
    translate([inlet[0][0], inlet[0][1], -2]) difference() {
        cube([inlet[1][0] - inlet[0][0], inlet[1][1] - inlet[0][1], 2]);
        translate([2, 2, -1]) cube([inlet[1][0] - inlet[0][0] - 4, inlet[1][1] - inlet[0][1] - 4, 4]);
    }
    translate([switch[0][0], switch[0][1], -1.5]) cube([switch[1][0] - switch[0][0], (switch[1][1] - switch[0][1]) / 2 - 1, 1.5]);   // one half of the rocker stands proud
}
// modular sockets on the front face
module psu_modular() for (r = mod_rows, k = [0 : r[1] - 1])
    translate([mod_u0 + k * r[2], r[0], size[2]]) cube([mod_sock[0], mod_sock[1], mod_sock[2]]);
// the four screws as the case bracket sees them: heads proud of a plate_t bracket, threads into the PSU
module psu_screws(plate_t = 4) for (h = holes) translate([h[0], h[1], 0]) {
    translate([0, 0, -plate_t - screw_head[1]]) cylinder(d = screw_head[0], h = screw_head[1]);
    translate([0, 0, -plate_t]) cylinder(d = hole_d - 0.4, h = plate_t + screw_in);
}
// what has to stay empty around it: the AC plug + cord bend off the rear face, the modular cables off the front
module psu_zones(ac_clr = 40, mod_clr = 30, ac_off = 0) {   // ac_off: the panel the rear face sits against; the plug zone starts beyond it
    translate([inlet[0][0] - 6, inlet[0][1] - 20, -ac_off - ac_clr]) cube([inlet[1][0] - inlet[0][0] + 12, inlet[1][1] - inlet[0][1] + 24, ac_clr]);   // C14 plug body + a cord exit downward
    translate([mod_u0 - 4, mod_rows[0][0] - 4, size[2]]) cube([mod_rows[0][1] * mod_rows[0][2], mod_rows[1][0] + mod_sock[1] - mod_rows[0][0] + 8, mod_clr]);
}
module psu_all() { psu_body(); psu_fan(); psu_rear(); psu_modular(); }

if (show) { psu_all(); color("Silver") psu_screws(); %psu_zones(); }
