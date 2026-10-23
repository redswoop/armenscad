#!/usr/bin/env python3
"""Flatten an LDraw part (.dat) into a binary STL in mm, Z up, for use as a viewer reference.
usage: tools/ldraw2stl.py <ldraw library dir> <part.dat or part number> out.stl
The library dir is the unzipped complete.zip (has parts/, p/). Output is a visual mesh, usually
not watertight: good for measuring and for the viewer's reference ghost, not for printing or booleans.
LDraw units are 0.4 mm and -Y is up; here +Z is up and +Y is LDraw +Z."""
import sys, os, struct, math
lib = sys.argv[1]; part = sys.argv[2]; out = sys.argv[3]
if not part.lower().endswith('.dat'): part += '.dat'
search = [os.path.join(lib, d) for d in ('parts', 'p', 'parts/s', 'p/48', 'p/8', 'models')]
_cache = {}
def find(name):
    name = name.replace('\\', '/')
    for d in search + [os.getcwd()]:
        for cand in (name, name.lower()):
            p = os.path.join(d, cand)
            if os.path.exists(p): return p
    # case-insensitive fallback
    base = os.path.basename(name).lower(); sub = os.path.dirname(name)
    for d in search:
        dd = os.path.join(d, sub)
        if os.path.isdir(dd):
            for f in os.listdir(dd):
                if f.lower() == base: return os.path.join(dd, f)
    return None
def mul(m, v):  # m: (a..i, x,y,z) LDraw row-major 3x3 + translation
    a,b,c,d,e,f,g,h,i,x,y,z = m
    return (a*v[0]+b*v[1]+c*v[2]+x, d*v[0]+e*v[1]+f*v[2]+y, g*v[0]+h*v[1]+i*v[2]+z)
def compose(m, n):  # apply n then m
    a,b,c,d,e,f,g,h,i,x,y,z = m
    A,B,C,D,E,F,G,H,I,X,Y,Z = n
    return (a*A+b*D+c*G, a*B+b*E+c*H, a*C+b*F+c*I,
            d*A+e*D+f*G, d*B+e*E+f*H, d*C+e*F+f*I,
            g*A+h*D+i*G, g*B+h*E+i*H, g*C+h*F+i*I,
            a*X+b*Y+c*Z+x, d*X+e*Y+f*Z+y, g*X+h*Y+i*Z+z)
def det(m): a,b,c,d,e,f,g,h,i = m[:9]; return a*(e*i-f*h) - b*(d*i-f*g) + c*(d*h-e*g)
IDENT = (1,0,0, 0,1,0, 0,0,1, 0,0,0)
tris = []
def load(path):
    if path in _cache: return _cache[path]
    lines = []
    with open(path, encoding='utf-8', errors='replace') as fh:
        for ln in fh:
            t = ln.split()
            if not t: continue
            lines.append(t)
    _cache[path] = lines; return lines
missing = set()
def walk(path, m, inv, depth=0):
    if depth > 40: return
    invert_next = False
    for t in load(path):
        if t[0] == '0':
            if len(t) >= 3 and t[1] == 'BFC' and 'INVERTNEXT' in t: invert_next = True
            continue
        if t[0] == '1' and len(t) >= 15:
            n = tuple(float(v) for v in t[5:14]) + tuple(float(v) for v in t[2:5])
            sub = find(' '.join(t[14:]))
            if sub is None: missing.add(' '.join(t[14:]))
            else: walk(sub, compose(m, n), inv ^ invert_next ^ (det(n) < 0), depth + 1)
            invert_next = False
        elif t[0] == '3' and len(t) >= 11:
            p = [mul(m, tuple(float(v) for v in t[2+3*k:5+3*k])) for k in range(3)]
            tris.append(p[::-1] if inv else p)
        elif t[0] == '4' and len(t) >= 14:
            p = [mul(m, tuple(float(v) for v in t[2+3*k:5+3*k])) for k in range(4)]
            if inv: p = p[::-1]
            tris.append([p[0], p[1], p[2]]); tris.append([p[0], p[2], p[3]])
        else:
            invert_next = False
root = find(part) if not os.path.exists(part) else part
if root is None: sys.exit(f"part not found: {part}")
walk(root, IDENT, False)
if missing: print("missing subfiles:", ', '.join(sorted(missing)), file=sys.stderr)
def conv(v): return (v[0]*0.4, v[2]*0.4, -v[1]*0.4)   # LDraw -Y up -> Z up; LDraw +Z -> +Y
with open(out, 'wb') as fh:
    fh.write(b'ldraw2stl'.ljust(80, b'\0')); fh.write(struct.pack('<I', len(tris)))
    for t in tris:
        a, b, c = (conv(v) for v in t)
        u = (b[0]-a[0], b[1]-a[1], b[2]-a[2]); w = (c[0]-a[0], c[1]-a[1], c[2]-a[2])
        n = (u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0])
        l = math.sqrt(sum(x*x for x in n)) or 1.0
        fh.write(struct.pack('<3f', *(x/l for x in n)))
        for v in (a, b, c): fh.write(struct.pack('<3f', *v))
        fh.write(b'\0\0')
xs = [conv(v) for t in tris for v in t]
lo = [min(p[i] for p in xs) for i in range(3)]; hi = [max(p[i] for p in xs) for i in range(3)]
print(f"{out}: {len(tris)} tris, size {[round(hi[i]-lo[i],2) for i in range(3)]} bbox {[round(v,2) for v in lo]}..{[round(v,2) for v in hi]}")
