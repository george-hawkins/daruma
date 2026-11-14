import { load, save, onSaveError } from './store.js';
import { SyncedDoc, Syncer } from './sync.js';
import {
  parseList, serializeList, emptyList, mergeList3, upgradeList,
  parseSections, serializeSections, emptySections, mergeSections3, upgradeSections,
} from './markdown.js';
import { initKanji } from './kanji.js';
import { initCorrections } from './corrections.js';
import { initRtk } from './rtk.js';
import { RtkSource } from './rtksource.js';
import { initSettings } from './settings.js';
import { notify, showHelp, hashFor, parseHash } from './ui.js';

const kanjiDoc = new SyncedDoc('kanji', {
  urlKey: 'forgottenUrl', empty: emptyList, parse: parseList, serialize: serializeList, merge3: mergeList3, format: 2, upgrade: upgradeList,
  count: (d) => d.items.length,
});
const correctionsDoc = new SyncedDoc('corrections', {
  urlKey: 'correctionsUrl', empty: emptySections, parse: parseSections, serialize: serializeSections, merge3: mergeSections3, format: 2, upgrade: upgradeSections,
  count: (d) => d.corrections.length + d.maybe.length + d.done.length,
});

// Read-only: the RTK keyword index and Anki deck, from another repo.
const rtkSource = new RtkSource();
let rtkPage = null; // shows "fetching…" until the first sync, so it's told about each one

onSaveError((e) => notify(`Couldn't save on this device (${e.name}). Changes are kept while the app is open, and pushed to GitHub when it syncs.`, null, 10000));

const statusBtn = document.getElementById('sync-status');
// Line icons: a cloud plus a state mark.
const CLOUD = 'M7.5 19h9.5a4.5 4.5 0 0 0 .9-8.9A6 6 0 0 0 6.3 9.6 4.75 4.75 0 0 0 7.5 19z';
const MARKS = {
  ok: 'M9.4 14.3l1.9 1.9 3.7-3.9',
  pending: 'M12 16.8v-5M9.8 13.8L12 11.6l2.2 2.2',
  syncing: 'M12 16.8v-5M9.8 13.8L12 11.6l2.2 2.2',
  offline: 'M4.5 4.5l15 15',
  off: 'M4.5 4.5l15 15',
  error: 'M12 11.4v3M12 17v.01',
};
const icon = (state) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${CLOUD}"/><path d="${MARKS[state]}"/></svg>`;
let statusLabel = '';
const syncer = new Syncer([kanjiDoc, correctionsDoc], {
  sources: [rtkSource],
  notify,
  onStatus(state, label) {
    rtkPage?.refresh();
    statusBtn.innerHTML = icon(state);
    statusBtn.className = `icon-btn ${state}`;
    statusBtn.title = statusLabel = label;
    statusBtn.setAttribute('aria-label', label);
  },
});
statusBtn.addEventListener('click', () => {
  notify(statusLabel);
  syncer.sync({ force: true });
});
document.getElementById('help-btn').addEventListener('click', () => showHelp(document.getElementById('help')));

const pages = {
  kanji: initKanji(kanjiDoc),
  corrections: initCorrections(correctionsDoc),
  rtk: (rtkPage = initRtk(rtkSource)),
  settings: initSettings(syncer),
};

// The URL hash says what's shown (#kanji, #corrections, #settings, #rtk, or
// #rtk/可 for a card), so a refresh or a bookmark comes back to it. Without a
// hash (e.g. opened from the home screen) the last page shown is used.
// Switching tabs replaces the hash rather than adding history entries; the
// RTK page pushes one when a card is opened, so the back gesture closes it.
// `arg` is what's shown on the page (an RTK card); by default whatever the
// page is showing already.
function show(name, arg = pages[name]?.current?.() ?? '') {
  if (!pages[name]) name = 'kanji';
  for (const p of Object.keys(pages)) document.getElementById(`page-${p}`).classList.toggle('active', p === name);
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.page === name);
  save('page', name);
  pages[name].onShow?.(arg);
  const hash = hashFor(name, pages[name].current?.() ?? '');
  if (location.hash !== hash) history.replaceState(history.state, '', hash);
}
const route = () => {
  const { page, arg } = parseHash();
  if (pages[page]) show(page, arg);
  return Boolean(pages[page]);
};
for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => show(t.dataset.page));
window.addEventListener('popstate', route); // back/forward, or a hash typed in
if (!route()) show(load('page', 'kanji'));

navigator.storage?.persist?.();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
syncer.start();
