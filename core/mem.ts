// In-memory host for tests: files in a Map, OpenSCAD replaced by a function that writes whatever STL it likes.
import path from 'node:path';
import type { Builder, Files, Host } from './io.ts';

const enc = new TextEncoder();
export function memFiles(init: Record<string, string> = {}): Files & { data: Map<string, Uint8Array> } {
  const data = new Map(Object.entries(init).map(([k, v]) => [k, enc.encode(v)]));
  return {
    data,
    async read(p) { return data.get(p) ?? null; },
    async write(p, d) { data.set(p, typeof d === 'string' ? enc.encode(d) : d); },
    async size(p) { return data.get(p)?.length ?? null; },
    async list(dir) { return [...data.keys()].filter((k) => path.dirname(k) === dir).map((k) => path.basename(k)); },
    async remove(p) { data.delete(p); },
  };
}

// render(scad text) -> triangle count to write (0: no file, like OpenSCAD on an empty result)
export function memBuilder(files: Files & { data: Map<string, Uint8Array> }, tris: (scad: string) => number = () => 1): Builder & { runs: string[] } {
  const runs: string[] = [];
  return {
    id: 'mem', runs,
    async render(scad, out) {
      const text = new TextDecoder().decode(files.data.get(scad)!);
      runs.push(text);
      const n = tris(text);
      if (n > 0) files.data.set(out, new Uint8Array(84 + 50 * n));
      return { code: 0, output: n > 0 ? '' : 'WARNING: Current top level object is empty.' };
    },
  };
}

export function memHost(init: Record<string, string> = {}, tris?: (scad: string) => number) {
  const files = memFiles(init);
  const builder = memBuilder(files, tris);
  const host: Host = { files, builder, libPath: ['/lib'] };
  return { host, files, builder };
}
