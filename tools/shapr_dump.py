#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["msgpack"]
# ///
"""Read a Shapr3D .shapr file directly: sketches (mm) and the history tree with op parameters.

usage: shapr_dump.py FILE.shapr [sketches|history|names|all] [--json]

A .shapr is a zip holding `.metadata` (JSON) and `workspace` (SQLite).
  SketchControllers : sketch name + plane (center, normal, U direction), metres
  SketchCurves.Data : JSON, metres; type 0 line, 1 arc, 2 circle
  HistoryTreeNodes  : Properties is MessagePack. type 0 root [ordered op ids];
                      type 2 op [ver, ver, name, opName, [param node ids]];
                      type 3 param [[[kind, payload]]] with kind 12 measure [[unit, 1], v]
                      (unit 1 metre, 2 radian), 9 list of refs, 7 name ref, 10 sketch ref,
                      1 bool, 2 enum, 0 none.
  HistoryNames      : NameID -> Type + JSON Data (bodies, faces, edges the ops refer to)
Verified against Shapr3D 26.91 (HistoryVersion 87).
"""
import json, sqlite3, sys, tempfile, zipfile, os, math
import msgpack

MM = 1000.0
SCALE_KEYS = {"x", "y", "z", "radius", "length", "width", "height", "majorRadius", "minorRadius"}
CURVE_TYPES = {0: "line", 1: "arc", 2: "circle", 3: "ellipse", 4: "spline"}

def mm(obj):
    """Scale every length-like number from metres to mm, recursively."""
    if isinstance(obj, dict):
        return {k: (round(v * MM, 4) if k in SCALE_KEYS and isinstance(v, (int, float)) else mm(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [mm(v) for v in obj]
    return obj

def open_workspace(path):
    tmp = tempfile.mkdtemp(prefix="shapr_")
    with zipfile.ZipFile(path) as z:
        z.extractall(tmp)
    meta = json.load(open(os.path.join(tmp, ".metadata")))
    return sqlite3.connect(os.path.join(tmp, "workspace")), meta

def sketches(c):
    out = []
    for sid, name, hidden, order, cx, cy, cz, nx, ny, nz, ux, uy, uz in c.execute(
            "select SketchID, Name, IsHidden, OrderInList, PlaneCenterX, PlaneCenterY, PlaneCenterZ, "
            "PlaneNormX, PlaneNormY, PlaneNormZ, PlaneUDirX, PlaneUDirY, PlaneUDirZ from SketchControllers order by SketchID"):
        curves = []
        for cid, data in c.execute("select CurveID, Data from SketchCurves where SketchID=? order by CurveID", (sid,)):
            d = json.loads(data)
            d["kind"] = CURVE_TYPES.get(d.get("type"), f"type{d.get('type')}")
            curves.append({"id": cid, **mm(d)})
        out.append({"id": sid, "name": name, "hidden": bool(hidden),
                    "plane": {"center": [cx * MM, cy * MM, cz * MM], "normal": [nx, ny, nz], "u": [ux, uy, uz]},
                    "curves": curves})
    return out

def decode_param(p, names, sketch_names):
    """One parameter node payload -> readable value."""
    def one(kind, payload=None):
        if kind == 12:
            (unit, _), v = payload
            if unit == 2:
                return f"{math.degrees(v):.4g} deg"
            return f"{v * MM:.4g} mm"
        if kind == 10: return f"sketch {payload} ({sketch_names.get(payload, '?')})"
        if kind == 7:  return f"name {payload} ({names.get(payload, '?')})"
        if kind == 9:  return [one(*item[0]) if isinstance(item, list) and item and isinstance(item[0], list) else item for item in payload]
        if kind == 1:  return bool(payload)
        if kind == 2:  return f"enum {payload}"
        if kind == 0:  return None
        return {"kind": kind, "payload": payload}
    try:
        return [one(*entry) for entry in p[0]] if p and p[0] else None
    except Exception:
        return {"raw": p}

def name_table(c):
    names = {}
    for nid, typ, data, ver in c.execute("select NameID, Type, Data, Version from HistoryNames"):
        try:
            d = json.loads(data)
        except Exception:
            d = {}
        short = {k: d[k] for k in ("bodyID", "qualifier", "identifier") if k in d and d[k] is not None}
        names[nid] = f"type {typ} {short}" if short else f"type {typ}"
    return names

def history(c):
    nodes = {}
    for nid, typ, props in c.execute("select HistoryTreeNodeID, HistoryTreeNodeType, Properties from HistoryTreeNodes"):
        nodes[nid] = (typ, msgpack.unpackb(props, raw=False, strict_map_key=False) if props else None)
    roots = [n for n, (t, _) in nodes.items() if t == 0]
    names = name_table(c)
    sketch_names = {sid: nm for sid, nm in c.execute("select SketchID, Name from SketchControllers")}
    ops = []
    for root in roots:
        for oid in nodes[root][1][0]:
            typ, p = nodes[oid]
            if typ != 2:
                continue
            params = []
            for pid in p[4]:
                ptyp, pp = nodes.get(pid, (None, None))
                params.append({"id": pid, "value": decode_param(pp, names, sketch_names) if ptyp == 3 else pp})
            ops.append({"id": oid, "name": p[2], "op": p[3], "params": params})
    return ops

def settings(c):
    return {k: v for _, k, v in c.execute("select * from Settings") if k in
            ("HistoryVersion", "Create_Date", "Latest_Date", "SchemaVersion", "Persistence_SaveTimestamp")}

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    as_json = "--json" in sys.argv
    if not args:
        print(__doc__); sys.exit(1)
    c, meta = open_workspace(args[0])
    what = args[1] if len(args) > 1 else "all"
    out = {"file": args[0], "metadata": meta, "settings": settings(c)}
    if what in ("sketches", "all"): out["sketches"] = sketches(c)
    if what in ("history", "all"):  out["history"] = history(c)
    if what == "names":             out["names"] = name_table(c)
    if as_json:
        print(json.dumps(out, indent=1, default=str)); return
    print(f"{args[0]}  {out['settings']}")
    for s in out.get("sketches", []):
        pl = s["plane"]
        print(f"\n== {s['name']} (id {s['id']}{', hidden' if s['hidden'] else ''})  centre {pl['center']} normal {pl['normal']} u {pl['u']}")
        for cv in s["curves"]:
            d = {k: v for k, v in cv.items() if k not in ("id", "type", "kind")}
            print(f"   {cv['kind']:7s} {json.dumps(d)}")
    for op in out.get("history", []):
        print(f"\n== {op['name']}  [{op['op']}]  node {op['id']}")
        for p in op["params"]:
            if p["value"] not in (None, [], "enum 0", False):
                print(f"   {p['value']}")
    if what == "names":
        for k, v in out["names"].items(): print(k, v)

if __name__ == "__main__":
    main()
