// The read-only RTK files (keyword index and Anki deck) from another GitHub
// repo. They're kept on the device and checked for changes only when asked
// (the sync icon, Settings) or when the last check is more than MAX_AGE old.
// Checks send the ETag of the copy we have, so an unchanged file costs a 304.

import { load, save } from './store.js';
import { parseGitHubUrl, getRaw } from './github.js';
import { getSettings } from './settings.js';
import { buildIndex } from './rtkdata.js';

const MAX_AGE = 6 * 60 * 60_000;
const FILES = [['keywords', 'rtkKeywordsUrl'], ['deck', 'rtkDeckUrl']];

export class RtkSource {
  constructor() {
    this.name = 'rtk';
    // state: { files: { keywords: { url, etag, text }, deck: … }, checked }
    this.state = load('rtk', null) ?? { files: {}, checked: 0 };
    this.result = null; // { time, text } describing the last check
    this.listeners = [];
    this.cached = null;
  }

  on(fn) { this.listeners.push(fn); }

  configured(s = getSettings()) {
    return FILES.every(([, key]) => parseGitHubUrl(s[key]));
  }

  // The parsed files, rebuilt only when their text has changed.
  get index() {
    const { keywords, deck } = this.state.files;
    const key = `${keywords?.etag}|${deck?.etag}|${keywords?.text?.length}|${deck?.text?.length}`;
    if (this.cached?.key !== key) this.cached = { key, index: buildIndex(keywords?.text, deck?.text) };
    return this.cached.index;
  }

  get loaded() { return Boolean(this.state.files.keywords?.text); }

  // Checks GitHub if forced, if a URL has changed or if the last check is
  // stale. Returns a description of what happened, or null if nothing was done.
  async refresh({ force = false } = {}) {
    const s = getSettings();
    if (!this.configured(s)) return null;
    const urlChanged = FILES.some(([name, key]) => this.state.files[name]?.url !== s[key]);
    if (!force && !urlChanged && Date.now() - this.state.checked < MAX_AGE) return null;

    const fetched = await Promise.all(FILES.map(async ([name, key]) => {
      const url = s[key];
      const old = this.state.files[name];
      const r = await getRaw(parseGitHubUrl(url), s.rtkToken, old?.url === url && old.text ? old.etag : null);
      const file = url.split('/').pop();
      if (!r) throw new Error(`${file} not found (or the token can't read it)`);
      return [name, r.unchanged ? old : { url, etag: r.etag, text: r.text }, r.unchanged ? null : file];
    }));
    const changed = fetched.map(([, , f]) => f).filter(Boolean);
    for (const [name, f] of fetched) this.state.files[name] = f;
    this.state.checked = Date.now();
    save('rtk', this.state);
    if (changed.length) this.listeners.forEach((fn) => fn());
    this.result = { time: new Date(), text: changed.length ? `fetched ${changed.join(' and ')}` : 'up to date' };
    return this.result.text;
  }

  fail(e) { this.result = { time: new Date(), text: `failed: ${e.message}` }; }

  details() {
    const s = getSettings();
    const { rows, cards } = this.index;
    return [
      `rtk (read-only): ${rows.length} keywords and ${cards.length} cards on this device`,
      `  keywords file: ${s.rtkKeywordsUrl || '(not set)'}`,
      `  cards file: ${s.rtkDeckUrl || '(not set)'}`,
      `  last checked: ${this.state.checked ? new Date(this.state.checked).toLocaleString() : 'never'} (checked every 6 hours, or when you tap the cloud)`,
      `  last check: ${this.result ? `${this.result.time.toLocaleTimeString()}: ${this.result.text}` : 'not since the app was opened'}`,
    ].join('\n');
  }
}
