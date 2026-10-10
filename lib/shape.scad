// shape.scad: geometry helpers with no project globals. Pull in with
//   use <../lib/shape.scad>
// Special variables ($fn etc.) come from the caller, so set $fn in your model.

// A block standing on a surface, with the free face's edges rounded by r.
// Children: a convex 2D outline. Result spans z=0 (base, unrounded) to z=h
// (free face). Hull of the straight lower part and a minkowski-rounded slab.
// This is how you fillet in OpenSCAD: build the rounded shape, don't cut it.
module rounded_pad(h, r, fn = 24) {
    eps = 0.01;
    hull() {
        linear_extrude(h - r) children();
        translate([0, 0, h - r - eps])              // slab top at h-r, so the spheres crest at exactly h
            minkowski() {
                linear_extrude(eps) offset(r = -r) children();
                sphere(r, $fn = fn);
            }
    }
}

// A plate spanning z=0..t from a 2D outline with EVERY edge rounded by r (both
// faces): the outline shrunk by r, extruded t-2r, then minkowski'd with a
// sphere. Minkowski, not hull, so any outline works (convex or not); it is
// slower than rounded_pad, keep fn modest. Convex corners of the outline come
// out rounded by r as well; r must be under t/2.
module rounded_plate(t, r, fn = 16) {
    translate([0, 0, r]) minkowski() { linear_extrude(t - 2 * r) offset(r = -r) children(); sphere(r, $fn = fn); }
}

// 2D annulus
module annulus_2d(r_in, r_out) { difference() { circle(r_out); circle(r_in); } }

// Concave fillet collar where a block of chord width w, spanning z0..z0+h,
// meets the OUTSIDE of a cylinder wall of radius R. Local frame: the block is
// centred on +Y. Two vertical prisms (block sides) and two swept arcs (block
// top and bottom), each a square minus a circle, i.e. a quarter-round of
// material added into the corner.
// Caveat: the top/bottom sweeps are a small-angle rotate_extrude, which this
// OpenSCAD build renders as a single chord. Harmless while the fillet is
// buried against the wall; see arc_sweep() for an exposed arc.
module wall_blend(R, w, z0, h, r, fn = 24) {
    eps = 0.01;
    xc = w / 2 + r;
    yc = sqrt((R + r) * (R + r) - xc * xc);   // circle centre sits r off both faces
    for (sx = [-1, 1]) mirror([sx < 0 ? 1 : 0, 0, 0])
        translate([0, 0, z0]) linear_extrude(h)
            difference() {
                intersection() {
                    translate([w / 2, 0]) square([r + eps, R + r + 1]);
                    annulus_2d(R - eps, R + r);
                }
                translate([xc, yc]) circle(r, $fn = fn);
            }
    half_a = asin(xc / R);
    for (top = [true, false]) {
        zf = top ? z0 + h : z0;                 // the block face the fillet leans on
        zc = top ? zf + r : zf - r;             // profile circle centre
        rotate([0, 0, 90 - half_a])
            rotate_extrude(angle = 2 * half_a, $fn = 720, $fa = 0.5, $fs = 0.2)
                difference() {
                    translate([R - eps, min(zf, zc)]) square([r + eps, r]);
                    translate([R + r, zc]) circle(r, $fn = fn);
                }
    }
}

// Sweep a convex (r, z) profile along an arc about Z by hulling thin slabs, one
// per degree. Use this instead of a partial-angle rotate_extrude, which this
// OpenSCAD build (2026.09 nightly) renders as one straight chord.
module arc_sweep(a0, a1) {
    n = max(2, ceil(abs(a1 - a0)));
    for (i = [0 : n - 1]) hull() for (a = [a0 + (a1 - a0) * i / n, a0 + (a1 - a0) * (i + 1) / n])
        rotate([0, 0, a]) rotate([90, 0, 0]) linear_extrude(0.01, center = true) children();
}

// Points along a circular arc a = [start, end, centre], shortest way round.
// Drop the result into a polygon to trace a sketch outline with arcs in it.
function arc_pts(a, n = 16) =
    let (c = a[2], r = norm(a[0] - c),
         a0 = atan2(a[0][1] - c[1], a[0][0] - c[0]),
         a1 = atan2(a[1][1] - c[1], a[1][0] - c[0]),
         d  = ((a1 - a0 + 540) % 360) - 180)                 // signed sweep in (-180, 180]
    [for (i = [0 : n]) c + r * [cos(a0 + d * i / n), sin(a0 + d * i / n)]];

