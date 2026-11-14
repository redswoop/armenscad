// Reading a model's .scad without running it: the parameter block, a module's source, the files it pulls in.
import path from 'node:path';
import type { Files } from './io.ts';

export interface Param { section: string; name: string; value: string; comment: string; line: number }

// The top-of-file assignments, grouped by `// ---- section ----` headers; stops at the first module.
export function parseParams(src: string): Param[] {
  const params: Param[] = [];
  let section = 'parameters';
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*module\s+\w+\s*\(/.test(line)) break;   // only the top-of-file block
    const sec = line.match(/^\/\/\s*-{3,}\s*(.+?)\s*-{3,}/);
    if (sec) { section = sec[1]; continue; }
    if (!/^\w+\s*=/.test(line)) continue;
    const comment = (line.match(/\/\/\s*(.*)$/)?.[1] ?? '').trim();
    const code = line.replace(/\/\/.*$/, '');
    for (const m of code.matchAll(/(\w+)\s*=\s*([^;]+);/g))
      if (m[1] !== '$fn') params.push({ section, name: m[1], value: m[2].trim(), comment, line: i + 1 });
  }
  return params;
}

const BUILTIN = new Set('translate rotate mirror scale cube cylinder sphere polygon circle square linear_extrude rotate_extrude hull minkowski difference union intersection offset import color for if let echo children projection resize multmatrix render surface text polyhedron'.split(' '));
// the module plus every user module it calls, depth-first, each once
export function moduleSources(src: string, name: string, seen = new Set<string>()): { name: string; code: string; line: number }[] {
  if (seen.has(name)) return [];
  seen.add(name);
  const m = moduleSource(src, name);
  if (!m) return [];
  const out = [{ name, ...m }];
  for (const c of m.code.matchAll(/\b([a-zA-Z_]\w*)\s*\(/g))
    if (!BUILTIN.has(c[1]) && c[1] !== name) out.push(...moduleSources(src, c[1], seen));
  return out;
}
function moduleSource(src: string, name: string) {
  const re = new RegExp(`^[ \\t]*module\\s+${name}\\s*\\(`, 'm');
  const m = re.exec(src);
  if (!m) return null;
  // pull leading comment lines
  const before = src.slice(0, m.index).split('\n');
  let k = before.length - 2;
  while (k >= 0 && /^\s*\/\//.test(before[k])) k--;
  const commentStart = before.slice(0, k + 1).join('\n').length + (k >= 0 ? 1 : 0);
  // brace match
  let i = src.indexOf('{', m.index), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  const startLine = src.slice(0, commentStart).split('\n').length;
  return { code: src.slice(commentStart, i + 1), line: startLine };
}

// Every file a .scad depends on, with its content: itself, what it include<>s and use<>s (resolved the way
// OpenSCAD does: next to the including file, then the library path), recursively, and data files named by a
// literal import("...") or surface("..."). Feeds the cache key, so an edit anywhere in that tree rebuilds.
// A name that resolves nowhere is listed with null content, so creating it later changes the key too.
export async function dependencies(files: Files, file: string, libPath: string[]): Promise<{ path: string; data: Uint8Array | null }[]> {
  const out: { path: string; data: Uint8Array | null }[] = [];
  const seen = new Set<string>();
  const visit = async (p: string) => {
    if (seen.has(p)) return;
    seen.add(p);
    const data = p.startsWith('<') ? null : await files.read(p);
    out.push({ path: p, data });
    if (!data || !p.endsWith('.scad')) return;
    const src = new TextDecoder().decode(data).replace(/\/\/.*$/gm, '');
    const dir = path.dirname(p);
    for (const m of src.matchAll(/\b(?:include|use)\s*<([^>]+)>/g)) {
      let found = null;
      for (const base of [dir, ...libPath]) {
        const c = path.resolve(base, m[1]);
        if ((await files.size(c)) !== null) { found = c; break; }
      }
      await visit(found ?? `<${m[1]}>`);
    }
    for (const m of src.matchAll(/\b(?:import|surface)\s*\(\s*(?:file\s*=\s*)?"([^"]+)"/g)) await visit(path.resolve(dir, m[1]));
  };
  await visit(file);
  return out;
}
