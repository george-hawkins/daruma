// Run with: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashFor, parseHash } from '../js/ui.js';

test('hashFor: a page, optionally with something on it', () => {
  assert.equal(hashFor('kanji'), '#kanji');
  assert.equal(hashFor('rtk', ''), '#rtk');
  assert.equal(hashFor('rtk', '可'), '#rtk/%E5%8F%AF');
});

test('parseHash: encoded or not, and malformed', () => {
  assert.deepEqual(parseHash('#rtk/%E5%8F%AF'), { page: 'rtk', arg: '可' });
  assert.deepEqual(parseHash('#rtk/可'), { page: 'rtk', arg: '可' });
  assert.deepEqual(parseHash('#corrections'), { page: 'corrections', arg: '' });
  assert.deepEqual(parseHash(''), { page: '', arg: '' });
  assert.deepEqual(parseHash('#rtk/%E5'), { page: 'rtk', arg: '%E5' }); // not valid UTF-8: left as is
});
