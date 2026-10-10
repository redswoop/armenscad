// =====================================================================
//  ring.scad — shared building blocks for the FF04 rings (body1.scad, body.scad, ...)
//  `use <ring.scad>`: modules only, every dimension is an argument. Frame per ring: x 0..L depth
//  (x = 0 is the FRONT), y 0..W width (the I/O column at y 0..82), z up from the ring's bottom.
// =====================================================================

// ---------- 2D / placement helpers ----------
function sz(b) = [b[1][0] - b[0][0], b[1][1] - b[0][1]];      // size of a [[x0,y0],[x1,y1]] box
module box2(b) translate(b[0]) square(sz(b));
module rrect(s, r) hull() for (x = [r, s[0] - r], y = [r, s[1] - r]) translate([x, y]) circle(r);
module rrect_at(p0, p1, r) translate(p0) rrect(p1 - p0, r);
module hole(p, z0, z1, d) translate([p[0], p[1], z0]) cylinder(d = d, h = z1 - z0);
module box3(b, z0, z1) translate([b[0][0], b[0][1], z0]) cube([sz(b)[0], sz(b)[1], z1 - z0]);
// a 2D shape drawn in (x, z) becomes a solid from y0 to y1: rotate([90,0,0]) turns 2D y into z and extrudes toward -y
module along_y(y0, y1) translate([0, y1, 0]) rotate([90, 0, 0]) linear_extrude(y1 - y0) children();
// a 2D shape drawn in (y, z) becomes a solid from x0 to x1
module along_x(x0, x1) translate([x0, 0, 0]) rotate([90, 0, 90]) linear_extrude(x1 - x0) children();
module slot_y(x0, x1, z0, z1, r, y0, y1) along_y(y0, y1) rrect_at([x0, z0], [x1, z1], r);
// 45 deg ramp: hull of a thin slab (box b0 at z0) and a prism (box b1 from z1 up to H)
module ramp(b0, z0, b1, z1, H) hull() { box3(b0, z0, z0 + 0.01); box3(b1, z1, H); }

// ---------- outer skin: rounded plan, optional 1 mm seam rebates at either end ----------
module envelope(L, W, H, R, lip = 1, lip_h = 4, lip_ch = 1, rebate_top = true, rebate_bottom = false, fn = 128) {
    $fn = fn;
    zb = rebate_bottom ? lip_h + lip_ch : 0;
    zt = rebate_top ? H - lip_h - lip_ch : H;
    translate([0, 0, zb]) linear_extrude(zt - zb) rrect([L, W], R);
    if (rebate_top) {
        hull() { translate([0, 0, zt]) linear_extrude(0.01) rrect([L, W], R);
                 translate([0, 0, H - lip_h]) linear_extrude(0.01) offset(-lip) rrect([L, W], R); }
        translate([0, 0, H - lip_h]) linear_extrude(lip_h) offset(-lip) rrect([L, W], R);
    }
    if (rebate_bottom) {
        linear_extrude(lip_h) offset(-lip) rrect([L, W], R);
        hull() { translate([0, 0, lip_h]) linear_extrude(0.01) offset(-lip) rrect([L, W], R);
                 translate([0, 0, zb]) linear_extrude(0.01) rrect([L, W], R); }
    }
}

