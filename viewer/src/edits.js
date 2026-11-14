// Scene edits from the viewer: the one SceneHistory (history.js) wired to the server (api.js) and to what is shown
// (parts.js), the selected instance, and a line under the status for what an edit did or why it did not.
// Every scene state the page takes (load, SSE 'scene', a reload) reaches history.observe through the bus's 'parts'.
import { getScene, putScene, patchInstance } from './api.js';
import { sceneState, setScene, getSelection, groupMembers, meshes } from './parts.js';
import { bus } from './scene.js';
import { SceneHistory } from './history.js';

const $ = (s) => document.querySelector(s);

export const history = new SceneHistory({
  current: () => sceneState(),
  reload: async () => { const st = await getScene(); setScene(st); return st; },
  put: (scene, base) => putScene(scene, base).catch((e) => ({ error: String(e.message ?? e) })),
  patch: (id, fields, base) => patchInstance(id, fields, base).catch((e) => ({ error: String(e.message ?? e) })),
});
bus.addEventListener('parts', () => {
  const e = history.observe(sceneState());
  if (e) say(`${e.label} (ctrl-z steps back over it)`);
});
history.onChange = () => bus.dispatchEvent(new Event('history'));

// ---------- the selected instance ----------
// A part's placement belongs to its instance, so selecting one part of an instance (or a group whose members are all
// one instance's) selects that instance for moving and the panel. Paths are instance.part; ids have no dots.
const instOf = (path) => meshes.get(path)?.userData.placed?.instance ?? path.split('.')[0];
export function selectedInstance() {
  const { part, group } = getSelection();
  if (part) return instOf(part);
  if (group) { const ids = new Set(groupMembers(group).map(instOf)); return ids.size === 1 ? [...ids][0] : null; }
  return null;
}
// the instance as scene.json has it (what the panel shows and an edit starts from)
export const instanceData = (id) => sceneState()?.scene?.instances?.find((x) => x.id === id) ?? null;
export const sceneOk = () => !!sceneState()?.scene && !sceneState()?.errors?.length;

// ---------- messages: one line under the status ----------
let timer = 0;
export function say(text, bad = false) {
  const el = $('#edit-msg'); if (!el) return;
  clearTimeout(timer);
  el.textContent = text; el.classList.toggle('bad', bad); el.hidden = !text;
  if (text) timer = setTimeout(() => { el.hidden = true; }, bad ? 15000 : 5000);
  (bad ? console.warn : console.log)(`[viewer] ${text}`);
}

// undo / redo, with what they did said
export async function undo() { report(await history.undo(), 'undo'); }
export async function redo() { report(await history.redo(), 'redo'); }
function report(r, what) {
  if (r.ok) say(`${what === 'undo' ? 'undone' : 'redone'}: ${r.entry.label}`);
  else if (r.entry || r.conflict) say(`${what}: ${r.error}`, true);
  else say(r.error);
}
