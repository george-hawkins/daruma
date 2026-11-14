// RTK lookup data: parsing the keyword index (CSV) and the Anki deck
// (Obsidian_to_Anki style Markdown), searching them, and rendering a card's
// inline Markdown. No DOM access, so it can be unit-tested with node.

// rtk1-keywords.csv: frame,kanji,keyword,british_english,usual_form. Quoted
// fields ("a, b" and "" escapes) are handled even though none are used today.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/, ''); // byte order mark
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((f) => f.trim()));
  if (!header) return [];
  const names = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(names.map((n, i) => [n, (r[i] ?? '').trim()])));
}

// The deck's field labels. Any other "Word:" line is a continuation line.
const FIELD = /^(Keyword|Clue|Kanji|Reading|Story|Note|Update):\s*(.*)$/;

// rtk1-v6.md: START … END blocks; the first line is the note type, then
// "Field: value" lines. Fields may run onto continuation lines (newlines are
// hard). <!-- … --> comments (the note ID, or scratch notes, possibly over
// several lines) can appear anywhere and are skipped.
export function parseDeck(text) {
  const cards = [];
  let card = null, field = null, inComment = false;
  for (let line of text.split(/\r?\n/)) {
    if (inComment) {
      const end = line.indexOf('-->');
      if (end < 0) continue;
      line = line.slice(end + 3);
      inComment = false;
    }
    line = line.replace(/<!--[\s\S]*?-->/g, '');
    const open = line.indexOf('<!--');
    if (open >= 0) {
      line = line.slice(0, open);
      inComment = true;
    }
    const stripped = line.trim();
    if (stripped === 'START') {
      card = {};
      field = null;
    } else if (stripped === 'END') {
      if (card) cards.push(card);
      card = field = null;
    } else if (card) {
      const m = line.match(FIELD);
      if (m) {
        field = m[1];
        card[field] = m[2].trim();
      } else if (field && stripped) {
        card[field] += (card[field] ? '\n' : '') + stripped;
      }
    }
  }
  return cards;
}

// Builds the lookup structures for search() and cardFor().
export function buildIndex(csvText, deckText) {
  const rows = csvText ? parseCsv(csvText) : [];
  const cards = deckText ? parseDeck(deckText) : [];
  const rowByKanji = new Map(rows.map((r) => [r.kanji, r]));
  const cardByKanji = new Map();
  for (const c of cards) if (c.Kanji && !cardByKanji.has(c.Kanji)) cardByKanji.set(c.Kanji, c);
  return { rows, cards, rowByKanji, cardByKanji };
}

const HAN = /\p{Script=Han}/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

// Full-width ASCII (from a Japanese keyboard) → ASCII, so １２ is a frame.
const halfWidth = (s) => s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ');

// What the query is: a frame number, one kanji, several kanji, or a phrase.
export function classify(query) {
  const q = halfWidth(query).trim().replace(/\s+/g, ' ');
  if (!q) return { kind: 'empty', q };
  if (/^\d+$/.test(q)) return { kind: 'frame', q, frame: Number(q) };
  const chars = [...q];
  if (chars.every((c) => HAN.test(c))) return chars.length === 1 ? { kind: 'kanji', q } : { kind: 'kanjis', q, chars };
  return { kind: 'phrase', q };
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A case-insensitive matcher for a word or phrase: it must not start or end
// in the middle of a word ("can" doesn't match "scan" or "candle"). Text in
// Japanese has no word boundaries, so anything containing kana or kanji is
// matched as a plain substring.
export function phraseMatcher(q) {
  const body = q.split(' ').map(escapeRegExp).join('\\s+');
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(q)) return new RegExp(body, 'iu');
  const pre = LETTER_OR_DIGIT.test(q[0]) ? '(?<![\\p{L}\\p{N}])' : '';
  const post = LETTER_OR_DIGIT.test(q.at(-1)) ? '(?![\\p{L}\\p{N}])' : '';
  return new RegExp(pre + body + post, 'iu');
}

// Markdown emphasis markers are ignored when searching card fields, so that
// "human legs" finds "_human legs_" and "**human** legs".
const plain = (s) => s.replace(/[*_`]/g, '');

// Results in two groups, each in file order:
//   index: rows of the CSV;
//   deck:  cards found by searching all their fields, leaving out any whose
//          kanji is already in the index group (same row, same card).
// Each result is { group, frame, kanji, keyword }.
export function search(index, query) {
  const c = classify(query);
  const { rows, cards, rowByKanji } = index;
  let rowHit = () => false, cardHit = null;
  if (c.kind === 'frame') {
    rowHit = (r) => Number(r.frame) === c.frame;
  } else if (c.kind === 'kanji') {
    rowHit = (r) => r.kanji === c.q;
    cardHit = (text) => text.includes(c.q);
  } else if (c.kind === 'kanjis') {
    rowHit = (r) => c.chars.includes(r.kanji);
    cardHit = (text) => text.includes(c.q);
  } else if (c.kind === 'phrase') {
    const re = phraseMatcher(c.q);
    rowHit = (r) => [r.keyword, r.british_english, r.usual_form].some((v) => v && re.test(v));
    cardHit = (text) => re.test(plain(text));
  }
  const indexHits = rows.filter(rowHit).map((r) => ({ group: 'index', frame: r.frame, kanji: r.kanji, keyword: r.keyword }));
  const seen = new Set(indexHits.map((h) => h.kanji));
  const deckHits = !cardHit ? [] : cards
    .filter((card) => !seen.has(card.Kanji) && Object.values(card).some((v) => cardHit(v)))
    .map((card) => ({ group: 'deck', frame: rowByKanji.get(card.Kanji)?.frame ?? '', kanji: card.Kanji ?? '', keyword: card.Keyword ?? '' }));
  return { kind: c.kind, index: indexHits, deck: deckHits };
}

// The fields to show for a result. A kanji that's in the index but has no
// card yet gets a card without Story, Note or Update.
export function cardFor(index, kanji) {
  const card = index.cardByKanji.get(kanji);
  const row = index.rowByKanji.get(kanji);
  return {
    Kanji: kanji,
    Keyword: card?.Keyword || row?.keyword || '',
    Story: card?.Story || '',
    Note: card?.Note || '',
    Update: card?.Update || '',
    frame: row?.frame ?? '',
  };
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Inline Markdown as used in the deck: **bold**, _italic_ / *italic* (the
// asterisk form may sit inside a word, as in *gold*fish), `code`,
// [links](https://…), backslash escapes, and hard newlines.
export function renderInline(md) {
  const held = [];
  const hold = (html) => `\u0000${held.push(html) - 1}\u0000`;
  let s = escapeHtml(md)
    .replace(/\\([\\`*_[\]()#+\-.!])/g, (_, c) => hold(c))
    .replace(/`([^`\n]+)`/g, (_, c) => hold(`<code>${c}</code>`))
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`)
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<b>$1</b>')
    .replace(/(?<![\p{L}\p{N}_])__(?=\S)([\s\S]*?\S)__(?![\p{L}\p{N}_])/gu, '<b>$1</b>')
    .replace(/\*(?=[^\s*])([^*\n]*?[^\s*])\*/g, '<i>$1</i>')
    .replace(/(?<![\p{L}\p{N}_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\p{L}\p{N}_])/gu, '<i>$1</i>')
    .replace(/\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => held[i]);
}
