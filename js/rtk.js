// RTK lookup: search the keyword index and the Anki deck by frame number,
// kanji or keyword, then open a match as the back of its Anki card.

import { load, save } from './store.js';
import { el, debounce, hashFor } from './ui.js';
import { search, cardFor, renderInline } from './rtkdata.js';
import { getSettings } from './settings.js';

const KANJIVG = { basePath: 'kanjivg', filenameFormat: 'hex', filenamePrefix: '' };

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

  function render() {
    const query = input.value;
    if (!source.loaded) {
      return message(source.configured()
        ? (source.result?.text.startsWith('failed') ? `Couldn't fetch the RTK files: ${source.result.text.slice(8)}` : 'Fetching the RTK files…')
        : 'Set the RTK keyword and card files in Settings to look kanji up here.');
    }
    const r = search(source.index, query);
    if (r.kind === 'empty') return message('Type a frame number, a kanji, or a keyword.');
    if (!r.index.length && !r.deck.length) return message(`Nothing found for “${query.trim()}”.`);

    const table = el('table', 'rtk-table');
    const head = el('thead');
    const hr = el('tr');
    for (const [label, cls] of [['Frame', 'frame'], ['Kanji', 'kanji'], ['Keyword', 'kw']]) hr.append(el('th', cls, label));
    head.append(hr);
    table.append(head);
    for (const [group, hits, title, file] of [
      ['index', r.index, 'Keyword index', fileName('rtkKeywordsUrl')],
      ['deck', r.deck, 'Also found in cards', fileName('rtkDeckUrl')],
    ]) {
      if (!hits.length) continue;
      const body = el('tbody', `group-${group}`);
      const gr = el('tr', 'group-title');
      const th = el('th', null, `${title} `);
      th.colSpan = 3;
      th.append(el('span', 'group-file', `${file} · ${hits.length}`));
      gr.append(th);
      body.append(gr);
      for (const h of hits) {
        const tr = el('tr', 'hit');
        tr.tabIndex = 0;
        tr.append(el('td', 'frame', h.frame), el('td', 'kanji', h.kanji), el('td', 'kw', h.keyword));
        tr.addEventListener('click', () => openCard(h.kanji));
        tr.addEventListener('keydown', (e) => e.key === 'Enter' && openCard(h.kanji));
        body.append(tr);
      }
      table.append(body);
    }
    results.replaceChildren(table);
  }

  // The back of the Anki card:
  //   <span class="kanjivg-animate">{{Kanji}}</span>
  //   <div class="keyword">{{Keyword}}</div>
  //   <div class="story">{{Story}}</div>
  //   {{#Note}}<div class="note">Note: {{Note}}</div>{{/Note}}
  // plus Update, the deck's optional later second thought, styled like Note.
  function showCard(kanji) {
    const f = cardFor(source.index, kanji);
    const k = el('span', 'kanjivg-animate', f.Kanji);
    const keyword = el('div', 'keyword', f.Keyword);
    const story = el('div', 'story');
    story.innerHTML = renderInline(f.Story);
    cardBody.replaceChildren(k, keyword, story);
    for (const name of ['Note', 'Update']) {
      if (!f[name]) continue;
      const d = el('div', 'note');
      d.innerHTML = `${name}: ${renderInline(f[name])}`;
      cardBody.append(d);
    }
    cardFrame.textContent = f.frame ? `Frame ${f.frame}` : '';
    // Falls back to the character in Klee One if there's no KanjiVG drawing.
    window.kanjivgAnimate?.({ root: cardBody, ...KANJIVG }).then(([handle]) => !handle && k.classList.add('no-svg'));
    if (!window.kanjivgAnimate) k.classList.add('no-svg');
  }

  // Opening a card from the results adds a history entry (#rtk/可), so the
  // phone's back gesture returns to the results rather than leaving the app.
  // A card shown because of the URL (a refresh, a bookmark, back/forward)
  // doesn't add one.
  function openCard(kanji, { push = true } = {}) {
    open = kanji;
    showCard(kanji);
    page.classList.add('card-open');
    cardView.scrollTop = 0;
    if (push) {
      const hash = hashFor('rtk', kanji);
      if (history.state?.rtkCard) history.replaceState({ rtkCard: true }, '', hash);
      else history.pushState({ rtkCard: true }, '', hash);
    }
    $('rtk-back').focus({ preventScroll: true });
  }

  function closeCard() {
    open = null;
    page.classList.remove('card-open');
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
    // Called on each sync status change: until the files are on this device,
    // the page shows whether they're being fetched or why that failed.
    refresh: () => !source.loaded && render(),
  };
}
