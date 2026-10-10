// Which model, and every call to the API server (proxied by Vite at /api).
// The model is the URL path: http://127.0.0.1:5180/<model>/ or /<toy>/<model>/

export const MODEL = location.pathname.split('/').filter(Boolean).map(decodeURIComponent).join('/');
export const API = `/api/${MODEL}`;

const j = (r) => r.json();
const send = (url, method, body) => fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(j);

export const getModels = () => fetch('/api/models').then(j).catch(() => []);
export const getState = () => fetch(`${API}/state`).then(j);
export const getSource = (module) => fetch(`${API}/source?module=${module}`).then(j);
export const postOverrides = (ov) => send(`${API}/overrides`, 'POST', ov);
export const partUrl = (name, version) => `${API}/parts/${name}.stl?v=${version}`;
export const refStlUrl = () => `${API}/ref`;

// reference images in <model>/ref/
export const getRefs = () => fetch(`${API}/refs`).then(j);
export const refUrl = (name) => `${API}/refs/${encodeURIComponent(name)}`;

// annotations.json: the server owns the file; these return { ok, id?, rev }
export const getAnnotations = () => fetch(`${API}/annotations`).then(j);
export const postAnnotation = (a) => send(`${API}/annotations`, 'POST', a);
export const patchAnnotation = (id, patch) => send(`${API}/annotations/${id}`, 'PATCH', patch);
export const deleteAnnotation = (id) => fetch(`${API}/annotations/${id}`, { method: 'DELETE' }).then(j);
export const putOverlay = (id, o) => send(`${API}/annotations/overlays/${id}`, 'PUT', o);
export const deleteOverlay = (id) => fetch(`${API}/annotations/overlays/${id}`, { method: 'DELETE' }).then(j);

// view: PUT reports what this tab shows; POST asks every tab to move (also what tools/notes view does)
export const reportView = (camera, hidden) => send(`${API}/view`, 'PUT', { camera, hidden });
export const pushView = (v) => send(`${API}/view`, 'POST', v);

// ---------- live updates ----------
// SSE with a watchdog: the server heartbeats every 15 s; if nothing arrives for
// 45 s the connection is dead behind the proxy, so drop it and reconnect.
// handlers: { open, building, built, annotations, view } keyed by event name; each gets the parsed data.
const EVENTS = ['hello', 'ping', 'building', 'built', 'annotations', 'view'];
let es, lastMsg = 0, handlers = {};
export function connect(h) {
  handlers = h;
  reconnect();
  setInterval(() => { if (Date.now() - lastMsg > 45000) { console.warn('[viewer] sse silent, reconnecting'); reconnect(); } }, 10000);
}
function reconnect() {
  if (es) es.close();
  es = new EventSource(`${API}/events`);
  lastMsg = Date.now();
  es.onopen = () => { lastMsg = Date.now(); console.log('[viewer] sse open'); handlers.open?.(); };
  es.onerror = () => console.warn('[viewer] sse error', es.readyState);
  for (const ev of EVENTS) es.addEventListener(ev, (e) => {
    lastMsg = Date.now();
    let data = {}; try { data = JSON.parse(e.data); } catch {}
    handlers[ev]?.(data);
  });
}
