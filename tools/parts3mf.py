#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["numpy"]
# ///
"""Build a Bambu Studio 3mf from STLs: each --object is its own object in the slicer (select, delete, copy it alone),
each of its STLs a part of it on its own filament, kept where the STLs put them. Two STLs imported together become
parts of ONE object, and "to objects" then drops the parts to the plate; this keeps the grouping.
usage: armenscad parts3mf out.3mf [--template project.3mf] --object NAME a.stl[:filament] b.stl[:filament] --object ...
       [--plate --object ...]
A part is named for its STL; --plate puts the objects after it on the next plate. --template takes printer, process
and filaments from a saved project, and lays out each plate on its bed: centred across, at the front, the prime tower
behind (a full bed left the tower's saved spot on a part, and Bambu refuses to slice that). Without it the slicer's
current settings apply and the STLs' bed coordinates are kept, on one plate."""
import io, json, math, os, struct, sys, uuid, zipfile
from xml.sax.saxutils import quoteattr
import numpy as np

NS = ('unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" '
      'xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" '
      'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"')
HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n'
REL = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n%s</Relationships>'
REL_ITEM = ' <Relationship Target="%s" Id="rel-%d" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n'
MARGIN = 5.0                     # layout to the bed's front edge
TOWER_GAP = 15.0                 # layout to the prime tower: its brim takes 6, and tall parts want air beside a tall tower
TOWER_D = 40.0                   # front to back room a two-filament tower wants, roughly
PLATE_PITCH = 1.2                # Bambu's plate grid, in beds: the next plate's origin along x, and -y a row down

