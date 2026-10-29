# Plan: joints, posing and (light) inverse kinematics (2026-10-26)

Armen's ask: "model parts moving together, around each other", the way Fusion's joints do. Nothing fancy.
Status: plan only, nothing built.

## The one idea everything hangs on

Today a pose is baked into geometry: `lid_at(lid_deg)` rotates the lid inside OpenSCAD, so every pose change is a
full rebuild (seconds) and the viewer never knows there is an axis at all. But the viewer already gets one STL per
part, so **rigid motion can be applied by the viewer, in three.js, at 60 fps**. Geometry rebuilds only when geometry
changes. The `.scad` file stays the single source of truth for *where the joints are* (the axis numbers are
derived from parameters, so they must not be copied into viewer.json by hand); it tells the viewer by `echo`.

What Fusion calls "joints" is forward kinematics plus drag. Real inverse kinematics is only the drag solver
(phase 2), and for a toy with one to three joints it is small.

## Model side: `lib/armenscad/kin.scad`

Joint tree, declared in the model, parts modelled in the assembled rest pose (joint values all zero), exactly as
hinge_box is modelled now.

```openscad
use <armenscad/kin.scad>
// ---------- joints ----------
lid_deg = 35;                              // ordinary top-level param: check.sh, scadset, the viewer all keep working
J = [
  joint("lid", parent = "box", type = "rev",   origin = axis, axis = [1, 0, 0], range = [0, 180], var = "lid_deg"),
  joint("pin", parent = "box", type = "fixed"),
];
pose = [["lid_deg", lid_deg]];             // name -> value, built from the params (helper: kin_pose(J))

module lid_at(deg) { kin_place(J, "lid", pose) lid(); }      // multmatrix(kin_matrix(J, "lid", pose))
kin_dump(J);                               // echo("ARMENSCAD_KIN", str(...)) when kin_dump_on = true
```

- `joint(name, parent, type, origin, axis, range, var)`: types `fixed`, `rev` (one angle), `slide` (one length
  along `axis`), `cyl` (angle + length, two vars), `ball` (three angles, three vars). Origin and axis are in the
  rest frame of the whole assembly, which is the only frame the model author has to think about.
- `kin_matrix(J, name, pose)`: walks parent links to the root, composes `T_parent * about(origin, axis, value)`.
  Pure OpenSCAD functions; `*` on 4x4 lists already does matrix multiplication. Nested chains (arm on turret on base)
  come free.
- `kin_place(J, name, pose)`: `multmatrix` wrapper, used by the assembly at the bottom and by `check.scad`, so the
  CLI collision table and the viewer agree on the pose by construction.
- Coupled motion (gears, a lid that drives a latch): `var` may be `["lid_deg", ratio, offset]`, linear only. Not
  more than that in v1.
- `kin_dump(J)`: when `-D kin_dump_on=true`, echoes the joint list as one JSON string. OpenSCAD's `str()` of
  nested lists of numbers and strings is JSON already.

Phase 0 is useful on its own, before the viewer knows anything: one way to write posed assemblies, and nested
chains stop being hand-written translate/rotate/translate sandwiches.

## Viewer side

**Build** (`server.js`): one extra short OpenSCAD run per build, harness `include <file>; kin_dump_on = true;`,
parse the `ECHO: "ARMENSCAD_KIN", "..."` line, put `joints` in `publicState()`. Models without `J` behave as today.
With joints, each part's `call` must be the bare module (`lid();`, not `lid_at(lid_deg)`), or it is transformed
twice; the server warns when a part's call names a `*_at` module while joints exist.

**Pose** (`parts.js`, new `kin.js`): FK in JS, `mesh.matrix` per part. Audit the places that assume parts carry no
transform: `bounds.js:42` says so explicitly; `section.js` caps and hatch; `annotate.js` ray hits (they are world mm,
fine, but see notes below); `shading.js` edges (children of the mesh, fine).

