#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["trimesh", "numpy", "scipy", "networkx", "rtree"]
# ///
# usage: armenscad stlpegfix file.stl ...  -> <dir>/fixed/<name>_fixed.stl
# Loose closed shells (pegs) that only kiss the body: stretch each one toward the body so it
# embeds EMBED mm, keeping its far tip where it was. Output = body + stretched pegs, one STL.
import trimesh, sys, os, numpy as np
EMBED = 0.8
for f in sys.argv[1:]:
    m = trimesh.load(f)
    parts = sorted(m.split(only_watertight=False), key=lambda p: len(p.faces), reverse=True)
    body, out = parts[0], [parts[0]]
    for p in parts[1:]:
        if not (p.is_watertight and p.volume > 1):
            out.append(p); continue
        c = p.centroid
        near, dist, _ = trimesh.proximity.closest_point(body, [c])
        toward = (near[0] - c); toward /= np.linalg.norm(toward)
        # peg axis = longest principal direction of the shell, signed toward the body
        sv = np.linalg.svd(p.vertices - c)
        d = sv[2][0] if sv[1][0] > 1.3 * sv[1][1] else toward   # a pin: along its axis; a knob: straight at the body
        if d @ toward < 0: d = -d
        t = p.vertices @ d
        gap = -trimesh.proximity.signed_distance(body, p.sample(2000)).max()   # >0 means outside
        ext = max(gap, 0) + EMBED
        v = p.vertices + np.outer((t - t.min()) / (t.max() - t.min()), d) * ext
        q = trimesh.Trimesh(v, p.faces)
        print(os.path.basename(f), "peg vol %.1f at %s: gap %.2f -> stretched %.2f mm along %s" % (p.volume, np.round(p.bounds[0],1), gap, ext, np.round(d,2)))
        out.append(q)
    res = trimesh.util.concatenate(out)
    o = os.path.join(os.path.dirname(f), "fixed", os.path.basename(f).replace(".stl", "_fixed.stl")); os.makedirs(os.path.dirname(o), exist_ok=True)
    res.export(o); print("  ->", o)
