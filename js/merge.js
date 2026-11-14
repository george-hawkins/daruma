// Three-way merge for documents made of named lists of one-line items
// (e.g. corrections / maybe / done).
//
// `base` is the version both sides started from (the last one this device
// synced), `local` this device's version and `remote` GitHub's. Every edit the
// app makes (add, edit, delete, move between lists, mark done) changes which
// list an item is in, so the merge decides each item's final list:
//
// - changed on one side only: take that side's change;
// - changed the same way on both: take it;
// - changed differently on both (rare): never lose the item; if only one side
//   still has it, keep it there, and if both moved it, prefer this device.
//
// An edit is "remove the old text, add the new one". Order: GitHub's, with
// this device's own additions (and edits, and items it moved) each placed
// after the item above it on this device, or at the top if there's none (as
// new items are added at the top). So both sides' new items end up at the
// top, this device's first, and an edited item stays where it was.
//
// An item is identified by its text plus which occurrence of that text it is,
// counted from the oldest end of the document (the bottom of the last list,
// upwards). So identical lines stay separate items (a keyword forgotten again
// isn't lost), and adding at the top never renumbers the older copies.

const tidy = (t) => t.replace(/\s+/g, ' ').trim();
const SEP = '\u0000';
const textOf = (key) => key.slice(0, key.lastIndexOf(SEP));

// The document's lists as { k: [{ key, text, time }] }, empty items dropped.
function identify(doc, keys, text, time) {
  const lists = Object.fromEntries(keys.map((k) => [k,
    (doc?.[k] ?? []).map((it) => ({ text: tidy(text(it)), time: time(it) })).filter((it) => it.text)]));
  const count = new Map();
  for (const k of [...keys].reverse()) {
    for (const it of [...lists[k]].reverse()) {
      const n = count.get(it.text) ?? 0;
      count.set(it.text, n + 1);
      it.key = `${it.text}${SEP}${n}`;
    }
  }
  return lists;
}

// The merge itself, on lists of unique keys: { k: [key] } in, { k: [key] } out.
function mergeKeys(b, l, r, keys) {
  const where = (doc) => {
    const m = new Map();
    for (const k of keys) for (const t of doc[k]) if (!m.has(t)) m.set(t, k);
    return m;
  };
  const [B, L, R] = [where(b), where(l), where(r)];

  const final = new Map();
  for (const t of new Set([...B.keys(), ...L.keys(), ...R.keys()])) {
    const [bk, lk, rk] = [B.get(t), L.get(t), R.get(t)];
    const k = lk === bk ? rk : rk === bk ? lk : lk === rk ? lk : (lk ?? rk);
    if (k) final.set(t, k);
  }

  // Order: GitHub's, with this device's other items each placed after the
  // item above it on this device (at the top if there's none: new items).
  const result = {};
  for (const k of keys) {
    const out = r[k].filter((t) => final.get(t) === k);
    const placed = new Set(out);
    let above = null;
    for (const t of l[k]) {
      if (!placed.has(t) && final.get(t) === k) {
        out.splice(above === null ? 0 : out.indexOf(above) + 1, 0, t);
        placed.add(t);
      }
      if (placed.has(t)) above = t;
    }
    result[k] = out;
  }
  return result;
}

const keysOf = (lists, keys) => Object.fromEntries(keys.map((k) => [k, lists[k].map((it) => it.key)]));

// Lists of plain strings.
export function merge3(base, local, remote, keys) {
  const prep = (doc) => keysOf(identify(doc, keys, (t) => t, () => ''), keys);
  const merged = mergeKeys(prep(base), prep(local), prep(remote), keys);
  return Object.fromEntries(keys.map((k) => [k, merged[k].map(textOf)]));
}

// The same merge for lists of { text, time } items, where `time` is the
// timestamp heading of the item's group ('' for an item above any heading).
// Items are merged as above. Each item then takes its time from a side where
// it's in the list it ended up in (a non-empty time over an empty one, then
// this device's), and each list is regrouped newest group first ('' counts as
// newest, since such items can only be above the first heading), keeping the
// merged order within a group.
export function mergeTimed(base, local, remote, keys) {
  const [b, l, r] = [base, local, remote].map((doc) => identify(doc, keys, (it) => it.text, (it) => it.time ?? ''));
  const merged = mergeKeys(keysOf(b, keys), keysOf(l, keys), keysOf(r, keys), keys);
  const result = {};
  for (const k of keys) {
    const times = [l, r, b].map((lists) => new Map(lists[k].map((it) => [it.key, it.time])));
    const items = merged[k].map((key, i) => {
      const options = times.map((m) => m.get(key)).filter((t) => t !== undefined);
      return { text: textOf(key), time: options.find(Boolean) ?? '', i };
    });
    items.sort((x, y) => (x.time === y.time ? x.i - y.i : !x.time ? -1 : !y.time ? 1 : x.time < y.time ? 1 : -1));
    result[k] = items.map(({ text, time }) => ({ text, time }));
  }
  return result;
}