// ---------- plan pieces ----------
// stair-step fills in the closed inner corners (two steps, a x b, instead of a fillet); corners as [cx, cy] in 0/1
module steps_2d(L, W, wall, corners = [[1, 0], [1, 1], [0, 0]], s1 = 15, s2 = 10) for (c = corners) {
    cx = c[0] * L; cy = c[1] * W; sx = c[0] ? -1 : 1; sy = c[1] ? -1 : 1;
    polygon([[cx + sx * wall, cy + sy * wall], [cx + sx * s1, cy + sy * wall], [cx + sx * s1, cy + sy * s2],
             [cx + sx * s2, cy + sy * s2], [cx + sx * s2, cy + sy * s1], [cx + sx * wall, cy + sy * s1]]);
}
// the three walls every ring has: y = 0 (full depth), rear, +Y from x = wY_x0
module walls_2d(L, W, wall, wY_x0) {
    square([L, wall]);
    translate([L - wall, 0]) square([wall, W]);
    translate([wY_x0, W - wall]) square([L - wY_x0, wall]);
}
// the post's outer corner at (0, post_y1) is a radius
module post_corner_cut_2d(post_y1, r) difference() { translate([0, post_y1 - r]) square(r); translate([r, post_y1 - r]) circle(r); }
// front-I/O column: front wall y 0..post_y1 (the slot between column and post is cut later), jamb block under the
// slot, the post's filler and back block with R r_in corners on its x = 17 side
module column_2d(wall, post_y1 = 82, jamb = [[4, 47], [10, 56]], post_mid = [[4, 69], [10, 82]],
                 post_bk = [[10, 72], [17, 82]], r_out = 3, r_in = 2.5) difference() {
    union() {
        square([wall, post_y1]);
        box2(jamb);
        box2(post_mid);
        hull() {
            translate(post_bk[0]) square([0.01, sz(post_bk)[1]]);
            for (y = [post_bk[0][1] + r_in, post_bk[1][1] - r_in]) translate([post_bk[1][0] - r_in, y]) circle(r_in);
        }
    }
    post_corner_cut_2d(post_y1, r_out);
}
// a band plan at the column: depth x 0..d over y 0..post_y1, plus the post's back block, with the corner radii
module column_band_2d(d, post_y1 = 82, post_bk = [[10, 72], [17, 82]], r_out = 3, r_in = 2.5) difference() {
    union() {
        square([d, post_y1]);
        if (d >= post_bk[1][0]) translate([d - r_in, post_y1 - r_in]) square([r_in, r_in]);   // (kept square, rounded below)
        hull() { translate(post_bk[0]) square([0.01, sz(post_bk)[1]]);
                 for (y = [post_bk[0][1] + r_in, post_bk[1][1] - r_in]) translate([post_bk[1][0] - r_in, y]) circle(r_in); }
    }
    post_corner_cut_2d(post_y1, r_out);
    if (d >= post_bk[1][0]) difference() { translate([d - r_in, post_y1 - r_in]) square([r_in + 1, r_in + 1]); translate([d - r_in, post_y1 - r_in]) circle(r_in); }
}

// ---------- vents: columns of rounded slots in a wall, drawn in (u, z) ----------
// cols = [[u, phase], ...]; phase 0: full slots from z0 up; phase 1: shifted half a pitch (half slots at both ends).
// rows full slots fit between z0 and z1, so pitch = (z1 - z0 - rows*l) / (rows - 1) + l.
module vent_slots_2d(cols, z0, z1, rows, w = 6, l = 27, r = 2) {
    pitch = (z1 - z0 - rows * l) / (rows - 1) + l;
    for (c = cols, k = [-1 : rows]) {
        za = max(z0, z0 - c[1] * pitch / 2 + k * pitch);
        zb = min(z1, z0 - c[1] * pitch / 2 + k * pitch + l);
        if (zb - za > 2 * r + 0.01) rrect_at([c[0], za], [c[0] + w, zb], r);
    }
}
// the I/O strip window in the column's front wall, drawn in (y, z): R r bottom corners, a chevron top
module front_slot_2d(y0, y1, z0, z1, r = 3, peak = 3, apex = [61, 61]) {
    hull() for (y = [y0 + r, y1 - r]) translate([y, z0 + r]) circle(r);
    translate([y0, z0 + r]) square([y1 - y0, z1 - peak - z0 - r]);
    polygon([[y0, z1 - peak], [y1, z1 - peak], [apex[1], z1], [apex[0], z1]]);
}
// full-height V groove in the rear face (x = L): w wide at the bottom, d deep, 45 deg sides
module rear_groove(L, y, w, d, H) translate([0, 0, -1]) linear_extrude(H + 2)
    polygon([[L - d, y - w / 2], [L - d, y + w / 2], [L + 1, y + w / 2 + d + 1], [L + 1, y - w / 2 - d - 1]]);
