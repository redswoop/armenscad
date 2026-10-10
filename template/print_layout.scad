// Print layouts: each part on the bed (z = 0) in its printing pose.
//   part = "body"
include <MODEL_NAME.scad>
show_ghost = false; show_all = false;
part = "body";

if (part == "body") body();
