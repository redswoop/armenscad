// used by tools/slice.sh: projection(cut = true) of an imported STL at a plane
f = ""; rot = [0, 0, 0]; off = [0, 0, 0];
projection(cut = true) rotate(rot) translate(off) import(f);
