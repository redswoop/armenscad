// Reference images: <model>/ref/*.jpeg|png|webp|gif, captions from ref/index.json. A thumbnail grid in the
// sidebar, a lightbox over the stage, and a "place as overlay" hook that overlay.js fills in.
import { getRefs, refUrl } from './api.js';

const $ = (s) => document.querySelector(s);
export let refs = [];
let placeHandler = null;
export const onPlace = (fn) => { placeHandler = fn; };
export const findRef = (name) => refs.find((r) => r.name === name) ?? null;

export async function loadRefs() {
  refs = await getRefs().catch(() => []);
  const g = $('#gallery');
  g.innerHTML = refs.length
    ? refs.map((r) => `<figure data-name="${r.name}" title="${(r.caption ?? r.name).replace(/"/g, '&quot;')}"><img loading="lazy" src="${refUrl(r.name)}" alt=""><figcaption>${r.name}</figcaption></figure>`).join('')
    : '<div class="muted">no images in ref/ yet — drop photos, tracings and scans there</div>';
  for (const f of g.querySelectorAll('figure')) f.onclick = () => openLightbox(f.dataset.name);
  $('#ref-count').textContent = refs.length ? `${refs.length}` : '';
  console.log(`[viewer] refs ${refs.length}`);
}
$('#refs-reload').onclick = loadRefs;

export function openLightbox(name) {
  const r = findRef(name); if (!r) return;
  $('#lb-title').textContent = r.name;
  $('#lb-img').src = refUrl(r.name);
  $('#lb-cap').textContent = [r.caption, r.view ? `view ${r.view}` : null, r.scale ? `scale: ${r.scale.mm} mm between the two marked pixels` : null].filter(Boolean).join(' · ');
  $('#lb-place').hidden = !placeHandler;
  $('#lb-place').onclick = () => { closeLightbox(); placeHandler?.(r); };
  $('#lightbox').hidden = false;
}
export function closeLightbox() { $('#lightbox').hidden = true; }
$('#lb-close').onclick = closeLightbox;
