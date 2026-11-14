// The two things the core asks of its host: files, and OpenSCAD runs. bun.ts implements them on the disk and the
// native binary; mem.ts in memory for tests. The core's logic never touches the disk or spawns a process itself,
// so it can later run where neither exists (a browser, with OpenSCAD as WASM).

export interface Files {
  read(path: string): Promise<Uint8Array | null>;              // null when the file does not exist
  write(path: string, data: string | Uint8Array): Promise<void>; // atomic (tmp + rename); makes missing folders
  size(path: string): Promise<number | null>;
  list(dir: string): Promise<string[]>;                         // file names (not folders) in dir; [] when absent
  remove(path: string): Promise<void>;
}

export interface Builder {
  id: string;                                                    // goes into every cache key (the OpenSCAD binary)
  render(scad: string, out: string): Promise<{ code: number; output: string }>;  // scad file -> binary STL at out
}

export interface Host {
  files: Files;
  builder: Builder;
  libPath: string[];   // where `use <armenscad/...>` resolves (OPENSCADPATH), for the cache key's dependencies
}

const dec = new TextDecoder();
export async function readText(files: Files, p: string): Promise<string | null> {
  const b = await files.read(p);
  return b && dec.decode(b);
}
