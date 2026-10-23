#!/usr/bin/env python3
"""Extract the meshes of a .3mf (one STL per mesh object, in the object's own frame, mm).
usage: tools/3mf2stl.py file.3mf outdir      writes outdir/<stem>_<objectid>.stl and prints bounds"""
import sys, zipfile, re, struct, os
f, outdir = sys.argv[1], sys.argv[2]
os.makedirs(outdir, exist_ok=True)
z = zipfile.ZipFile(f); stem = os.path.splitext(os.path.basename(f))[0]
for n in z.namelist():
    if not n.endswith('.model'): continue
    x = z.read(n).decode('utf-8', 'ignore')
    for m in re.finditer(r'<object id="(\d+)"[^>]*>\s*<mesh>(.*?)</mesh>', x, re.S):
        oid, body = m.group(1), m.group(2)
        vs = [tuple(map(float, v)) for v in re.findall(r'<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"', body)]
        ts = [tuple(map(int, t)) for t in re.findall(r'<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"', body)]
        if not ts: continue
        out = os.path.join(outdir, f"{stem}_{oid}.stl")
        with open(out, 'wb') as o:
            o.write(b'\0' * 80); o.write(struct.pack('<I', len(ts)))
            for a, b, c in ts:
                o.write(struct.pack('<3f', 0, 0, 0))
                for v in (vs[a], vs[b], vs[c]): o.write(struct.pack('<3f', *v))
                o.write(b'\0\0')
        lo = [min(v[i] for v in vs) for i in range(3)]; hi = [max(v[i] for v in vs) for i in range(3)]
        print(f"{out}: {len(ts)} tris  x {lo[0]:.2f}..{hi[0]:.2f}  y {lo[1]:.2f}..{hi[1]:.2f}  z {lo[2]:.2f}..{hi[2]:.2f}")
