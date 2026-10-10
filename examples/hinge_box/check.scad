// Collision checks. Each `pair` should be EMPTY.
//   pair: "box-lid" | "box-pin" | "lid-pin"
// Run: ../../tools/check.sh check.scad 'lid_deg=0' 'lid_deg=45' 'lid_deg=90' 'lid_deg=180'
include <hinge_box.scad>
show_ghost = false; show_all = false;
pair = "box-lid";

module A() {
    if (pair == "box-lid" || pair == "box-pin") box();
    if (pair == "lid-pin") lid_at(lid_deg);
}
module B() {
    if (pair == "box-lid") lid_at(lid_deg);
    if (pair == "box-pin" || pair == "lid-pin") pin();
}
intersection() { A(); B(); }
