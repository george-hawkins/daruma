import { mergeTimed } from './merge.js';

// Conversion between the Markdown files on GitHub and the app's data.
//
// Items are { text, time }. Within each list, items are grouped under
// "### <UTC timestamp>" headings, newest first; `time` is the heading of the
// item's group ('' for an item above any heading, e.g. one added by hand on
// GitHub). The headings aren't shown in the app, only a darker rule between
// groups. An item arriving at the top of a list (typed in, moved or marked
// done) joins the list's newest group, or starts a new one if that group's
// heading is more than GROUP_GAP old.

const BULLET = /^\s*[*-]\s+(.*)$/;
const GROUP = /^###\s+(.*?)\s*$/;
export const GROUP_GAP = 6 * 60 * 60_000;

const tidy = (t) => t.replace(/\s+/g, ' ').trim();
const clean = (items) => items.map((it) => ({ text: tidy(it.text), time: it.time ?? '' })).filter((it) => it.text);

// e.g. 2026-11-14T12:34:00Z: UTC, to the minute.
export const timestamp = (now = Date.now()) => new Date(now).toISOString().slice(0, 16) + ':00Z';

// A new item for the top of `list`.
export function newItem(list, text, now = Date.now()) {
  let newest = null;
  for (const { time } of list) {
    const t = Date.parse(time);
    if (!Number.isNaN(t) && (newest === null || t > Date.parse(newest))) newest = time;
  }
  const join = newest !== null && now - Date.parse(newest) <= GROUP_GAP;
  return { text, time: join ? newest : timestamp(now) };
}

// Bullets, with ### headings between groups (a group's heading is written
// before its first item; empty groups don't exist).
function writeItems(items) {
  const out = [];
  let time = '';
  for (const it of clean(items)) {
    if (it.time && it.time !== time) out.push('', `### ${it.time}`, '');
    else if (!out.length) out.push('');
    time = it.time;
    out.push(`* ${it.text}`);
  }
  return out;
}

// Data saved by versions before 0.9 has plain strings for items.
const upgradeItems = (items) => (items ?? []).map((it) => (typeof it === 'string' ? { text: it, time: '' } : it));

// forgotten.md: a heading followed by a bullet list (newest first).

export const emptyList = () => ({ header: '# Forgotten kanji', items: [] });

export function parseList(md) {
  const header = [];
  const items = [];
  let time = null; // null until the first group heading or item
  for (const line of md.split(/\r?\n/)) {
    const g = line.match(GROUP);
    const m = line.match(BULLET);
    if (g) time = g[1];
    else if (m) {
      items.push({ text: m[1], time: time ?? '' });
      time ??= '';
    }
    else if (time === null) header.push(line);
  }
  return { header: header.join('\n').trim() || emptyList().header, items: clean(items) };
}

export function serializeList(doc) {
  return [doc.header, ...writeItems(doc.items)].join('\n') + '\n';
}

// Three-way merge (see merge.js); the header can only be changed on GitHub.
export const mergeList3 = (base, local, remote) => ({ header: remote.header, ...mergeTimed(base, local, remote, ['items']) });

export const upgradeList = (doc) => doc && { ...doc, items: upgradeItems(doc.items) };

// corrections.md: "## Corrections", "## Maybe" and "## Done" bullet lists. Any
// text before the first section, and any unknown sections, are kept verbatim.

const SECTIONS = [['corrections', 'Corrections'], ['maybe', 'Maybe'], ['done', 'Done']];
export const SECTION_KEYS = SECTIONS.map(([key]) => key);

export const emptySections = () => ({ preamble: '', corrections: [], maybe: [], done: [], extra: [] });

export function parseSections(md) {
  const doc = emptySections();
  const preamble = [];
  let current = preamble;
  let time = '';
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.*?)\s*$/);
    if (h) {
      const known = SECTIONS.find(([, title]) => title.toLowerCase() === h[1].toLowerCase());
      if (known) {
        current = doc[known[0]];
      } else {
        current = [];
        doc.extra.push({ title: h[1], lines: current });
      }
      time = '';
      continue;
    }
    if (current === preamble || doc.extra.some((x) => x.lines === current)) {
      current.push(line);
    } else {
      const g = line.match(GROUP);
      const m = line.match(BULLET);
      if (g) time = g[1];
      else if (m) current.push({ text: m[1], time });
    }
  }
  doc.preamble = preamble.join('\n').trim();
  for (const key of SECTION_KEYS) doc[key] = clean(doc[key]);
  for (const x of doc.extra) x.lines = x.lines.join('\n').trim().split('\n');
  return doc;
}

export function serializeSections(doc) {
  const parts = [];
  if (doc.preamble) parts.push(doc.preamble);
  for (const [key, title] of SECTIONS) parts.push([`## ${title}`, ...writeItems(doc[key])].join('\n'));
  for (const x of doc.extra) parts.push([`## ${x.title}`, '', ...x.lines].join('\n').trim());
  return parts.join('\n\n') + '\n';
}

// Three-way merge (see merge.js); the preamble and any unknown sections can
// only be changed on GitHub.
export const mergeSections3 = (base, local, remote) => ({
  preamble: remote.preamble,
  extra: remote.extra,
  ...mergeTimed(base, local, remote, SECTION_KEYS),
});

export const upgradeSections = (doc) => doc && { ...doc, ...Object.fromEntries(SECTION_KEYS.map((k) => [k, upgradeItems(doc[k])])) };

// Whether item i of a list is the last of its group (and not of the list),
// for the darker rule between groups.
export const endsGroup = (items, i) => i < items.length - 1 && items[i].time !== items[i + 1].time;
