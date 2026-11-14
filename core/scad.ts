// The OpenSCAD the core writes: the per-part harness it builds from. A plain file a person could have typed.

// A define's value as OpenSCAD source: a string is taken as written (an expression), anything else as JSON.
export const fmt = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
export const assignments = (defines: Record<string, unknown>) =>
  Object.entries(defines).map(([k, v]) => `${k} = ${fmt(v)};`).join('\n');

// include <file>; <assignments>; <call>. The last assignment wins file-wide in OpenSCAD, so values computed from
// an overridden one recompute.
export function harness(scadPath: string, defines: Record<string, unknown>, call: string): string {
  return `include <${scadPath}>\n${assignments(defines)}\n${call}\n`;
}