def load_stl(p):
    b = open(p, 'rb').read()
    n = struct.unpack('<I', b[80:84])[0]
    if len(b) != 84 + n * 50: sys.exit('%s: not a binary STL' % p)
    a = np.frombuffer(b[84:], dtype=np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')]))
    return a['v'].astype(np.float64)
def ident(v): return ' '.join('%.9g' % x for x in [1, 0, 0, 0, 1, 0, 0, 0, 1, *v])            # 3mf: a 3 x 4 matrix, rows
def meta(k, v): return '<metadata key="%s" value=%s/>' % (k, quoteattr(str(v)))

args = sys.argv[1:]
if len(args) < 3: sys.exit(__doc__)
out = args.pop(0); tpl = None; objects = []; plate = 0
while args:
    a = args.pop(0)
    if a == '--template': tpl = args.pop(0)
    elif a == '--plate': plate += 1 if objects and objects[-1]['plate'] == plate else 0
    elif a == '--object': objects.append(dict(name=args.pop(0), parts=[], plate=plate))
    else:
        f, _, fil = a.rpartition(':') if a.rpartition(':')[2].isdigit() else (a, '', '1')
        if not objects: sys.exit('an STL before the first --object')
        objects[-1]['parts'].append(dict(file=f, fil=int(fil), tris=load_stl(f)))
if not objects: sys.exit(__doc__)

nplates = objects[-1]['plate'] + 1
if nplates > 1 and not tpl: sys.exit('--plate needs --template: the plate grid comes from its bed')
proj = None; plate_md = ''
shifts = [np.zeros(3) for _ in range(nplates)]
if tpl:
    tz = zipfile.ZipFile(tpl)
    proj = tz.read('Metadata/project_settings.config')
    p = json.loads(proj); xy = [list(map(float, c.split('x'))) for c in p['printable_area']]
    nslot = len(p['filament_colour']); top = max(q['fil'] for o in objects for q in o['parts'])
    if top > nslot: sys.exit('filament %d, but %s has %d' % (top, tpl, nslot))
    bed = np.max(xy, 0); cols = math.ceil(math.sqrt(nplates)); tower_y = []
    for i in range(nplates):
        pts = np.vstack([q['tris'].reshape(-1, 3) for o in objects if o['plate'] == i for q in o['parts']])
        lo, hi = pts.min(0), pts.max(0); sz = hi - lo
        shifts[i][0] = (i % cols) * bed[0] * PLATE_PITCH + bed[0] / 2 - (lo[0] + hi[0]) / 2
        shifts[i][1] = -(i // cols) * bed[1] * PLATE_PITCH + MARGIN - lo[1]
        if sz[0] > bed[0] or sz[1] + MARGIN > bed[1]: print('warning: %s plate %d is %.1f x %.1f on a %g x %g bed' % (out, i + 1, sz[0], sz[1], *bed))
        # the layout sits at the front, the prime tower behind it, whatever spot the template's plates had it in
        tower_y.append(MARGIN + sz[1] + TOWER_GAP)
        if tower_y[i] + TOWER_D > bed[1]: print('warning: %s plate %d leaves %.0f mm behind it for the prime tower' % (out, i + 1, bed[1] - tower_y[i]))
    if len({q['fil'] for o in objects for q in o['parts']}) > 1 and p.get('enable_prime_tower') == '1':
        p['wipe_tower_x'] = ['%g' % ((bed[0] - float(p['prime_tower_width'])) / 2)] * nplates
        p['wipe_tower_y'] = ['%g' % y for y in tower_y]
        proj = json.dumps(p, indent=4)
    plate_md ='    %s\n    %s\n' % (meta('filament_maps', ' '.join(['1'] * nslot)), meta('filament_volume_maps', ' '.join(['0'] * nslot)))

roots, items, rels, files, settings = [], [], [], {}, []
instances = [[] for _ in range(nplates)]
oid = 1
for n, o in enumerate(objects):
    box = np.vstack([p['tris'].reshape(-1, 3) for p in o['parts']])
    ctr = (box.min(0) + box.max(0)) / 2
    path = '/3D/Objects/object_%d.model' % (n + 1)
    buf = io.StringIO(); comps = []; parts = []
    buf.write(HEAD + '<model %s>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n' % NS)
    for p in o['parts']:
        v = p['tris'].reshape(-1, 3)
        pc = (v.min(0) + v.max(0)) / 2
        uniq, inv = np.unique(np.round(v - pc, 5), axis=0, return_inverse=True)
        f = inv.reshape(-1, 3)
        f = f[(f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])]     # rounding can collapse a sliver
        buf.write('  <object id="%d" p:UUID="%s" type="model">\n   <mesh>\n    <vertices>\n' % (oid, uuid.uuid4()))
        buf.write(''.join('     <vertex x="%.6g" y="%.6g" z="%.6g"/>\n' % tuple(q) for q in uniq))
        buf.write('    </vertices>\n    <triangles>\n')
        buf.write(''.join('     <triangle v1="%d" v2="%d" v3="%d"/>\n' % tuple(t) for t in f))
        buf.write('    </triangles>\n   </mesh>\n  </object>\n')
        comps.append('    <component p:path="%s" objectid="%d" p:UUID="%s" transform="%s"/>\n' % (path, oid, uuid.uuid4(), ident(pc - ctr)))
        name = os.path.basename(p['file'])
        parts.append('    <part id="%d" subtype="normal_part" uuid="%s">\n      %s\n      %s\n      %s\n      %s\n      %s\n      %s\n      %s\n      %s\n'
                     '      <mesh_stat face_count="%d" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>\n    </part>\n'
                     % (oid, uuid.uuid4(), meta('name', name), meta('source_file', name), meta('source_object_id', 0), meta('source_volume_id', 0),
                        meta('source_offset_x', pc[0]), meta('source_offset_y', pc[1]), meta('source_offset_z', pc[2]), meta('extruder', p['fil']), len(f)))
        oid += 1
    buf.write(' </resources>\n <build/>\n</model>\n')
    files[path] = buf.getvalue()
    rels.append(REL_ITEM % (path, n + 1))
    root = oid; oid += 1
    roots.append('  <object id="%d" p:UUID="%s" type="model">\n   <components>\n%s   </components>\n  </object>\n' % (root, uuid.uuid4(), ''.join(comps)))
    items.append('  <item objectid="%d" p:UUID="%s" transform="%s" printable="1"/>\n' % (root, uuid.uuid4(), ident(ctr + shifts[o['plate']])))
    settings.append('  <object id="%d">\n    %s\n    %s\n    <metadata face_count="%d"/>\n%s  </object>\n'
                    % (root, meta('name', o['name']), meta('extruder', o['parts'][0]['fil']), sum(len(p['tris']) for p in o['parts']), ''.join(parts)))
    instances[o['plate']].append('    <model_instance>\n      %s\n      %s\n      %s\n    </model_instance>\n' % (meta('object_id', root), meta('instance_id', 0), meta('identify_id', 1000 + n)))

model = (HEAD + '<model %s>\n <metadata name="Application">BambuStudio-02.08.02.61</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n%s </resources>\n <build p:UUID="%s">\n%s </build>\n</model>\n'
         % (NS, ''.join(roots), uuid.uuid4(), ''.join(items)))
plates = ''.join('  <plate>\n    %s\n    %s\n    %s\n    %s\n%s%s  </plate>\n' % (meta('plater_id', i + 1), meta('plater_name', ''), meta('locked', 'false'), meta('filament_map_mode', 'Auto For Flush'), plate_md, ''.join(instances[i]))
                 for i in range(nplates))
config = HEAD + '<config>\n%s%s  <assemble>\n%s  </assemble>\n</config>\n' % (''.join(settings), plates,
         ''.join('   <assemble_item object_id="%s" instance_id="0" transform="1 0 0 0 1 0 0 0 1 0 0 0" offset="0 0 0" />\n' % s.split('"')[1] for s in settings))
ct = ('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
      ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n <Default Extension="png" ContentType="image/png"/>\n</Types>\n')
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', ct)
    z.writestr('_rels/.rels', REL % (REL_ITEM % ('/3D/3dmodel.model', 1)))
    z.writestr('3D/3dmodel.model', model)
    z.writestr('3D/_rels/3dmodel.model.rels', REL % ''.join(rels))
    for p, s in files.items(): z.writestr(p.lstrip('/'), s)
    z.writestr('Metadata/model_settings.config', config)
    if proj: z.writestr('Metadata/project_settings.config', proj)
    z.writestr('Metadata/cut_information.xml', '<?xml version="1.0" encoding="utf-8"?>\n<objects>\n</objects>\n')
print('wrote %s | %d objects, %d parts, %d plates' % (out, len(objects), sum(len(o['parts']) for o in objects), nplates))
