// Three-way merge for documents made of named lists of one-line items
// (e.g. corrections / maybe / done).
//
// `base` is the version both sides started from (the last one this device
// synced), `local` this device's version and `remote` GitHub's. Every edit the
// app makes (add, edit, delete, move between lists, mark done) changes which
// list an item text is in, so the merge decides each item's final list:
//
// - changed on one side only: take that side's change;
// - changed the same way on both: take it;
// - changed differently on both (rare): never lose the item; if only one side
//   still has it, keep it there, and if both moved it, prefer this device.
//
// An edit is "remove the old text, add the new one". Order: items that newly
// arrived in a list go at the top (this device's first, as new items are added
// at the top), followed by the rest in GitHub's order. Identical lines within a
// document are treated as one item.

const norm = (items) => items.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);

export function merge3(base, local, remote, keys) {
  const lists = (doc) => Object.fromEntries(keys.map((k) => [k, norm(doc?.[k] ?? [])]));
  const [b, l, r] = [lists(base), lists(local), lists(remote)];
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

  const result = {};
  for (const k of keys) {
    const out = [];
    const seen = new Set();
    const take = (t) => {
      if (final.get(t) === k && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    };
    l[k].filter((t) => B.get(t) !== k).forEach(take); // arrived here on this device
    r[k].filter((t) => B.get(t) !== k).forEach(take); // arrived here on GitHub
    r[k].forEach(take);
    l[k].forEach(take);
    result[k] = out;
  }
  return result;
}

// The same merge for lists of { text, time } items, where `time` is the
// timestamp heading of the item's group ('' for an item above any heading).
// Texts are merged as above. Each item then takes its time from a side where
// it's in the list it ended up in (a non-empty time over an empty one, then
// this device's), and each list is regrouped newest group first ('' counts as
// newest, since such items can only be above the first heading), keeping the
// merged order within a group.
export function mergeTimed(base, local, remote, keys) {
  const texts = (doc) => Object.fromEntries(keys.map((k) => [k, (doc?.[k] ?? []).map((it) => it.text)]));
  const merged = merge3(texts(base), texts(local), texts(remote), keys);
  const timeIn = (doc, k) => new Map((doc?.[k] ?? []).map((it) => [it.text.replace(/\s+/g, ' ').trim(), it.time]));
  const result = {};
  for (const k of keys) {
    const [l, r, b] = [timeIn(local, k), timeIn(remote, k), timeIn(base, k)];
    const items = merged[k].map((text, i) => {
      const options = [l.get(text), r.get(text), b.get(text)].filter((t) => t !== undefined);
      return { text, time: options.find(Boolean) ?? '', i };
    });
    items.sort((x, y) => (x.time === y.time ? x.i - y.i : !x.time ? -1 : !y.time ? 1 : x.time < y.time ? 1 : -1));
    result[k] = items.map(({ text, time }) => ({ text, time }));
  }
  return result;
}
