#!/usr/bin/env bash
# usage: ./render.sh [file.scad] [name] [-D 'var=val' ...]
# renders iso/top/side PNGs into renders/<name>_*.png
set -e
cd "$(dirname "$0")"
f="${1:-MODEL_NAME.scad}"; name="${2:-${f%.scad}}"; shift 2 2>/dev/null || shift $#
O="${OPENSCAD:-$(command -v openscad || echo /opt/homebrew/bin/openscad)}"
mkdir -p renders
common=(--backend Manifold --imgsize 1400,1000 --viewall --autocenter --colorscheme "Tomorrow Night")
"$O" "${common[@]}" --camera 0,0,0,55,0,35,300  -o "renders/${name}_iso.png"  "$@" "$f" 2>&1 | grep -iE "error|warning" | grep -v NoError || true
"$O" "${common[@]}" --camera 0,0,0,0,0,0,300    -o "renders/${name}_top.png"  "$@" "$f" 2>&1 | grep -iE "error|warning" | grep -v NoError || true
"$O" "${common[@]}" --camera 0,0,0,90,0,90,300  -o "renders/${name}_side.png" "$@" "$f" 2>&1 | grep -iE "error|warning" | grep -v NoError || true
echo "wrote renders/${name}_{iso,top,side}.png"
