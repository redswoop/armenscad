#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["numpy"]
# ///
"""Compare two STLs by volume, robust to overlapping shells (mesh booleans lie on those).

usage: voxcmp.py A.stl B.stl [--res 0.25] [--top 10] [--cells 10]

--cells C also sums each side's excess per C x C mm cell and prints the worst cells: where to look.

Casts a vertical ray down every cell of an XY grid (cell size --res), collects the
crossings of each mesh with a winding sign, and integrates the inside intervals.
"Inside" means winding depth > 0, so a body made of several overlapping closed
shells counts once. Reports vol(A), vol(B), A-B, B-A, and where the biggest
differences are (cell centres with the longest A-only / B-only intervals).
"""
import sys
import numpy as np

def read_stl(path):
    import struct
    data = open(path, "rb").read()
    n = struct.unpack("<I", data[80:84])[0]
    if len(data) == 84 + 50 * n:
        if n == 0: return np.zeros((0, 3, 3))
        arr = np.frombuffer(data[84:], dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]))
        return arr["v"].astype(np.float64)
    pts = [list(map(float, l.split()[1:4])) for l in data.decode("ascii", "ignore").splitlines() if l.strip().startswith("vertex")]
    return np.array(pts).reshape(-1, 3, 3)

def crossings(tris, x0, y0, res, nx, ny):
    """For every column hit by a triangle: (column index, z, winding sign)."""
    cols, zs, sg = [], [], []
    for a, b, c in tris:
        # bounding cells of the triangle's XY projection
        xs = (a[0], b[0], c[0]); ys = (a[1], b[1], c[1])
        i0, i1 = int(np.floor((min(xs) - x0) / res)), int(np.floor((max(xs) - x0) / res))
        j0, j1 = int(np.floor((min(ys) - y0) / res)), int(np.floor((max(ys) - y0) / res))
        i0, j0 = max(i0, 0), max(j0, 0); i1, j1 = min(i1, nx - 1), min(j1, ny - 1)
        if i1 < i0 or j1 < j0: continue
        gi, gj = np.meshgrid(np.arange(i0, i1 + 1), np.arange(j0, j1 + 1), indexing="ij")
        px = x0 + (gi.ravel() + 0.5) * res; py = y0 + (gj.ravel() + 0.5) * res
        # barycentric test in XY
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-12: continue           # vertical triangle: no column crossing
        l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / d
        l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / d
        l3 = 1 - l1 - l2
        m = (l1 >= -1e-9) & (l2 >= -1e-9) & (l3 >= -1e-9)
        if not m.any(): continue
        z = l1[m] * a[2] + l2[m] * b[2] + l3[m] * c[2]
        cols.append(gi.ravel()[m] * ny + gj.ravel()[m]); zs.append(z)
        sg.append(np.full(m.sum(), 1 if d > 0 else -1, dtype=np.int32))   # d>0: normal points +Z -> exiting on the way down
    if not cols: return np.zeros(0, int), np.zeros(0), np.zeros(0, int)
    return np.concatenate(cols), np.concatenate(zs), np.concatenate(sg)

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) < 2: print(__doc__); sys.exit(1)
    res = float(sys.argv[sys.argv.index("--res") + 1]) if "--res" in sys.argv else 0.25
    top = int(sys.argv[sys.argv.index("--top") + 1]) if "--top" in sys.argv else 8
    cells = float(sys.argv[sys.argv.index("--cells") + 1]) if "--cells" in sys.argv else 0
    A, B = read_stl(args[0]), read_stl(args[1])
    allp = np.concatenate([A.reshape(-1, 3), B.reshape(-1, 3)])
    lo, hi = allp.min(0) - res * 1.2137, allp.max(0) + res   # the odd offset keeps sample rays off round coordinates (exact edges get missed)
    nx, ny = int(np.ceil((hi[0] - lo[0]) / res)), int(np.ceil((hi[1] - lo[1]) / res))
    ca, za, sa = crossings(A, lo[0], lo[1], res, nx, ny)
    cb, zb, sb = crossings(B, lo[0], lo[1], res, nx, ny)
    col = np.concatenate([ca, cb]); z = np.concatenate([za, zb])
    da = np.concatenate([sa, np.zeros_like(sb)]); db = np.concatenate([np.zeros_like(sa), sb])
    order = np.lexsort((z, col)); col, z, da, db = col[order], z[order], da[order], db[order]
    # winding depth going UP the column: entering (normal -Z, sign -1) increases depth
    starts = np.flatnonzero(np.r_[True, col[1:] != col[:-1]]); counts = np.diff(np.r_[starts, len(col)])
    def depth(sign):                      # per column, so one missed crossing cannot leak into the columns after it
        cs = np.cumsum(-sign); return cs - np.repeat(np.r_[0, cs[starts[1:] - 1]], counts)
    inA = depth(da) > 0; inB = depth(db) > 0
    same = col[1:] == col[:-1]
    seg = np.where(same, z[1:] - z[:-1], 0.0)
    a_only = seg * (inA[:-1] & ~inB[:-1]); b_only = seg * (inB[:-1] & ~inA[:-1]); both = seg * (inA[:-1] & inB[:-1])
    cell = res * res
    vA, vB = (a_only.sum() + both.sum()) * cell, (b_only.sum() + both.sum()) * cell
    print(f"grid {nx}x{ny} @ {res} mm   A={args[0]}  B={args[1]}")
    print(f"vol A      {vA:10.2f} mm3\nvol B      {vB:10.2f} mm3\nA - B      {a_only.sum() * cell:10.2f} mm3\nB - A      {b_only.sum() * cell:10.2f} mm3\nsym diff   {(a_only.sum() + b_only.sum()) * cell:10.2f} mm3  ({100 * (a_only.sum() + b_only.sum()) / max(1e-9, (both.sum() + a_only.sum() + b_only.sum())):.2f} % of the union)")
    if cells:
        for label, arr in (("A-only", a_only), ("B-only", b_only)):
            tot = np.zeros(nx * ny); np.add.at(tot, col[:-1], arr); tot *= cell
            gi, gj = np.arange(nx * ny) // ny, np.arange(nx * ny) % ny
            cx = np.floor((lo[0] + (gi + 0.5) * res) / cells).astype(int); cy = np.floor((lo[1] + (gj + 0.5) * res) / cells).astype(int)
            key = cx * 100000 + cy; keys, inv = np.unique(key, return_inverse=True)
            csum = np.zeros(len(keys)); np.add.at(csum, inv, tot)
            order = np.argsort(-csum)[:top]
            print(f"{label} by {cells:g} mm cell (x0..x1, y0..y1, mm3):")
            for o in order:
                if csum[o] < 1: break
                kx, ky = keys[o] // 100000, keys[o] % 100000
                print(f"   x {kx * cells:6.0f}..{(kx + 1) * cells:4.0f}  y {ky * cells:6.0f}..{(ky + 1) * cells:4.0f}  {csum[o]:9.1f}")
    for label, arr in (("A-only", a_only), ("B-only", b_only)):
        # per-column totals, then the worst columns
        tot = np.zeros(nx * ny); np.add.at(tot, col[:-1], arr)
        idx = np.argsort(-tot)[:top]; idx = idx[tot[idx] > 1e-9]
        if len(idx) == 0: print(f"{label}: none"); continue
        cells = np.flatnonzero(tot > 1e-9)
        cx, cy = lo[0] + (cells // ny + 0.5) * res, lo[1] + (cells % ny + 0.5) * res
        print(f"{label}: {len(cells)} columns, XY extent x {cx.min():.1f}..{cx.max():.1f}  y {cy.min():.1f}..{cy.max():.1f}; worst columns (x, y, mm):")
        for i in idx:
            print(f"   ({lo[0] + (i // ny + 0.5) * res:7.2f}, {lo[1] + (i % ny + 0.5) * res:7.2f})  {tot[i]:.3f}")

if __name__ == "__main__":
    main()
