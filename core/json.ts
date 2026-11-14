// Pretty JSON, but arrays of numbers (points, poses, colours) stay on one line so a coordinate is one greppable
// line and the file stays short. Applied to the innermost arrays first, then to arrays of those.
// Shared by annotations.json and scene.json, so both read the same in a diff.
export function compactJson(doc: unknown): string {
  let s = JSON.stringify(doc, null, 2);
  const scalar = /\[\s*((?:-?\d+(?:\.\d+)?(?:e[-+]?\d+)?|null|true|false)(?:,\s*(?:-?\d+(?:\.\d+)?(?:e[-+]?\d+)?|null|true|false))*)\s*\]/g;
  s = s.replace(scalar, (m, inner) => `[${inner.replace(/\s+/g, ' ').replace(/ ,/g, ',')}]`);
  const nested = /\[\s*(\[[^\[\]]*\](?:,\s*\[[^\[\]]*\])*)\s*\]/g;      // [[1, 2], [3, 4]] on one line when short
  s = s.replace(nested, (m, inner) => { const one = `[${inner.replace(/\s+/g, ' ')}]`; return one.length <= 100 ? one : m; });
  // flat objects (a hit, a pose) on one line when short
  const flat = /\{\s*("[^"\n]*":\s*(?:"[^"\n]*"|-?\d[\d.e+-]*|null|true|false|\[[^\[\]{}]*\])(?:,\s*"[^"\n]*":\s*(?:"[^"\n]*"|-?\d[\d.e+-]*|null|true|false|\[[^\[\]{}]*\]))*)\s*\}/g;
  s = s.replace(flat, (m, inner) => { const one = `{ ${inner.replace(/\s*\n\s*/g, ' ')} }`; return one.length <= 100 ? one : m; });
  return s + '\n';
}
