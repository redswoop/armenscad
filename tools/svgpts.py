#!/usr/bin/env python3
"""Read an OpenSCAD-exported SVG section: per closed loop, bounding box, area and orientation.
usage: tools/svgpts.py section.svg [--pts] [--origin X,Y]
  --pts         also prints the vertices (collinear points merged)
  --origin X,Y  subtract this point first, so a plate-positioned STL reads in its own frame
  --compact     with --pts: runs of small steps (arcs) print as ~arc(start->end), values rounded to 0.1"""
import sys, re
svg = open(sys.argv[1]).read()
pts_flag = '--pts' in sys.argv
compact = '--compact' in sys.argv
ox, oy = (map(float, sys.argv[sys.argv.index('--origin') + 1].split(',')) if '--origin' in sys.argv else (0.0, 0.0))
loops = []
for d in re.findall(r' d="([^"]+)"', svg):
    for sub in re.split(r'(?=M)', d):
        nums = [float(x) for x in re.findall(r'-?\d+\.?\d*(?:e-?\d+)?', sub)]
        if len(nums) < 6: continue
        p = [(nums[i] - ox, -nums[i + 1] - oy) for i in range(0, len(nums) - 1, 2)]   # OpenSCAD writes y flipped
        loops.append(p)
def area(p): return sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p))) / 2
print(f"{len(loops)} loops")
for i, p in enumerate(sorted(loops, key=lambda q: -abs(area(q)))):
    xs = [q[0] for q in p]; ys = [q[1] for q in p]; a = area(p)
    print(f"  {i:3d} {'outer' if a > 0 else 'hole '} n={len(p):4d} x {min(xs):8.2f}..{max(xs):8.2f} ({max(xs)-min(xs):7.2f})  y {min(ys):8.2f}..{max(ys):8.2f} ({max(ys)-min(ys):7.2f})  area {abs(a):10.1f}")
    if pts_flag:
        d = [v for j, v in enumerate(p) if abs(v[0]-p[j-1][0]) > 1e-6 or abs(v[1]-p[j-1][1]) > 1e-6]   # drop repeated vertices first
        q = [v for j, v in enumerate(d) if abs((d[j-1][0]-v[0])*(d[(j+1)%len(d)][1]-v[1]) - (d[j-1][1]-v[1])*(d[(j+1)%len(d)][0]-v[0])) > 1e-3]
        if compact:
            s = []; j = 0
            while j < len(q):
                k = j
                while k + 1 < len(q) and 0.001 < abs(q[k+1][0] - q[k][0]) < 1.0 and 0.001 < abs(q[k+1][1] - q[k][1]) < 1.0: k += 1
                if k > j + 2: s.append(f"~arc({q[j][0]:.1f},{q[j][1]:.1f}->{q[k][0]:.1f},{q[k][1]:.1f})"); j = k
                else: s.append(f"({q[j][0]:.1f},{q[j][1]:.1f})"); j += 1
            print("      " + " ".join(s))
        else:
            print("      " + " ".join(f"({x:.2f},{y:.2f})" for x, y in q))
