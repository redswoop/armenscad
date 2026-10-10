#!/usr/bin/env python3
"""Export build items of a 3MF to binary STL, transforms applied (plate positions kept).
usage: tools/3mf2stl.py file.3mf 'name-regex' out_dir     -> out_dir/<name>.stl per matching item
       add --merge out.stl to write every match into one file"""
import sys, re, zipfile, struct, os, xml.etree.ElementTree as ET
NS = {'m': 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02',
      'p': 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06'}
def mat(s):
    v = [float(x) for x in s.split()]
    return [[v[0], v[3], v[6], v[9]], [v[1], v[4], v[7], v[10]], [v[2], v[5], v[8], v[11]]]
def mul(a, b):
    return [[sum(a[i][k]*b[k][j] for k in range(3)) + (a[i][3] if j == 3 else 0) for j in range(4)] for i in range(3)]
def app(m, p): return [m[i][0]*p[0]+m[i][1]*p[1]+m[i][2]*p[2]+m[i][3] for i in range(3)]
I = [[1,0,0,0],[0,1,0,0],[0,0,1,0]]
models = {}
def load(z, path):
    if path not in models:
        root = ET.fromstring(z.read(path)); objs = {}
        for o in root.iter('{%s}object' % NS['m']):
            mesh = o.find('m:mesh', NS)
            if mesh is not None:
                vs = [(float(v.get('x')), float(v.get('y')), float(v.get('z'))) for v in mesh.find('m:vertices', NS)]
                ts = [(int(t.get('v1')), int(t.get('v2')), int(t.get('v3'))) for t in mesh.find('m:triangles', NS)]
                objs[o.get('id')] = (o.get('name') or '', vs, ts, [])
            else:
                comps = [((c.get('{%s}path' % NS['p']) or path).lstrip('/'), c.get('objectid'), mat(c.get('transform')) if c.get('transform') else I)
                         for c in o.findall('m:components/m:component', NS)]
                objs[o.get('id')] = (o.get('name') or '', [], [], comps)
        build = [(it.get('objectid'), mat(it.get('transform')) if it.get('transform') else I, (it.get('{%s}path' % NS['p']) or path).lstrip('/'))
                 for it in root.findall('m:build/m:item', NS)]
        models[path] = (objs, build)
    return models[path]
def tris_of(z, path, oid, T, out):
    name, vs, ts, comps = load(z, path)[0][oid]
    if vs:
        pts = [app(T, p) for p in vs]
        out += [(pts[a], pts[b], pts[c]) for a, b, c in ts]
    for cpath, cid, ct in comps: tris_of(z, cpath, cid, mul(T, ct), out)
def names(z):
    d = {}
    try:
        for o in ET.fromstring(z.read('Metadata/model_settings.config')).iter('object'):
            n = next((m.get('value') for m in o.findall('metadata') if m.get('key') == 'name'), None)
            if n: d[o.get('id')] = n
    except KeyError: pass
    return d
def write_stl(fn, tris):
    with open(fn, 'wb') as f:
        f.write(b'\0' * 80); f.write(struct.pack('<I', len(tris)))
        for a, b, c in tris:
            f.write(struct.pack('<12fH', 0, 0, 0, *a, *b, *c, 0))
args = [a for a in sys.argv[1:] if not a.startswith('--')]
merge = sys.argv[sys.argv.index('--merge') + 1] if '--merge' in sys.argv else None
src, pat, outdir = args[0], re.compile(args[1]), args[2]
os.makedirs(outdir, exist_ok=True)
z = zipfile.ZipFile(src); nm = names(z); objs, build = load(z, '3D/3dmodel.model')
allt = []; seen = {}
for oid, T, path in build:
    n = nm.get(oid) or objs[oid][0] or oid
    if not pat.search(n): continue
    out = []; tris_of(z, path, oid, T, out)
    if merge: allt += out
    else:
        safe = re.sub(r'[^A-Za-z0-9_.+-]+', '_', n); seen[safe] = seen.get(safe, 0) + 1
        fn = os.path.join(outdir, f"{safe}{'' if seen[safe] == 1 else '_' + str(seen[safe])}.stl")
        write_stl(fn, out); print(f"{fn}  {len(out)} tris")
if merge: write_stl(os.path.join(outdir, merge), allt); print(f"{merge}  {len(allt)} tris")
