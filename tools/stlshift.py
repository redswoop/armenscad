#!/usr/bin/env python3
"""Translate a binary STL: tools/stlshift.py in.stl out.stl dx dy dz
Moves a plate-positioned reference export back to its own origin so it can be compared
(tools/voxcmp.py) with a port modelled in the part's frame."""
import struct, sys
src, dst = sys.argv[1], sys.argv[2]; d = [float(v) for v in sys.argv[3:6]]
data = open(src, "rb").read(); n = struct.unpack("<I", data[80:84])[0]
assert len(data) == 84 + 50 * n, "not a binary STL"
out = bytearray(data[:84])
for i in range(n):
    rec = data[84 + 50 * i: 84 + 50 * (i + 1)]
    f = list(struct.unpack("<12fH", rec))
    for k in range(3, 12): f[k] += d[(k - 3) % 3]
    out += struct.pack("<12fH", *f)
open(dst, "wb").write(out)
print(f"{dst}: {n} tris shifted by {d}")
