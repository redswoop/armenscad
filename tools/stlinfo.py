#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["numpy"]
# ///
"""Facts about an STL: triangles, bbox, volume, area, watertightness, shell count.

usage: stlinfo.py FILE.stl [FILE.stl ...] [--json]
An empty export (0 triangles, 84-byte file) is what a passing collision check looks like.
"""
import sys, json, struct
import numpy as np

def read_stl(path):
    data = open(path, "rb").read()
    if len(data) >= 84:
        n = struct.unpack("<I", data[80:84])[0]
        if len(data) == 84 + 50 * n:
            if n == 0:
                return np.zeros((0, 3, 3))
            arr = np.frombuffer(data[84:], dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]))
            return arr["v"].astype(np.float64)
    # ascii
    txt = data.decode("ascii", "ignore")
    pts = [list(map(float, l.split()[1:4])) for l in txt.splitlines() if l.strip().startswith("vertex")]
    return np.array(pts, dtype=np.float64).reshape(-1, 3, 3) if pts else np.zeros((0, 3, 3))

def info(path):
    t = read_stl(path)
    n = len(t)
    if n == 0:
        return {"file": path, "tris": 0, "volume": 0.0, "area": 0.0, "empty": True}
    a, b, c = t[:, 0], t[:, 1], t[:, 2]
    vol = float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)
    area = float(np.linalg.norm(np.cross(b - a, c - a), axis=1).sum() / 2.0)
    lo, hi = t.reshape(-1, 3).min(0), t.reshape(-1, 3).max(0)
    # merge vertices, count edges (drop zero-area triangles first: float32 export creates them)
    verts, inv = np.unique(t.reshape(-1, 3), axis=0, return_inverse=True)
    f = inv.reshape(-1, 3)
    f = f[(f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])]
    e = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    ekey = np.sort(e, axis=1)
    _, cnt = np.unique(ekey, axis=0, return_counts=True)
    watertight = bool((cnt == 2).all())
    # shells: connected components over shared vertices (label propagation)
    lab = np.arange(len(verts))
    for _ in range(10000):
        m = np.minimum(lab[e[:, 0]], lab[e[:, 1]])
        new = lab.copy()
        np.minimum.at(new, e[:, 0], m); np.minimum.at(new, e[:, 1], m)
        if (new == lab).all(): break
        lab = new
    shells = int(len(np.unique(lab)))
    return {"file": path, "tris": n, "volume": round(vol, 3), "area": round(area, 2),
            "bbox": [np.round(lo, 3).tolist(), np.round(hi, 3).tolist()], "size": np.round(hi - lo, 3).tolist(),
            "watertight": watertight, "open_edges": int((cnt != 2).sum()), "shells": shells, "empty": False}

def main():
    files = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not files:
        print(__doc__); sys.exit(1)
    res = [info(f) for f in files]
    if "--json" in sys.argv:
        print(json.dumps(res if len(res) > 1 else res[0])); return
    for r in res:
        if r["empty"]:
            print(f"{r['file']}: EMPTY (0 triangles)"); continue
        print(f"{r['file']}: {r['tris']} tris, volume {r['volume']} mm3, area {r['area']} mm2, size {r['size']} "
              f"bbox {r['bbox'][0]}..{r['bbox'][1]}, {'watertight' if r['watertight'] else str(r['open_edges']) + ' open edges'}, {r['shells']} shell(s)")

if __name__ == "__main__":
    main()
