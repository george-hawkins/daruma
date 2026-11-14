// Run with: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseList, serializeList, parseSections, serializeSections, mergeList3, mergeSections3,
  upgradeList, upgradeSections, newItem, timestamp, endsGroup, locate, emptyList, emptySections, GROUP_GAP,
} from '../js/markdown.js';

const T1 = '2026-11-14T12:00:00Z';
const T2 = '2026-11-15T09:30:00Z';
const T3 = '2026-11-16T08:00:00Z';
const at = (iso) => Date.parse(iso);

const FORGOTTEN = `# Forgotten kanji

### ${T2}

* apply
* discard

### ${T1}

* wagawags
`;

const CORRECTIONS = `## Corrections

### ${T2}

* Intelligent clue --> not CLEVER

## Maybe

## Done

### ${T2}

* Discard clue: not DISPOSE

### ${T1}

* Old one
`;

test('forgotten.md: groups round-trip', () => {
  const d = parseList(FORGOTTEN);
  assert.equal(d.header, '# Forgotten kanji');
  assert.deepEqual(d.items, [{ text: 'apply', time: T2 }, { text: 'discard', time: T2 }, { text: 'wagawags', time: T1 }]);
  assert.equal(serializeList(d), FORGOTTEN);
});

test('forgotten.md: items above any heading, and an empty list', () => {
  const d = parseList('# Forgotten kanji\n\n* new\n\n### ' + T1 + '\n\n* old\n');
  assert.deepEqual(d.items, [{ text: 'new', time: '' }, { text: 'old', time: T1 }]);
  assert.equal(serializeList(d), `# Forgotten kanji\n\n* new\n\n### ${T1}\n\n* old\n`);
  assert.equal(serializeList(emptyList()), '# Forgotten kanji\n');
});

test('corrections.md: groups per section round-trip; empty sections stay bare', () => {
  const d = parseSections(CORRECTIONS);
  assert.deepEqual(d.corrections, [{ text: 'Intelligent clue --> not CLEVER', time: T2 }]);
  assert.deepEqual(d.maybe, []);
  assert.deepEqual(d.done.map((it) => it.time), [T2, T1]);
  assert.equal(serializeSections(d), CORRECTIONS);
  assert.equal(serializeSections(emptySections()), '## Corrections\n\n## Maybe\n\n## Done\n');
});

test('a group heading only applies within its section', () => {
  const d = parseSections(`## Corrections\n\n### ${T1}\n\n* a\n\n## Maybe\n\n* b\n`);
  assert.deepEqual(d.maybe, [{ text: 'b', time: '' }]);
});

test('timestamp: UTC to the minute', () => {
  assert.equal(timestamp(at('2026-11-14T12:34:56.789Z')), '2026-11-14T12:34:00Z');
});

test('newItem joins the newest group within 6 hours, else starts one', () => {
  const list = [{ text: 'a', time: T2 }, { text: 'b', time: T1 }];
  assert.deepEqual(newItem(list, 'x', at(T2) + GROUP_GAP), { text: 'x', time: T2 });
  assert.deepEqual(newItem(list, 'x', at(T2) + GROUP_GAP + 60_000), { text: 'x', time: timestamp(at(T2) + GROUP_GAP + 60_000) });
  assert.equal(newItem([], 'x', at(T3)).time, T3); // empty list
  assert.equal(newItem([{ text: 'a', time: '' }], 'x', at(T3)).time, T3); // no heading yet
  // The newest heading counts, wherever it is (e.g. after a merge).
  assert.equal(newItem([{ text: 'a', time: T1 }, { text: 'b', time: T2 }], 'x', at(T2) + 1000).time, T2);
});

test('endsGroup marks the last row of each group but not of the list', () => {
  const items = parseList(FORGOTTEN).items;
  assert.deepEqual(items.map((_, i) => endsGroup(items, i)), [false, true, false]);
});

test('merge keeps each item in its group and the groups in order', () => {
  const base = parseList(`# F\n\n### ${T1}\n\n* old\n`);
  const local = { ...base, items: [{ text: 'phone', time: T3 }, ...base.items] };
  const remote = { ...base, items: [{ text: 'laptop', time: T2 }, ...base.items] };
  assert.deepEqual(mergeList3(base, local, remote).items, [
    { text: 'phone', time: T3 }, { text: 'laptop', time: T2 }, { text: 'old', time: T1 },
  ]);
  // Laptop's group is newer: it comes first even though this device's
  // arrivals are normally put on top.
  const remote2 = { ...base, items: [{ text: 'laptop', time: T3 }, ...base.items] };
  const local2 = { ...base, items: [{ text: 'phone', time: T2 }, ...base.items] };
  assert.deepEqual(mergeList3(base, local2, remote2).items.map((it) => it.text), ['laptop', 'phone', 'old']);
});

test('merge: an item marked done elsewhere takes its Done time from there', () => {
  const base = { ...emptySections(), corrections: [{ text: 'c', time: T1 }] };
  const local = { ...base, maybe: [{ text: 'm', time: T2 }] };
  const remote = { ...emptySections(), done: [{ text: 'c', time: T3 }] };
  const r = mergeSections3(base, local, remote);
  assert.deepEqual(r.corrections, []);
  assert.deepEqual(r.maybe, [{ text: 'm', time: T2 }]);
  assert.deepEqual(r.done, [{ text: 'c', time: T3 }]);
});

test('merge: a known time beats none (e.g. data saved before timestamps)', () => {
  const base = upgradeList({ header: '# F', items: ['a'] });
  const local = upgradeList({ header: '# F', items: ['b', 'a'] });
  const remote = parseList(`# F\n\n### ${T1}\n\n* a\n`);
  assert.deepEqual(mergeList3(base, local, remote).items, [{ text: 'b', time: '' }, { text: 'a', time: T1 }]);
});

test('upgrade: plain strings from older versions become untimed items', () => {
  assert.deepEqual(upgradeList({ header: '# F', items: ['a'] }).items, [{ text: 'a', time: '' }]);
  const s = upgradeSections({ ...emptySections(), done: ['d'] });
  assert.deepEqual(s.done, [{ text: 'd', time: '' }]);
  assert.deepEqual(upgradeList(upgradeList({ header: '# F', items: ['a'] })).items, [{ text: 'a', time: '' }]);
});

test('locate finds an item again after the list changed, by identity, else by text', () => {
  const a = { text: 'a', time: T1 }, b = { text: 'b', time: T1 };
  const list = [a, b];
  list.unshift({ text: 'new', time: T2 });
  assert.equal(locate(list, b), 2);
  assert.equal(locate([{ text: 'b', time: T1 }], b), 0); // replaced by a sync
  assert.equal(locate([a], b), -1); // gone
});
