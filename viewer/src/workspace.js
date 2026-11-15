// The workspace as the front page shows it: projects (top-level folders), and inside each its models in the order
// you would open them. Pure: /api/workspace's models in, a tree out.
//
//   project     the first folder of a model's path (devastator, gi_joe); a project of one model is just that model
//   direct      models in the project folder or one below it (devastator/hip): assemblies first (a scene that uses
//               other folders: the way in), then the rest, then reference-only models (every part a reference mesh)
//   group       a subfolder holding models two below the project (devastator/ports/thigh): one foldable line,
//               folded while the project has direct models (ports, toys), open when the groups are all there is
//   usedBy      the models whose scenes use this one
const seg = (name) => name.split('/');
const rank = (m) => (m.assembly ? 0 : m.reference ? 2 : 1);

export function workspaceTree(models) {
  const usedBy = new Map();
  for (const m of models) for (const u of m.uses ?? []) { if (!usedBy.has(u)) usedBy.set(u, []); usedBy.get(u).push(m.name); }
  const projects = new Map();
  for (const m of models) {
    const s = seg(m.name), p = s[0];
    if (!projects.has(p)) projects.set(p, { name: p, direct: [], groups: new Map(), count: 0 });
    const proj = projects.get(p);
    proj.count++;
    const row = { ...m, short: s.slice(1).join('/') || s[0], usedBy: usedBy.get(m.name) ?? [] };
    if (s.length <= 2) { proj.direct.push(row); continue; }
    const g = s[1];
    if (!proj.groups.has(g)) proj.groups.set(g, { name: g, path: `${p}/${g}`, models: [] });
    proj.groups.get(g).models.push({ ...row, short: s.slice(2).join('/') });
  }
  return [...projects.values()].map((proj) => {
    const direct = proj.direct.map((m, i) => [m, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([m]) => m);
    const groups = [...proj.groups.values()].map((g) => ({ ...g, reference: g.models.every((m) => m.reference), folded: direct.length > 0 }));
    return { name: proj.name, count: proj.count, direct, groups, single: proj.count === 1 ? (direct[0] ?? groups[0].models[0]) : null };
  });
}
// a model's name as another model of the same project says it (hip), else in full (gi_joe/whale/shroud)
export const shortFor = (name, project) => (name.startsWith(`${project}/`) ? name.slice(project.length + 1) : name);
