#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = []
# ///
"""Learn print orientations from a Bambu 3mf and store them in a kit's kit.json.
usage: armenscad kitrot <file.3mf> <kit folder>
For every object in the 3mf whose name is <base>_<colour>_<n>.stl, the rotation part of its transform is written
to the kit part with file <base>.stl as "rot" [x, y, z] degrees (for reading) and "rot_matrix" (the 9 numbers
of the 3mf transform, exact). kit3mf reads the matrix back, so the next kit carries the same orientations."""
import json, math, os, sys, zipfile, re
import xml.etree.ElementTree as ET
f3, kit = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(f3)
ns = {'m': 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'}
model = ET.fromstring(z.read('3D/3dmodel.model'))
ms = ET.fromstring(z.read('Metadata/model_settings.config'))
name = {o.get('id'): {m.get('key'): m.get('value') for m in o.findall('metadata')}.get('name', '') for o in ms.findall('object')}
def angles(t):
    m = [t[0:3], t[3:6], t[6:9]]; M = [[m[j][i] for j in range(3)] for i in range(3)]
    sy = math.hypot(M[0][0], M[1][0])
    return [round(math.degrees(math.atan2(M[2][1], M[2][2])), 1), round(math.degrees(math.atan2(-M[2][0], sy)), 1), round(math.degrees(math.atan2(M[1][0], M[0][0])), 1)]
rot = {}
for it in model.findall('.//m:item', ns):
    t = [float(x) for x in it.get('transform').split()]
    base = re.sub(r'_[a-z]+_\d+\.stl$', '', name.get(it.get('objectid'), ''))
    if base: rot[base] = (angles(t), [round(x, 6) for x in t[:9]])
kp = os.path.join(kit, 'kit.json'); meta = json.load(open(kp)); n = 0
for part in meta['parts']:
    b = os.path.splitext(part.get('file', ''))[0]
    if b in rot: part['rot'], part['rot_matrix'] = rot[b]; n += 1
json.dump(meta, open(kp, 'w'), indent=1, ensure_ascii=False)
print('stored rot for %d parts from %d objects' % (n, len(rot)))
for b, r in sorted(rot.items()): print('  %-34s %s' % (b, r[0]))
