#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["numpy"]
# ///
"""Build a Bambu Studio 3mf project from a kit folder: one plate per colour, every physical piece placed with the
orientation stored in kit.json ("rot_matrix", learned with kitrot), filament slots coloured to match.
usage: armenscad kit3mf <kit folder> <template.3mf> [out.3mf]
The template supplies Metadata/project_settings.config (printer, layer height, supports, per-filament settings);
its plate names are matched to kit colours so e.g. the Black plate keeps its PETG. Default out: <kit>/print/<kit name>.3mf
Bed 256 x 256 (P1S); pieces are shelf-packed with a 6 mm gap. Open in Bambu Studio and arrange if it looks tight."""
import json, os, re, struct, sys, uuid, zipfile, io
import numpy as np
import xml.etree.ElementTree as ET
kit = os.path.abspath(sys.argv[1]); tpl = sys.argv[2]
meta = json.load(open(os.path.join(kit, 'kit.json')))
out = sys.argv[3] if len(sys.argv) > 3 else os.path.join(kit, 'print', re.sub(r'[^\w.-]+', '_', meta['name'].split('(')[0].strip()) + '.3mf')
BED, GAP, PITCH, COLS = 256.0, 6.0, 300.0, 3

def slug(c):
    c = c.lower()
    for k, v in (('lime', 'lime'), ('yellowish green', 'lime'), ('blue', 'blue'), ('black', 'black'), ('white', 'white'),
                 ('silver', 'silver'), ('titanium', 'titanium'), ('red', 'red'), ('yellow', 'yellow'), ('tan', 'tan'), ('green', 'green')):
        if k in c: return v
    return re.sub(r'[^a-z]+', '', c) or 'any'
