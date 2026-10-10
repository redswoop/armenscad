#!/usr/bin/env bash
# Stamp out a new model folder from template/ and make it a git repo.
#   usage: tools/new-model.sh <name> ["one-line description"]
#          tools/new-model.sh <toy>/<name> ["..."]   # assembly inside an existing toy repo
set -e
name="${1:?model name}"; desc="${2:-$name}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="$root/$name"
base="$(basename "$name")"
[ -e "$dest" ] && { echo "$dest exists"; exit 1; }
case "$name" in */*) up="../.." ;; *) up=".." ;; esac
mkdir -p "$(dirname "$dest")"
cp -R "$root/template" "$dest"
mv "$dest/part.scad" "$dest/$base.scad"
for f in "$dest"/*.scad "$dest"/*.json "$dest"/*.sh "$dest"/README.md; do
  sed -i.bak -e "s/MODEL_NAME/$base/g" -e "s/DATE/$(date +%Y-%m-%d)/g" \
            -e "s|<\.\./lib/|<$up/lib/|g" -e "s|\.\./tools/|$up/tools/|g" -e "s|\`\.\./viewer\`|\`$up/viewer\`|g" \
            -e "s|127.0.0.1:5180/$base/|127.0.0.1:5180/$name/|g" "$f" && rm -f "$f.bak"
done
sed -i.bak "s|^# $base\$|# $desc|" "$dest/README.md" && rm -f "$dest/README.md.bak"
# Inside a toy's repo, or a folder the tooling repo tracks (examples/): no new repo.
top="$(git -C "$dest" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -n "$top" ] && { [ "$top" != "$root" ] || ! git -C "$root" check-ignore -q "$dest"; }; then
  echo "created $dest inside the existing repo $top; commit it there."
else
  ( cd "$dest" && git init -q && git add -A && git commit -q -m "New model $name from template" )
  echo "created $dest (git repo, first commit)."
fi
echo "Next: edit $base.scad, then open http://127.0.0.1:5180/$name/ (viewer: cd viewer && bun run dev, if not running)"
