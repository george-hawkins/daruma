// Run with: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseDeck, buildIndex, classify, search, cardFor, renderInline, exactKeyword, addRecent } from '../js/rtkdata.js';

const CSV = [
  'frame,kanji,keyword,british_english,usual_form',
  '1,一,one,,',
  '95,丁,street,,',
  '97,可,can,,',
  '98,頂,place on the head,,',
  '557,蛍,lightning bug,firefly,',
  '1241,唐,"T\'ang, the dynasty",,Tang',
  '2116,缶,tin can,,',
  '',
].join('\r\n');

const DECK = `TARGET DECK: RTK 1 v6
START
Japanese RTK
Keyword: one
Clue: not numeral I
Kanji: 一
Story: [no story]
Note: primitive meaning _floor_
<!--ID: 1-->
END

START
Japanese RTK
Keyword: street
Clue:
Kanji: 丁
Story: A **street** <!-- inline aside --> sign.
Note:
<!--ID: 2-->
END

<!-- a comment between cards
START
Keyword: ghost
Kanji: 鬼
END
-->

START
Japanese RTK
Keyword: can
Clue:
Kanji: 可
Story: A _mouth_ on the _street_ (丁): "**Can** I get some help?"
Note: drawn differently to 町
Story doesn't use the usual order.
Update: **can** is hard to include in stories.
<!--ID: 3-->
END

START
Japanese RTK
Keyword: place on the head
Clue:
Kanji: 頂
Story: A *nail*-gun to the _head_, the human **legs** buckle.
Note:
END
`;

const index = buildIndex(CSV, DECK);
const hits = (q) => {
  const r = search(index, q);
  return { index: r.index.map((h) => h.kanji).join(''), deck: r.deck.map((h) => h.kanji).join('') };
};

test('CSV: CRLF, quoted fields, optional columns', () => {
  const rows = parseCsv(CSV);
  assert.equal(rows.length, 7);
  assert.deepEqual(rows[5], { frame: '1241', kanji: '唐', keyword: "T'ang, the dynasty", british_english: '', usual_form: 'Tang' });
});

test('deck: fields, continuation lines, comments', () => {
  const cards = parseDeck(DECK);
  assert.deepEqual(cards.map((c) => c.Kanji), ['一', '丁', '可', '頂']); // 鬼 is inside a comment
  assert.equal(cards[1].Story, 'A **street**  sign.');
  assert.equal(cards[1].Note, '');
  assert.equal(cards[2].Note, "drawn differently to 町\nStory doesn't use the usual order.");
  assert.equal(cards[2].Update, '**can** is hard to include in stories.');
  assert.equal(cards[3].Story, 'A *nail*-gun to the _head_, the human **legs** buckle.'); // no ID yet
});

test('classify', () => {
  assert.equal(classify('  ').kind, 'empty');
  assert.deepEqual(classify(' 97 '), { kind: 'frame', q: '97', frame: 97 });
  assert.equal(classify('９７').frame, 97); // full-width digits
  assert.equal(classify('可').kind, 'kanji');
  assert.equal(classify('日本').kind, 'kanjis');
  assert.equal(classify('か').kind, 'phrase');
  assert.equal(classify('place  on the head').q, 'place on the head');
});

test('a frame number only looks in the index', () => {
  assert.deepEqual(hits('1'), { index: '一', deck: '' });
  assert.deepEqual(hits('9999'), { index: '', deck: '' });
});

test('a kanji: index, plus cards mentioning it, without repeating it', () => {
  assert.deepEqual(hits('丁'), { index: '丁', deck: '可' });
  assert.deepEqual(hits('町'), { index: '', deck: '可' });
});

test('a word or phrase: whole words, any case, all fields, Markdown ignored', () => {
  assert.deepEqual(hits('can'), { index: '可缶', deck: '' }); // not "candle" etc.; 可's card is already listed
  assert.deepEqual(hits('CAN'), hits('can'));
  assert.deepEqual(hits('head'), { index: '頂', deck: '' });
  assert.deepEqual(hits('street'), { index: '丁', deck: '可' });
  assert.deepEqual(hits('mouth'), { index: '', deck: '可' });
  assert.deepEqual(hits('human legs'), { index: '', deck: '頂' }); // "human **legs**"
  assert.deepEqual(hits('numeral'), { index: '', deck: '一' }); // Clue
  assert.deepEqual(hits('firefly'), { index: '蛍', deck: '' }); // british_english
  assert.deepEqual(hits('tang'), { index: '唐', deck: '' }); // usual_form
  assert.deepEqual(hits('nail'), { index: '', deck: '頂' });
  assert.deepEqual(hits('ail'), { index: '', deck: '' });
});

test('deck results carry the frame from the index', () => {
  assert.deepEqual(search(index, 'mouth').deck, [{ group: 'deck', frame: '97', kanji: '可', keyword: 'can' }]);
});

test('cardFor: a kanji without a card yet has no story or note', () => {
  assert.deepEqual(cardFor(index, '缶'), { Kanji: '缶', Keyword: 'tin can', Clue: '', Story: '', Note: '', Update: '', frame: '2116' });
  assert.equal(cardFor(index, '一').Clue, 'not numeral I');
  assert.equal(cardFor(index, '可').Update, '**can** is hard to include in stories.');
});

test('renderInline', () => {
  assert.equal(renderInline('The **town** has _streets_ & *gold*fish'), 'The <b>town</b> has <i>streets</i> &amp; <i>gold</i>fish');
  assert.equal(renderInline('line one\nline <two>'), 'line one<br>line &lt;two&gt;');
  assert.equal(renderInline('snake_case stays, slanted \\ and /'), 'snake_case stays, slanted \\ and /');
  assert.equal(renderInline('[no story - but think _vermilion_]'), '[no story - but think <i>vermilion</i>]');
  assert.equal(renderInline('_horizon (floor)_ and **Can** I?'), '<i>horizon (floor)</i> and <b>Can</b> I?');
  assert.equal(renderInline('see [KanjiVG](https://kanjivg.tagaini.net) and `code`'),
    'see <a href="https://kanjivg.tagaini.net" target="_blank" rel="noopener">KanjiVG</a> and <code>code</code>');
});

test('exactKeyword: the one kanji whose keyword is exactly the text', () => {
  assert.equal(exactKeyword(index, 'Can'), '可'); // not "tin can"
  assert.equal(exactKeyword(index, ' tin  can '), '缶');
  assert.equal(exactKeyword(index, 'firefly'), '蛍'); // British English
  assert.equal(exactKeyword(index, 'mouth'), null); // only in a story
  assert.equal(exactKeyword(index, ''), null);
});

test('addRecent: newest first, no repeats, at most 10', () => {
  assert.deepEqual(addRecent(['a', 'b', 'c'], 'b'), ['b', 'a', 'c']);
  assert.deepEqual(addRecent([...'0123456789'], 'x'), ['x', ...'012345678']);
});
