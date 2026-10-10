#!/usr/bin/env python3
"""List the objects in a 3MF (Bambu/Orca or plain): name, triangles, bounding box in mm after build transforms.
usage: tools/3mfinfo.py file.3mf [...]   (add -v to list every mesh component)"""
import sys, zipfile, re, xml.etree.ElementTree as ET
NS = {'m': 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02',
      'p': 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06'}
verbose = '-v' in sys.argv

def mat(s):
    v = [float(x) for x in s.split()]
    return [[v[0], v[3], v[6], v[9]], [v[1], v[4], v[7], v[10]], [v[2], v[5], v[8], v[11]]]
def mul(a, b):  # 3x4 * 3x4
    r = [[0]*4 for _ in range(3)]
    for i in range(3):
        for j in range(4):
            r[i][j] = sum(a[i][k]*b[k][j] for k in range(3)) + (a[i][3] if j == 3 else 0)
    return r
def app(m, p): return [m[i][0]*p[0]+m[i][1]*p[1]+m[i][2]*p[2]+m[i][3] for i in range(3)]
I = [[1,0,0,0],[0,1,0,0],[0,0,1,0]]

def load_model(z, path, models):
    if path in models: return models[path]
    root = ET.fromstring(z.read(path))
    objs = {}
    for o in root.iter('{%s}object' % NS['m']):
        oid = o.get('id'); name = o.get('name') or ''
        mesh = o.find('m:mesh', NS)
        if mesh is not None:
            vs = [(float(v.get('x')), float(v.get('y')), float(v.get('z'))) for v in mesh.find('m:vertices', NS)]
            nt = len(mesh.find('m:triangles', NS))
            objs[oid] = {'name': name, 'verts': vs, 'tris': nt, 'comps': []}
        else:
            comps = []
            for c in o.findall('m:components/m:component', NS):
                comps.append((c.get('{%s}path' % NS['p']), c.get('objectid'), mat(c.get('transform')) if c.get('transform') else I))
            objs[oid] = {'name': name, 'verts': [], 'tris': 0, 'comps': comps}
    # metadata names (Bambu puts object names in the build items / model settings)
    build = [(it.get('objectid'), mat(it.get('transform')) if it.get('transform') else I, it.get('{%s}path' % NS['p']))
             for it in root.findall('m:build/m:item', NS)]
    models[path] = (objs, build)
    return models[path]

def bbox_of(z, path, oid, T, models, out):
    objs, _ = load_model(z, path, models)
    o = objs[oid]
    if o['verts']:
        pts = [app(T, p) for p in o['verts']]
        out.append((o['name'], o['tris'], pts))
    for cpath, cid, ct in o['comps']:
        bbox_of(z, (cpath or path).lstrip('/'), cid, mul(T, ct), models, out)

def names_from_settings(z):
    names = {}
    try:
        root = ET.fromstring(z.read('Metadata/model_settings.config'))
        for o in root.iter('object'):
            n = next((m.get('value') for m in o.findall('metadata') if m.get('key') == 'name'), None)
            if n: names[o.get('id')] = n
    except KeyError: pass
    return names

for f in [a for a in sys.argv[1:] if not a.startswith('-')]:
    z = zipfile.ZipFile(f)
    models = {}
    names = names_from_settings(z)
    objs, build = load_model(z, '3D/3dmodel.model', models)
    print(f"== {f}  ({len(build)} build items)")
    allpts = []
    for oid, T, path in build:
        out = []
        bbox_of(z, path.lstrip('/') if path else '3D/3dmodel.model', oid, T, models, out)
        pts = [p for _, _, ps in out for p in ps]
        allpts += pts
        if not pts: continue
        lo = [min(p[i] for p in pts) for i in range(3)]; hi = [max(p[i] for p in pts) for i in range(3)]
        tris = sum(t for _, t, _ in out)
        nm = names.get(oid) or objs[oid]['name'] or (out[0][0] if len(out) == 1 else '')
        print(f"  {nm[:48]:48s} tris {tris:8d}  size {hi[0]-lo[0]:7.1f} x {hi[1]-lo[1]:7.1f} x {hi[2]-lo[2]:7.1f}  at [{lo[0]:.1f},{lo[1]:.1f},{lo[2]:.1f}]")
        if verbose:
            for n, t, ps in out:
                l = [min(p[i] for p in ps) for i in range(3)]; h = [max(p[i] for p in ps) for i in range(3)]
                print(f"      - {n[:40]:40s} {t:7d}  {h[0]-l[0]:6.1f} x {h[1]-l[1]:6.1f} x {h[2]-l[2]:6.1f}")
    if allpts:
        lo = [min(p[i] for p in allpts) for i in range(3)]; hi = [max(p[i] for p in allpts) for i in range(3)]
        print(f"  plate extent {hi[0]-lo[0]:.1f} x {hi[1]-lo[1]:.1f} x {hi[2]-lo[2]:.1f}")