**Pose panel**: one slider per joint var with its `range`, live, no rebuild. The value is also posted as an
override, so the next rebuild and `check.sh` see the same pose. "Save pose to file" = `scadset`. Pose vars are
filtered out of the parameter panel (they are in `J`, so the server knows which they are).

**Drag to pose** (the Fusion feeling, phase 2): drag a part; the chain from the root to it is solved.
- One revolute or slide joint: exact. Project the mouse ray onto the plane normal to the axis (or onto the axis
  line) and read the angle (or distance). No solver.
- Chains: CCD (cyclic coordinate descent) over the joint vars with limits, a few hundred iterations per mouse
  move; two or three links converge instantly. Ball joints: CCD on each angle. The result lands in the sliders.
- `window.viewer.pose()/setPose({lid_deg: 90})` for Claude through the Chrome tools, and `armenscad notes <m> pose`.

**Play**: sweep one joint over its range, or a keyframe list `[{lid_deg: 0}, {lid_deg: 180}]`. Replaces any use
of `$t`.

**Notes**: a stroke's `hits` are world mm at the pose it was drawn in. Save the joint values with every note; the
list greys a note when the pose differs (same trick as the camera `ghost` state); `notes` prints the pose.

## Motion collisions (phase 3, where the print-design value is)

`check.sh` already answers "do these two parts intersect at this pose". Motion adds "over what range":
- In the browser: `three-mesh-bvh` (`intersectsGeometry` between two posed meshes) stepped over a joint's range;
  hit intervals drawn as red bands on that joint's slider. Fast enough for a few thousand triangles per part at
  5 degree steps. Approximate (mesh on mesh, no volume), so it is a hint, not the record.
- CLI, authoritative: `armenscad sweep <model>/check.scad lid_deg=0:180:15` = `check.sh` over the range, one
  column per step. A wrapper, half an hour.

## Not in scope (say so in the skill)

- Closed loops (four-bar linkages, a slider riding a slot). Tree only. A four-bar is one driven joint plus a
  scad function for the dependent angle; declare the dependent one as `fixed` with `origin` computed.
- A real constraint solver (mates, point-on-face). Fusion's assembly constraints are a different product.
- Dynamics, springs, contact.

## Phases

| Phase | Work | Size |
|---|---|---|
| 0 | `kin.scad` (joint, kin_matrix, kin_place, kin_pose, kin_dump), hinge_box converted, skill paragraph | half a day |
| 1 | server echo parse, FK in the viewer, pose panel, transform audit (bounds, section, notes) | 1-2 days |
| 2 | drag to pose (exact single joint, CCD chains), play/sweep, `window.viewer.pose`, pose saved with notes | 1-2 days |
| 3 | in-browser motion collisions with three-mesh-bvh, `armenscad sweep` | 1 day |

Order: 0, 1, 3, 2. Phase 3 before 2 because the collision bands change designs; drag is nicer but not necessary.

## Open questions for Armen

- Pose vars as plain top-level params (proposed) vs a single `pose = [...]` list. Plain params keep `check.sh`,
  `scadset` and `-D` unchanged; chosen unless he objects.
- Joint origin frame: assembled rest frame (proposed, matches how he models now) vs Fusion-style two origins
  (one on each component). Fusion's way is better for reuse of a part in several assemblies; ours is simpler.
- Does `rot`/`slide` need per-part print-pose awareness? No: `print_layout.scad` stays separate.

## Use cases (Armen, 2026-10-26) and what they change

Two jobs: (1) a toy robot whose arms and legs must clear each other and the body across their whole travel,
(2) posing it for a screenshot that impresses people.

- **Ball joints and chains are the common case, not the hinge.** Shoulders and hips are ball or two-axis joints,
  so `ball` and `cyl` are v1, not later. Each leg is a chain of three (hip, knee, ankle); FK in the viewer must handle
  depth without fuss.
- **Mirrored limbs.** `joint(..., mirror = "left_arm")` or a `mirror_x` flag so the right side is declared once.
  The parts are usually a mirror too, so this pairs with how limbs are modelled.
