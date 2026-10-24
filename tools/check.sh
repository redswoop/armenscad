#!/usr/bin/env bash
# Run every collision pair in a check.scad at one or more poses; print a table; exit 1 on any hit.
#   usage: check.sh CHECK.scad ['steer=0' 'steer=30 tilt=20' ...]
# Pairs are read from the header line `//   pair: "a" | "b" | ...` in the file.
# A pose is a space-separated list of var=value passed as -D. No poses = one run with defaults.
# CHECK_TOL (mm3, default 0.01) is the volume below which a hit is reported as touching, not colliding.
set -u
f="${1:?check.scad path}"; shift
dir="$(cd "$(dirname "$f")" && pwd)"; f="$dir/$(basename "$f")"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export OPENSCADPATH="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib${OPENSCADPATH:+:$OPENSCADPATH}"   # use <armenscad/...>
O="${OPENSCAD:-$(command -v openscad || echo /opt/homebrew/bin/openscad)}"
tol="${CHECK_TOL:-0.01}"
pairs=$(grep -m1 -E '^//\s*pair:' "$f" | grep -oE '"[^"]+"' | tr -d '"')
[ -z "$pairs" ] && { echo "no '//   pair: \"a\" | \"b\"' header in $f"; exit 2; }
poses=("$@"); [ ${#poses[@]} -eq 0 ] && poses=("default")
tmp="$(mktemp -d)"; mkdir -p "$tmp/jobs"
n=0
for pose in "${poses[@]}"; do
  for pair in $pairs; do
    defs=""; [ "$pose" != "default" ] && for kv in $pose; do defs="$defs -D '$kv'"; done
    out="$tmp/${pair}__${pose// /_}.stl"
    n=$((n + 1))
    printf '%s\n' "$O --backend Manifold --export-format binstl -D 'pair=\"$pair\"' $defs -o '$out' '$f' > '$out.log' 2>&1" > "$tmp/jobs/$n.sh"
  done
done
/bin/ls "$tmp"/jobs/*.sh | xargs -P "$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)" -n1 bash
fail=0
printf '%-14s' pair; for pose in "${poses[@]}"; do printf '%-22s' "$pose"; done; echo
for pair in $pairs; do
  printf '%-14s' "$pair"
  for pose in "${poses[@]}"; do
    out="$tmp/${pair}__${pose// /_}.stl"
    if grep -q "top level object is empty" "$out.log"; then printf '%-22s' "clear"; continue; fi   # OpenSCAD writes no file for an empty result
    if [ ! -f "$out" ] || grep -iE "error" "$out.log" | grep -qv NoError; then printf '%-22s' "ERROR (see $out.log)"; fail=1; continue; fi
    v=$("$here/stlinfo.py" "$out" --json 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["volume"])' 2>/dev/null || echo "?")
    if [ "$v" = "?" ]; then printf '%-22s' "ERROR (stlinfo)"; fail=1; continue; fi
    if [ "$v" = "0.0" ]; then printf '%-22s' "clear"
    elif python3 -c "import sys; sys.exit(0 if $v < $tol else 1)"; then printf '%-22s' "touch $v"
    else printf '%-22s' "HIT $v mm3"; fail=1; fi
  done; echo
done
[ $fail -eq 0 ] && echo "all clear" || echo "collisions found (renders in $tmp)"
exit $fail
