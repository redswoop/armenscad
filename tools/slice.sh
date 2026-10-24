#!/usr/bin/env bash
# Cross-section of an STL for reverse engineering: an SVG of the cut at a given height.
#   usage: tools/slice.sh part.stl z out.svg [axis]      axis = z (default) | x | y
# Coordinates in the SVG are mm in the part's own frame (y is flipped by SVG; read with tools/svgpts.py).
set -e
stl="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; z="$2"; out="$3"; axis="${4:-z}"
case "$axis" in
  z) rot="[0,0,0]"; off="[0,0,-($z)]" ;;
  x) rot="[0,-90,0]"; off="[-($z),0,0]" ;;      # cut plane x = z, view along X
  y) rot="[90,0,0]"; off="[0,-($z),0]" ;;       # cut plane y = z, view along Y
esac
export OPENSCADPATH="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib${OPENSCADPATH:+:$OPENSCADPATH}"   # use <armenscad/...>
"${OPENSCAD:-$(command -v openscad || echo /opt/homebrew/bin/openscad)}" --backend Manifold -o "$out" \
  -D "f=\"$stl\"" -D "rot=$rot" -D "off=$off" \
  "$(dirname "$0")/slice.scad" 2>&1 | grep -iE "error|warn" || true