def load_stl(p):
    b = open(p, 'rb').read()
    if b[:5] == b'solid' and b'facet' in b[:400]:
        v = np.array([list(map(float, l.split()[1:4])) for l in b.decode('latin1').splitlines() if l.strip().startswith('vertex')])
        return v.reshape(-1, 3, 3)
    n = struct.unpack('<I', b[80:84])[0]
    a = np.frombuffer(b[84:84 + n * 50], dtype=np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')]))
    return a['v'].astype(np.float64)

# ---- pieces: one per physical copy, with colour and rotation
pieces = []
for part in meta['parts']:
    if not part.get('file'): continue
    cols = part.get('copies') or [slug(part.get('colour', ''))] * int(part.get('qty', 1))
    base = os.path.splitext(part['file'])[0]; seen = {}
    R = np.array(part.get('rot_matrix', [1, 0, 0, 0, 1, 0, 0, 0, 1]), dtype=float).reshape(3, 3)
    hexes = part.get('hexes') or {}
    for c in cols:
        seen[c] = seen.get(c, 0) + 1
        pieces.append(dict(name='%s_%s_%d.stl' % (base, c, seen[c]), file=os.path.join(kit, part['file']), colour=c, R=R,
                           hex=hexes.get(c) or (part.get('hex') if c == slug(part.get('colour', '')) else None)))
colours = []
for p in pieces:
    if p['colour'] not in colours: colours.append(p['colour'])
if len(colours) > 5: sys.exit('more than 5 colours: %s' % colours)
default_hex = {'black': '#000000', 'white': '#FFFFFF', 'lime': '#BECF00', 'blue': '#0056B8', 'silver': '#A6A9AA', 'titanium': '#5B5B5B', 'red': '#C12E1F', 'tan': '#E4CD9E', 'yellow': '#F4D400', 'green': '#4B9F4A'}
col_hex = {c: next((p['hex'] for p in pieces if p['colour'] == c and p['hex']), default_hex.get(c, '#888888')) for c in colours}

# ---- template settings
tz = zipfile.ZipFile(tpl)
proj = json.loads(tz.read('Metadata/project_settings.config'))
tms = ET.fromstring(tz.read('Metadata/model_settings.config'))
tpl_plate_type = {}
for pl in tms.findall('plate'):
    md = {m.get('key'): m.get('value') for m in pl.findall('metadata')}
    maps = md.get('filament_volume_maps', '').split()
    if md.get('plater_name') and maps and '1' in maps:
        tpl_plate_type[md['plater_name'].lower()] = proj['filament_type'][maps.index('1')]
nslot = len(proj['filament_colour'])
tpl_slot = {}   # colour name -> template filament slot that printed that colour's plate
for pl in tms.findall('plate'):
    md = {m.get('key'): m.get('value') for m in pl.findall('metadata')}
    maps = md.get('filament_volume_maps', '').split()
    if md.get('plater_name') and '1' in maps: tpl_slot[md['plater_name'].lower()] = maps.index('1')
per_fil = {k: list(v) for k, v in proj.items() if k.startswith('filament') and isinstance(v, list) and len(v) == nslot}
snap = {k: list(v) for k, v in per_fil.items()}   # template values, untouched
for i, c in enumerate(colours):
    j = tpl_slot.get(c)
    for k in per_fil:
        per_fil[k][i] = snap[k][j] if j is not None else snap[k][0]
    per_fil['filament_colour'][i] = col_hex[c].upper()
    if j is None: per_fil['filament_type'][i] = 'PLA'
proj.update(per_fil)

# ---- layout and mesh objects
model_objs, rels, obj_files, settings_objs, plates = [], [], {}, [], {c: [] for c in colours}
oid = 1; ident = 1000
cursor = {}
for c in colours: cursor[c] = dict(x=GAP, y=GAP, row_h=0.0)
mesh_cache = {}
def plate_origin(i): return ((i % COLS) * PITCH, -(i // COLS) * PITCH)
for pc in pieces:
    if pc['file'] not in mesh_cache: mesh_cache[pc['file']] = load_stl(pc['file'])
    tris = mesh_cache[pc['file']]
    ctr = (tris.reshape(-1, 3).min(0) + tris.reshape(-1, 3).max(0)) / 2
    v = tris.reshape(-1, 3) - ctr
    R = pc['R']; vr = v @ R   # 3MF: row-vector points, p' = p @ M
    mn, mx = vr.min(0), vr.max(0); sz = mx - mn
    cu = cursor[pc['colour']]
    if cu['x'] + sz[0] > BED - GAP: cu['x'] = GAP; cu['y'] += cu['row_h'] + GAP; cu['row_h'] = 0
    px, py = plate_origin(colours.index(pc['colour']))
    tx, ty, tz_ = px + cu['x'] - mn[0], py + cu['y'] - mn[1], -mn[2]
    cu['x'] += sz[0] + GAP; cu['row_h'] = max(cu['row_h'], sz[1])
    if cu['y'] + sz[1] > BED: print('warning: plate', pc['colour'], 'overflows the bed at', pc['name'])
    mesh_id, comp_id = oid, oid + 1; oid += 2
    # mesh file
    vs = v.reshape(-1, 3, 3)
    verts = vs.reshape(-1, 3)
    uniq, inv = np.unique(np.round(verts, 5), axis=0, return_inverse=True)
    buf = io.StringIO()
    buf.write('<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n')
    buf.write('  <object id="%d" p:UUID="%s" type="model">\n   <mesh>\n    <vertices>\n' % (mesh_id, uuid.uuid4()))
    buf.write(''.join('     <vertex x="%.6g" y="%.6g" z="%.6g"/>\n' % tuple(q) for q in uniq))
    buf.write('    </vertices>\n    <triangles>\n')
    f = inv.reshape(-1, 3)
    buf.write(''.join('     <triangle v1="%d" v2="%d" v3="%d"/>\n' % tuple(t) for t in f))
    buf.write('    </triangles>\n   </mesh>\n  </object>\n </resources>\n <build/>\n</model>\n')
    path = '/3D/Objects/object_%d.model' % mesh_id
    obj_files[path] = buf.getvalue()
    model_objs.append('  <object id="%d" p:UUID="%s" type="model">\n   <components>\n    <component p:path="%s" objectid="%d" p:UUID="%s" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n   </components>\n  </object>\n' % (comp_id, uuid.uuid4(), path, mesh_id, uuid.uuid4()))
    rels.append(' <Relationship Target="%s" Id="rel-%d" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n' % (path, len(rels) + 1))
    tf = ' '.join('%.9g' % x for x in list(R.flatten()) + [tx, ty, tz_])
    pc['item'] = '  <item objectid="%d" p:UUID="%s" transform="%s" printable="1"/>\n' % (comp_id, uuid.uuid4(), tf)
    ext = colours.index(pc['colour']) + 1
    settings_objs.append('  <object id="%d">\n    <metadata key="name" value="%s"/>\n    <metadata key="extruder" value="%d"/>\n    <metadata face_count="%d"/>\n    <part id="%d" subtype="normal_part" uuid="%s">\n      <metadata key="name" value="%s"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n      <metadata key="source_file" value="%s"/>\n      <metadata key="source_object_id" value="0"/>\n      <metadata key="source_volume_id" value="0"/>\n      <metadata key="source_offset_x" value="%g"/>\n      <metadata key="source_offset_y" value="%g"/>\n      <metadata key="source_offset_z" value="%g"/>\n      <mesh_stat face_count="%d" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>\n    </part>\n  </object>\n' % (comp_id, pc['name'], ext, len(f), mesh_id, uuid.uuid4(), pc['name'], pc['name'], ctr[0], ctr[1], ctr[2], len(f)))
    plates[pc['colour']].append('    <model_instance>\n      <metadata key="object_id" value="%d"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="%d"/>\n    </model_instance>\n' % (comp_id, ident)); ident += 1

model = ('<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">\n'
         ' <metadata name="Application">BambuStudio-02.08.02.61</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <metadata name="Title">%s</metadata>\n <resources>\n%s </resources>\n <build p:UUID="%s">\n%s </build>\n</model>\n'
         % (meta['name'], ''.join(model_objs), uuid.uuid4(), ''.join(p['item'] for p in pieces)))
plate_xml = ''
for i, c in enumerate(colours):
    vm = ' '.join('1' if j == i else '0' for j in range(nslot))
    plate_xml += ('  <plate>\n    <metadata key="plater_id" value="%d"/>\n    <metadata key="plater_name" value="%s"/>\n    <metadata key="locked" value="false"/>\n    <metadata key="filament_map_mode" value="Auto For Flush"/>\n    <metadata key="filament_maps" value="%s"/>\n    <metadata key="filament_volume_maps" value="%s"/>\n%s  </plate>\n'
                  % (i + 1, c.capitalize(), ' '.join(['1'] * nslot), vm, ''.join(plates[c])))
settings = '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n%s%s  <assemble>\n%s  </assemble>\n</config>\n' % (''.join(settings_objs), plate_xml,
           ''.join('   <assemble_item object_id="%s" instance_id="0" transform="1 0 0 0 1 0 0 0 1 0 0 0" offset="0 0 0" />\n' % re.search(r'id="(\d+)"', s).group(1) for s in settings_objs))
ct = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n <Default Extension="png" ContentType="image/png"/>\n</Types>\n'
root_rels = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>'
model_rels = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n%s</Relationships>' % ''.join(rels)
os.makedirs(os.path.dirname(out), exist_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', ct); z.writestr('_rels/.rels', root_rels); z.writestr('3D/3dmodel.model', model); z.writestr('3D/_rels/3dmodel.model.rels', model_rels)
    for p, s in obj_files.items(): z.writestr(p.lstrip('/'), s)
    z.writestr('Metadata/model_settings.config', settings)
    z.writestr('Metadata/project_settings.config', json.dumps(proj, indent=4))
    z.writestr('Metadata/cut_information.xml', '<?xml version="1.0" encoding="utf-8"?>\n<objects>\n</objects>\n')
    z.writestr('Metadata/slice_info.config', '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <header>\n    <header_item key="X-BBL-Client-Type" value="slicer"/>\n    <header_item key="X-BBL-Client-Version" value="02.08.02.61"/>\n  </header>\n</config>\n')
print('wrote', out, '|', len(pieces), 'pieces on', len(colours), 'plates:', ', '.join('%s=%s %s' % (c, proj['filament_type'][i], col_hex[c]) for i, c in enumerate(colours)))
