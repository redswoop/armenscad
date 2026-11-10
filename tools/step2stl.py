#!/usr/bin/env -S uv run --quiet --python 3.12 --with cadquery-ocp python
"""step2stl: tessellate a STEP file into one binary STL per solid (plus a merged one).

    armenscad step2stl file.step outdir [--tol 0.02] [--ang 0.2] [--merged]

Prints, per solid, its name (STEP PRODUCT / shape label when present), bounding box, volume
and the file written. Bodies keep the STEP's own frame so they overlay a port built in it.
Needs OpenCascade via the cadquery-ocp wheel; the shebang pulls it with uv.
"""
import argparse, os, re, sys

from OCP.STEPControl import STEPControl_Reader
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString
from OCP.XCAFDoc import XCAFDoc_DocumentTool
from OCP.TDF import TDF_Label
from OCP.collections import Sequence_TDF_Label as TDF_LabelSequence
from OCP.TDataStd import TDataStd_Name
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_SOLID
from OCP.TopoDS import TopoDS
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.StlAPI import StlAPI_Writer
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.TopoDS import TopoDS_Compound
from OCP.BRep import BRep_Builder


def label_name(label):
    n = TDataStd_Name()
    if label.FindAttribute(TDataStd_Name.GetID_s(), n):
        return n.Get().ToExtString()
    return ""


def load(path):
    """Return [(name, solid)] using XCAF so body names survive; falls back to plain reader."""
    doc = TDocStd_Document(TCollection_ExtendedString("step"))
    r = STEPCAFControl_Reader()
    r.SetNameMode(True)
    if r.ReadFile(path) != 1:
        sys.exit(f"cannot read {path}")
    r.Transfer(doc)
    st = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    labels = TDF_LabelSequence()
    st.GetFreeShapes(labels)
    out = []

    def walk(label, prefix, loc):
        name = label_name(label) or prefix
        if st.IsAssembly_s(label):
            kids = TDF_LabelSequence()
            st.GetComponents_s(label, kids)
            for i in range(1, kids.Length() + 1):
                k = kids.Value(i)
                ref = TDF_Label()
                st.GetReferredShape_s(k, ref)
                walk(ref if not ref.IsNull() else k, label_name(k) or name, loc.Multiplied(st.GetLocation_s(k)))
            return
        shape = st.GetShape_s(label).Moved(loc)
        exp = TopExp_Explorer(shape, TopAbs_SOLID)
        i = 0
        while exp.More():
            out.append((name if i == 0 else f"{name}_{i}", exp.Current()))
            i += 1
            exp.Next()

    from OCP.TopLoc import TopLoc_Location
    for i in range(1, labels.Length() + 1):
        walk(labels.Value(i), f"body{i}", TopLoc_Location())
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("step")
    ap.add_argument("outdir")
    ap.add_argument("--tol", type=float, default=0.02, help="linear deflection mm")
    ap.add_argument("--ang", type=float, default=0.2, help="angular deflection rad")
    ap.add_argument("--merged", action="store_true", help="also write all bodies in one STL")
    a = ap.parse_args()
    os.makedirs(a.outdir, exist_ok=True)
    bodies = load(a.step)
    if not bodies:
        sys.exit("no solids")
    w = StlAPI_Writer()
    w.ASCIIMode = False
    seen = {}
    comp = TopoDS_Compound(); BRep_Builder().MakeCompound(comp)
    for name, s in bodies:
        base = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_") or "body"
        seen[base] = seen.get(base, 0) + 1
        if seen[base] > 1:
            base = f"{base}_{seen[base]}"
        BRepMesh_IncrementalMesh(s, a.tol, False, a.ang, True)
        bb = Bnd_Box(); BRepBndLib.Add_s(s, bb)
        c0, c1 = bb.CornerMin(), bb.CornerMax()
        x0, y0, z0, x1, y1, z1 = c0.X(), c0.Y(), c0.Z(), c1.X(), c1.Y(), c1.Z()
        gp = GProp_GProps(); BRepGProp.VolumeProperties_s(s, gp)
        path = os.path.join(a.outdir, base + ".stl")
        w.Write(s, path)
        BRep_Builder().Add(comp, s)
        print(f"{base:32s} vol {gp.Mass():9.2f} mm3  size [{x1-x0:.2f}, {y1-y0:.2f}, {z1-z0:.2f}]  "
              f"bbox [{x0:.2f}, {y0:.2f}, {z0:.2f}]..[{x1:.2f}, {y1:.2f}, {z1:.2f}]  -> {path}")
    if a.merged:
        p = os.path.join(a.outdir, "_all.stl"); w.Write(comp, p); print("merged ->", p)


if __name__ == "__main__":
    main()
