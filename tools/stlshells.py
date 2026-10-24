#!/usr/bin/env -S uv run --script --quiet
# /// script
# dependencies = ["trimesh", "numpy", "networkx", "scipy", "manifold3d"]
# ///
"""Rebuild a downloaded STL as one watertight body: union every closed shell (manifold3d), drop the open ones.
usage: tools/stlshells.py in.stl out.stl [--min-vol MM3]   (closed shells smaller than MM3 are debris, dropped)
Mesh-soup downloads (Blender exports) carry details and even holes/pegs as separate shells, some of them open;
a slicer unions what it can and silently drops the rest. This prints what was kept and what was dropped
(bounds of each open shell) so the dropped features can be rebuilt in OpenSCAD."""
import sys, trimesh, numpy as np
args = sys.argv[1:]
min_vol = float(args[args.index('--min-vol') + 1]) if '--min-vol' in args else 0.0
args = [a for i, a in enumerate(args) if a != '--min-vol' and (i == 0 or args[i-1] != '--min-vol')]
m = trimesh.load(args[0], force='mesh')
keep, dropped, debris = [], [], []
for p in m.split(only_watertight=False):
    if p.is_watertight and not p.is_volume: trimesh.repair.fix_normals(p); trimesh.repair.fix_inversion(p)
    if p.is_volume and p.volume < min_vol: debris.append(p)
    else: (keep if p.is_volume else dropped).append(p)
sys.argv[2] = args[1]
out = trimesh.boolean.union(keep, engine='manifold') if len(keep) > 1 else keep[0]
out.export(sys.argv[2])
print(f"{sys.argv[2]}: union of {len(keep)} closed shells -> {len(out.faces)} tris, watertight {out.is_watertight}, volume {out.volume:.1f} mm3")
for p in dropped: print(f"  dropped open shell: {len(p.faces)} tris, bounds {p.bounds.round(2).tolist()}")
if debris: print(f"  dropped {len(debris)} closed debris shells under {min_vol} mm3")
