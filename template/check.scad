// Collision checks. Each `pair` should be EMPTY.
//   pair: "body-body"
// Run: armenscad check check.scad 'pose=0' 'pose=30'
include <MODEL_NAME.scad>
show_ghost = false; show_all = false;
pair = "body-body";
pose = 0;

module A() { if (pair == "body-body") body(); }
module B() { if (pair == "body-body") translate([size_x + 1, 0, 0]) body(); }
intersection() { A(); B(); }
