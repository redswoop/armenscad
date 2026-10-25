#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = []
# ///
"""Catalog page for a print kit: a folder holding STLs + kit.json. Renders each part (OpenSCAD, two views) into
renders/ and writes index.html and a README.md table so the kit explains itself.
usage: armenscad kitpage <kit folder>
kit.json: {"name", "description", "assembly": [steps], "parts": [{"file", "name", "qty", "source", "license",
           "origin", "print", "colour", "hex", "part_no", "status"}]}
status: ok (the real part) | substitute (nearest file, note why in origin) | missing (no file yet, file may be "").
Also writes print/: one STL per physical piece, <base>_<colour>_<n>.stl, colour from "copies" (a list of colour
words, one per piece) or else "colour" simplified (Bright Blue -> blue, Lime -> lime, Flat Silver -> silver).
hex: render colour (LEGO colour), rendered in OpenSCAD preview mode so color() shows."""
import json, os, re, subprocess, sys, html, shutil
kit = os.path.abspath(sys.argv[1]); meta = json.load(open(os.path.join(kit, 'kit.json')))
rd = os.path.join(kit, 'renders'); os.makedirs(rd, exist_ok=True)
osc = shutil.which('openscad') or os.environ.get('OPENSCAD') or '/opt/homebrew/bin/openscad'
tools = os.path.dirname(os.path.abspath(__file__))
def stlinfo(p):
    out = subprocess.run([os.path.join(tools, 'stlinfo.py'), p], capture_output=True, text=True).stdout.strip()
    m = re.search(r'size \[([^\]]*)\].*?, (watertight|\d+ open edges), (\d+) shell', out)
    return (m.group(1), m.group(2), m.group(3)) if m else ('?', out[-80:], '?')
def render(p, png, cam, hexc):
    scad = png + '.scad'; open(scad, 'w').write('color("%s") import("%s");\n' % (hexc, p))
    subprocess.run([osc, '--backend', 'Manifold', '-o', png, '--imgsize', '700,520', '--viewall',
                    '--autocenter', '--camera', cam, scad], capture_output=True); os.remove(scad)
rows = []
for part in meta['parts']:
    if not part.get('file'):
        rows.append((part, '', 'missing', '', '', '')); continue
    p = os.path.join(kit, part['file']); base = os.path.splitext(part['file'])[0]
    size, wt, shells = stlinfo(p)
    front, back = f'renders/{base}_front.png', f'renders/{base}_back.png'
    hexc = part.get('hex', '#f9d72c')
    render(p, os.path.join(kit, front), '0,0,0,60,0,25,120', hexc); render(p, os.path.join(kit, back), '0,0,0,60,0,205,120', hexc)
    rows.append((part, size, wt, shells, front, back))
e = html.escape
h = ['<!doctype html><meta charset="utf-8"><title>%s</title>' % e(meta['name']),
     '<style>body{font:15px/1.4 system-ui;margin:24px;max-width:1100px}table{border-collapse:collapse;width:100%}'
     'td,th{border-top:1px solid #ddd;padding:8px;vertical-align:top;text-align:left}img{width:220px;background:#fafafa;border:1px solid #eee}'
     '.ok{color:#2a7}.bad{color:#c33}.sub{color:#b80}small{color:#666}.swatch{display:inline-block;width:12px;height:12px;border:1px solid #999;vertical-align:middle}</style>',
     '<h1>%s</h1><p>%s</p>' % (e(meta['name']), e(meta['description'])),
     '<h2>Assembly</h2><ol>' + ''.join('<li>%s</li>' % e(s) for s in meta.get('assembly', [])) + '</ol>',
     '<h2>Parts</h2><table><tr><th>Part</th><th>Front</th><th>Back</th><th>Status / mesh</th><th>Print</th><th>Source</th></tr>']
md = ['# %s' % meta['name'], '', meta['description'], '', '## Assembly', ''] + ['%d. %s' % (i+1, s) for i, s in enumerate(meta.get('assembly', []))] + \
     ['', '## Parts', '', '| File | Part | Qty | Size (mm) | Status / mesh | Print | Source |', '|---|---|---|---|---|---|---|']
for part, size, wt, shells, front, back in rows:
    status = part.get('status', 'ok')
    good = wt == 'watertight' and shells == '1'
    mesh = 'MISSING, no file' if status == 'missing' else '%s, %s shell%s' % (wt, shells, '' if shells == '1' else 's')
    cls = 'bad' if (status == 'missing' or not good) else ('sub' if status == 'substitute' else 'ok')
    label = {'ok': '', 'substitute': 'SUBSTITUTE: ', 'missing': ''}[status] + mesh
    sw = '<span class="swatch" style="background:%s"></span> ' % e(part['hex']) if part.get('hex') else ''
    pn = (' <small>LEGO %s</small>' % e(part['part_no'])) if part.get('part_no') else ''
    h.append('<tr><td><b>%s</b>%s<br><code>%s</code> &times;%s<br><small>%s mm</small><br><small>%s%s</small></td>'
             '<td>%s</td><td>%s</td><td class="%s">%s<br><small>%s</small></td><td>%s</td><td>%s<br><small>%s</small></td></tr>'
             % (e(part['name']), pn, e(part.get('file', '')), part.get('qty', 1), e(size), sw, e(part.get('colour', '')),
                ('<img src="%s">' % front) if front else '', ('<img src="%s">' % back) if back else '',
                cls, e(label), e(part.get('origin', '')), e(part.get('print', '')), e(part.get('source', '')), e(part.get('license', ''))))
    md.append('| `%s` | %s %s | %s | %s | %s | %s | %s |' % (part.get('file', ''), part['name'], part.get('part_no', ''), part.get('qty', 1), size, label, part.get('print', ''), part.get('source', '')))
h.append('</table><p><small>Generated by armenscad kitpage from kit.json.</small></p>')
open(os.path.join(kit, 'index.html'), 'w').write('\n'.join(h))
md += ['', 'Origins: ' + '; '.join('`%s` from %s' % (p.get('file', '(none)'), p.get('origin', '?')) for p in meta['parts']), '', '_Generated by `armenscad kitpage` from kit.json._']
open(os.path.join(kit, 'README.md'), 'w').write('\n'.join(md) + '\n')
pd = os.path.join(kit, 'print'); shutil.rmtree(pd, ignore_errors=True); os.makedirs(pd)
def slug(c):
    c = c.lower()
    for k, v in (('lime', 'lime'), ('yellowish green', 'lime'), ('blue', 'blue'), ('black', 'black'), ('white', 'white'),
                 ('silver', 'silver'), ('titanium', 'titanium'), ('red', 'red'), ('yellow', 'yellow'), ('tan', 'tan'), ('green', 'green')):
        if k in c: return v
    return re.sub(r'[^a-z]+', '', c) or 'any'
n = 0
for part in meta['parts']:
    if not part.get('file'): continue
    cols = part.get('copies') or [slug(part.get('colour', ''))] * int(part.get('qty', 1))
    base = os.path.splitext(part['file'])[0]; seen = {}
    for c in cols:
        seen[c] = seen.get(c, 0) + 1
        shutil.copy(os.path.join(kit, part['file']), os.path.join(pd, '%s_%s_%d.stl' % (base, c, seen[c]))); n += 1
print('wrote', os.path.join(kit, 'index.html'), 'and README.md,', len(rows), 'parts;', n, 'pieces in print/')
