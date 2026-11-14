// RTK lookup: search the keyword index and the Anki deck by frame number,
// kanji or keyword, then open a match as the back of its Anki card.

import { load, save } from './store.js';
import { el, debounce, hashFor } from './ui.js';
import { search, cardFor, renderInline, exactKeyword, addRecent } from './rtkdata.js';
import { getSettings } from './settings.js';

export function initRtk(source) {
  const $ = (id) => document.getElementById(id);
  const page = $('page-rtk');
  const form = $('rtk-form');
  const input = $('rtk-query');
  const results = $('rtk-results');
  const cardView = $('rtk-card');
  const cardBody = $('rtk-card-body');
  const cardFrame = $('rtk-card-frame');
  let open = null; // kanji of the card being shown

  input.value = load('rtk:query', '');

  const fileName = (key) => getSettings()[key].split('/').pop() || key;

  function message(text) {
    results.replaceChildren(el('p', 'rtk-message', text));
  }

  // Each group shows its first CAP rows, then a "Show all" row.
  const CAP = 20;
  let expanded = new Set(); // groups shown in full, until the query changes

  function render() {
    const query = input.value;
    if (!source.loaded) {
      return message(source.configured()
        ? (source.result?.text.startsWith('failed') ? `Couldn't fetch the RTK files: ${source.result.text.slice(8)}` : 'Fetching the RTK files…')
        : 'Set the RTK keyword and card files in Settings to look kanji up here.');
    }
    const r = search(source.index, query);
    if (r.kind === 'empty') {
      // The cards opened most recently (that are still in the files).
      const { rowByKanji, cardByKanji } = source.index;
      const hits = load('rtk:recent', []).filter((k) => rowByKanji.has(k) || cardByKanji.has(k)).map((k) => {
        const f = cardFor(source.index, k);
        return { frame: f.frame, kanji: k, keyword: f.Keyword };
      });
      const hint = el('p', 'rtk-message', 'Type a frame number, a kanji, or a keyword.');
      if (!hits.length) return results.replaceChildren(hint);
      return results.replaceChildren(hint, table([['recent', hits, 'Recently viewed', '']]));
    }
    if (!r.index.length && !r.deck.length) return message(`Nothing found for “${query.trim()}”.`);
    results.replaceChildren(table([
      ['index', r.index, 'Keyword index', fileName('rtkKeywordsUrl')],
      ['deck', r.deck, 'Also found in cards', fileName('rtkDeckUrl')],
    ]));
  }

  function table(groups) {
    const t = el('table', 'rtk-table');
    const head = el('thead');
    const hr = el('tr');
    for (const [label, cls] of [['Frame', 'frame'], ['Kanji', 'kanji'], ['Keyword', 'kw']]) hr.append(el('th', cls, label));
    head.append(hr);
    t.append(head);
    for (const [group, hits, title, file] of groups) {
      if (!hits.length) continue;
      const body = el('tbody', `group-${group}`);
      const gr = el('tr', 'group-title');
      const th = el('th', null, `${title} `);
      th.colSpan = 3;
      th.append(el('span', 'group-file', file ? `${file} · ${hits.length}` : ''));
      gr.append(th);
      body.append(gr);
      const shown = expanded.has(group) ? hits : hits.slice(0, CAP);
      for (const h of shown) {
        const tr = el('tr', 'hit');
        tr.tabIndex = 0;
        tr.append(el('td', 'frame', h.frame), el('td', 'kanji', h.kanji), el('td', 'kw', h.keyword));
        tr.addEventListener('click', () => openCard(h.kanji));
        tr.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault(); // or the key would also press "‹ Results", now focused
          openCard(h.kanji, { focus: true });
        });
        body.append(tr);
      }
      if (shown.length < hits.length) {
        const more = el('tr', 'more');
        const td = el('td');
        td.colSpan = 3;
        const b = el('button', null, `Show all ${hits.length}`);
        b.type = 'button';
        b.addEventListener('click', () => {
          expanded.add(group);
          render();
        });
        td.append(b);
        more.append(td);
        body.append(more);
      }
      t.append(body);
    }
    return t;
  }

  // The back of the Anki card:
  //   <span class="kanjivg-animate">{{Kanji}}</span>
  //   <div class="keyword">{{Keyword}}</div>
  //   <div class="story">{{Story}}</div>
  //   {{#Note}}<div class="note">Note: {{Note}}</div>{{/Note}}
  // plus Update, the deck's optional later second thought, styled like Note,
  // and the Clue (which tells the keyword apart from similar ones; Anki shows
  // it on the front), under the keyword.
  function showCard(kanji) {
    const f = cardFor(source.index, kanji);
    const k = el('span', 'kanjivg-animate', f.Kanji);
    const keyword = el('div', 'keyword', f.Keyword);
    const story = el('div', 'story');
    story.innerHTML = renderInline(f.Story);
    cardBody.replaceChildren(k, keyword);
    if (f.Clue) {
      const clue = el('div', 'clue');
      clue.innerHTML = `Clue: ${renderInline(f.Clue)}`;
      cardBody.append(clue);
    }
    cardBody.append(story);
    for (const name of ['Note', 'Update']) {
      if (!f[name]) continue;
      const d = el('div', 'note');
      d.innerHTML = `${name}: ${renderInline(f[name])}`;
      cardBody.append(d);
    }
    cardFrame.textContent = f.frame ? `Frame ${f.frame}` : '';
    // Falls back to the character in Klee One if there's no KanjiVG drawing.
    // (The drawings' location is set on its <script> tag in index.html.)
    window.kanjivgAnimate?.({ root: cardBody }).then(([handle]) => !handle && k.classList.add('no-svg'));
    if (!window.kanjivgAnimate) k.classList.add('no-svg');
  }

  // Opening a card from the results adds a history entry (#rtk/可), so the
  // phone's back gesture returns to the results rather than leaving the app.
  // A card shown because of the URL (a refresh, a bookmark, back/forward)
  // doesn't add one.
  // Keyboard users get the focus on "‹ Results"; after a tap it isn't
  // needed, and its ring would just be noise.
  function openCard(kanji, { push = true, focus = false } = {}) {
    open = kanji;
    save('rtk:recent', addRecent(load('rtk:recent', []), kanji));
    showCard(kanji);
    page.classList.add('card-open');
    cardView.scrollTop = 0;
    if (push) {
      const hash = hashFor('rtk', kanji);
      if (history.state?.rtkCard) history.replaceState({ rtkCard: true }, '', hash);
      else history.pushState({ rtkCard: true }, '', hash);
    }
    if (focus) $('rtk-back').focus({ preventScroll: true });
  }

  function closeCard() {
    open = null;
    page.classList.remove('card-open');
    if (!input.value.trim()) render(); // the card is now first among the recent ones
  }

  // The card named in the URL. Until the RTK files are on this device it's
  // kept as `pending`, and shown when they arrive. A kanji that isn't in them
  // is searched for instead (showing "Nothing found").
  let pending = null;
  function showLinked(kanji) {
    pending = null;
    if (!source.loaded) {
      pending = kanji;
      return;
    }
    const { rowByKanji, cardByKanji } = source.index;
    if (rowByKanji.has(kanji) || cardByKanji.has(kanji)) {
      if (open !== kanji) openCard(kanji, { push: false });
      return;
    }
    closeCard();
    input.value = kanji;
    save('rtk:query', kanji);
    render();
    history.replaceState(null, '', hashFor('rtk'));
  }

  // From a link or a refresh there may be no results entry to go back to.
  $('rtk-back').addEventListener('click', () => {
    if (history.state?.rtkCard) return history.back();
    closeCard();
    history.replaceState(null, '', hashFor('rtk'));
  });

  const update = debounce(() => {
    save('rtk:query', input.value);
    expanded = new Set();
    results.scrollTop = 0;
    render();
  }, 120);
  input.addEventListener('input', update);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    input.blur(); // hides the phone's keyboard to show the results
  });
  input.addEventListener('focus', () => input.select());

  source.on(() => {
    render();
    if (pending) showLinked(pending);
    else if (open) showCard(open);
  });

  return {
    // arg: the kanji whose card the URL names, or '' for the results.
    onShow(arg) {
      render();
      if (arg) showLinked(arg);
      else if (open || pending) {
        pending = null;
        closeCard();
      }
    },
    current: () => open ?? pending ?? '',
    // Searches for `text` (e.g. a word tapped on the Kanji page), opening the
    // card straight away if it's exactly one kanji's keyword.
    lookUp(text) {
      input.value = text;
      save('rtk:query', text);
      expanded = new Set();
      results.scrollTop = 0;
      closeCard();
      render();
      const kanji = source.loaded && exactKeyword(source.index, text);
      if (kanji) openCard(kanji);
    },
    // Called on each sync status change: until the files are on this device,
    // the page shows whether they're being fetched or why that failed.
    refresh: () => !source.loaded && render(),
  };
}
