// The core's host on this machine: Bun's filesystem and the native OpenSCAD binary.
import path from 'node:path';
import { mkdir, rename, rm, readdir, stat, writeFile, readFile } from 'node:fs/promises';
import type { Builder, Files, Host } from './io.ts';

// use <armenscad/...> resolves against the workbench's lib/ wherever the workspace is
export const LIB = path.join(import.meta.dir, '..', 'lib');
export const OPENSCAD = process.env.OPENSCAD ?? Bun.which('openscad') ?? '/opt/homebrew/bin/openscad';
export const OPENSCADPATH = process.env.OPENSCADPATH ? `${LIB}:${process.env.OPENSCADPATH}` : LIB;

let tmpSeq = 0;
export const bunFiles: Files = {
  async read(p) {
    try { return new Uint8Array(await readFile(p)); }
    catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }
  },
  async write(p, data) {
    await mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.${++tmpSeq}.tmp`;     // unique, so two writers never share a tmp file
    await writeFile(tmp, data);
    await rename(tmp, p);
  },
  async size(p) { try { return (await stat(p)).size; } catch { return null; } },
  async list(dir) {
    try { return (await readdir(dir, { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name); }
    catch { return []; }
  },
  async remove(p) { await rm(p, { force: true }); },
};

export function openscadBuilder(bin = OPENSCAD): Builder {
  const env = { ...process.env, OPENSCADPATH };
  return {
    id: bin,
    async render(scad, out) {
      const proc = Bun.spawn([bin, '--backend', 'Manifold', '--export-format', 'binstl', '-o', out, scad], { stderr: 'pipe', stdout: 'pipe', env });
      const [err, outp] = await Promise.all([new Response(proc.stderr).text(), new Response(proc.stdout).text()]);
      return { code: await proc.exited, output: err + outp };
    },
  };
}

export const bunHost = (bin = OPENSCAD): Host => ({ files: bunFiles, builder: openscadBuilder(bin), libPath: OPENSCADPATH.split(':') });

// Say so up front if OpenSCAD is missing or too old: otherwise every part just shows as failed.
export async function checkOpenscad(bin = OPENSCAD): Promise<{ ok: boolean; message: string }> {
  try {
    const p = Bun.spawn([bin, '--version'], { stderr: 'pipe', stdout: 'pipe' });
    const v = ((await new Response(p.stderr).text()) + (await new Response(p.stdout).text())).trim();
    const year = +(v.match(/(\d{4})\.\d+/)?.[1] ?? 0);
    if (year && year < 2024) return { ok: false, message: `[openscad] ${bin} is ${v}: too old for --backend Manifold. Install a development snapshot (macOS: brew install --cask openscad@snapshot) or point OPENSCAD at one.` };
    return { ok: true, message: `[openscad] ${bin} (${v})` };
  } catch {
    return { ok: false, message: `[openscad] cannot run "${bin}". Install an OpenSCAD development snapshot and put it on PATH, or set OPENSCAD=/path/to/openscad.` };
  }
}
