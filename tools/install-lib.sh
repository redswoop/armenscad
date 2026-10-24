#!/usr/bin/env bash
# Make `use <armenscad/shape.scad>` resolve everywhere: symlink lib/armenscad into OpenSCAD's user library folder.
# (The viewer and tools/ also put lib/ on OPENSCADPATH themselves, so they work without this.)
set -e
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "$(uname -s)" in
  Darwin) ulib="$HOME/Documents/OpenSCAD/libraries" ;;
  MINGW*|MSYS*|CYGWIN*) ulib="$USERPROFILE/Documents/OpenSCAD/libraries" ;;
  *) ulib="${XDG_DATA_HOME:-$HOME/.local/share}/OpenSCAD/libraries" ;;
esac
mkdir -p "$ulib"
if [ -e "$ulib/armenscad" ] && [ ! -L "$ulib/armenscad" ]; then echo "$ulib/armenscad exists and is not a symlink; move it aside first"; exit 1; fi
ln -sfn "$here/lib/armenscad" "$ulib/armenscad"
echo "linked $ulib/armenscad -> $here/lib/armenscad"