- **Range of motion is the deliverable, not one pose.** Phase 3's slider bands are the feature for job (1): hip
  sweep shows where the thigh hits the hip cover. Pairs for a robot are many (each limb segment vs body, segment vs
  neighbouring segment); `check.scad` should list them per joint, and the sweep runs the pairs that joint moves.
- **Named poses for screenshots.** `poses.json` in the model: `{"hero": {"l_shoulder": [20, -30, 0], ...}}`, saved
  from the panel, picked from a dropdown, set by `armenscad notes <m> pose hero`, and the camera pose saved with it so
  the screenshot is repeatable. Notes already store the camera; a named pose is camera + joints.
- **Drag to pose matters more than I weighted it.** Posing a 12-joint figure with sliders is tedious; dragging a
  hand is how you'd do it in Fusion. Keep the order 0, 1, 3, 2 but phase 2 is not optional.
- **Clearance as a number.** For screenshots looks are enough; for print the question is "how close". Phase 3 can
  report the minimum distance per pair at the current pose (three-mesh-bvh `closestPointToGeometry`), shown in the
  collision panel, so 0.3 mm vs 1.5 mm is visible without a section cut.

## Disk joints (waist, turret, head)

Kinematically a `rev`: one axis, the disk normal. No new type. Two fields on `rev` because of them:
- `steps = N`: detents. Slider and drag snap to N positions per turn; named poses land on real clicks.
- `range = "free"`: full rotation, no limits.

Keep motion and hardware apart. Joint types say how a part moves; the hardware (disk with centre peg and snap ring,
knuckle and filament pin, ball in a split socket) are library modules in `armenscad/joints.scad` with coupon-settled
clearances, a separate piece of work. A hardware module may *declare* its joint (`disk_joint(...)` returns the
`joint(...)` entry for its axis) so the two agree, but the kinematics never depends on it.

## Prior art (searched 2026-10-26)

OpenSCAD side: nothing to adopt, one thing to borrow from.
- **BrettRD/kinematics_scad**: serial chains only, `[links, axes]` where links are 4x4 matrices and axes are
  unit vectors; FK by matrix product, numeric Jacobian, gradient-descent IK for position only. A weekend project,
  no license file, no branching, no names, no ranges. Confirms FK in pure OpenSCAD functions is the obvious design;
  our `joint()` list with names and parents is a superset. Nothing to vendor.
- **BOSL2** `hinges.scad` (`knuckle_hinge`, filament pin default 1.75, `$slop`, print-in-place cones) and
  `joiners.scad` (`snap_pin`, `dovetail`, `rabbit_clip`, `hirth`): printed hardware, no motion model, no ball
  joint. Worth reading when `armenscad/joints.scad` gets written, as a reference for parameters and the
  print-in-place cone hinge. We don't depend on BOSL2 and shouldn't start for this.
- **JointSCAD** (MIT): woodworking-style joints (mortise, dovetail, finger). Not relevant.
- Ball joints: many one-off files (Gael Lafond's Universal Ball Joint, public domain, is the cleanest), no library.
  No articulated-figure library exists for OpenSCAD.

Browser side: two libraries to use.
- **three-mesh-bvh** (MIT, npm 0.9.16): `MeshBVH.intersectsGeometry(otherGeometry, geometryToBvh)` and
  `closestPointToGeometry(otherGeometry, geometryToBvh, ...)` are exactly phase 3: mesh-vs-mesh hit test and
  minimum distance between two posed parts, with the relative transform passed as a matrix. Confirmed in API.md.
- IK solvers: three.js ships `CCDIKSolver` in examples (built for MMD skinned meshes, bone-based); `three-ik` is
  FABRIK with ball constraints, flagged WIP; **gkjohnson/closed-chain-ik-js** (Apache-2.0, same author as
  three-mesh-bvh) is damped least squares over arbitrary DOF combinations, URDF-aware, and handles closed loops.
  Decision: write our own CCD for phase 2 (a tree of named joints with per-DOF limits is ~150 lines and we own the
  snapping and detent behaviour); keep closed-chain-ik-js in reserve if closed loops ever come back on the table.