// 2D polyline of width w with round joints and ends
module stroke_2d(pts, w) { for (i = [0 : len(pts) - 2]) hull() { translate(pts[i]) circle(d = w); translate(pts[i + 1]) circle(d = w); } }

// Cosmetic ribbing: vertical grooves of width `groove` every `pitch` from x0
// to x1, clipped to the children's 2D outline. Subtract the result from a face.
module grooves_2d(x0, x1, pitch, groove) {
    intersection() {
        children();
        for (x = [x0 + pitch / 2 : pitch : x1]) translate([x - groove / 2, -100]) square([groove, 200]);
    }
}

// Concave fillet ring where a vertical wall (the downward extrusion of the
// child 2D outline) meets a flat face at z = 0. The ring spans z = -r .. 0 and
// reaches r outside the outline, tangent to both. Union it with the wall body.
// Made by subtracting a sphere-swept (minkowski) copy of the outline from a
// collar block, which leaves just the quarter-round of added material.
module fillet_collar(r, fn = 24) {
    eps = 0.01;
    difference() {
        translate([0, 0, -r]) linear_extrude(r + eps) offset(delta = r) children();
        translate([0, 0, -r]) minkowski() { linear_extrude(eps) offset(delta = r) children(); sphere(r, $fn = fn); }
    }
}

// Bar cross-section: a w x h rectangle with its two top corners filleted by r,
// clipped by a 45 deg chamfer tangent to the fillet. Printed top-down (the
// top face on the bed) the fillet alone overhangs at 90 deg near the bed; the
// tangent chamfer takes over where the arc is flatter than 45 deg, so the
// profile prints cleanly and still reads as a round edge. Origin at the
// bottom centre; use it in (x, z).
module bar_profile_2d(w, h, r) {
    c = r * (2 - sqrt(2));            // chamfer leg that is tangent to the arc at 45 deg
    intersection() {
        hull() { translate([-w / 2, 0]) square([w, h - r]); for (sx = [-1, 1]) translate([sx * (w / 2 - r), h - r]) circle(r); }
        polygon([[-w / 2, 0], [w / 2, 0], [w / 2, h - c], [w / 2 - c, h], [-w / 2 + c, h], [-w / 2, h - c]]);
    }
}

// Sweep a half profile (x >= 0, y up: what rotate_extrude takes) around a
// rounded rectangle: outer size x by y, outer corner radius r, profile width
// w (the half profile spans x = 0..w/2, and the path runs down its axis).
// Four straight bars plus four quarter turns, so it stays on the Manifold
// path; minkowski sweeps fall back to CGAL and take half a minute.
module frame_sweep(x, y, r, w) {
    rc = r - w / 2;                    // radius of the path at the corners
    for (m = [[0, 0], [1, 0], [0, 1], [1, 1]]) mirror([m[0], 0, 0]) mirror([0, m[1], 0]) {
        translate([x / 2 - r, y / 2 - r, 0]) rotate_extrude(angle = 90) translate([rc, 0]) full_profile() children();
        translate([x / 2 - w / 2, 0, 0]) rotate([90, 0, 0]) translate([0, 0, -(y / 2 - r)]) linear_extrude(y / 2 - r) full_profile() children();
        translate([0, y / 2 - w / 2, 0]) rotate([90, 0, 90]) linear_extrude(x / 2 - r) full_profile() children();
    }
}
// Sweep a half profile along a straight run of length l (centre to centre of
// the two round ends), each end turned through 180 deg. Centred, along X.
// stadium_2d(l, w) is the matching footprint.
module stadium_sweep(l) {
    rotate([90, 0, 90]) linear_extrude(l, center = true) full_profile() children();
    for (sx = [-1, 1]) translate([sx * l / 2, 0, 0]) rotate([0, 0, sx > 0 ? -90 : 90]) rotate_extrude(angle = 180) children();
}
module stadium_2d(l, w) { hull() for (sx = [-1, 1]) translate([sx * l / 2, 0]) circle(d = w); }
// mirror a half profile into the full cross-section
module full_profile() { children(); mirror([1, 0]) children(); }
