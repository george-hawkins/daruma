// Forgotten kanji: capture list (newest first) and a finger-drawing scratch pad.

import { load, save } from './store.js';
import { el, gestures, menu, promptText, debounce } from './ui.js';
import { newItem, endsGroup, locate } from './markdown.js';

// Brush diameter as a fraction of the drawing area's shorter side.
const BRUSH = 0.035;

export function initKanji(doc, { lookUp }) {
  const page = document.getElementById('page-kanji');
  const list = document.getElementById('kanji-list');
  const form = document.getElementById('kanji-add-form');
  const input = document.getElementById('kanji-add');
  const toggle = document.getElementById('kanji-toggle');

  const restoreScroll = () => (list.scrollTop = load('scroll:kanji', 0));

  function render() {
    const items = doc.data.items;
    list.replaceChildren(...items.map((it, i) => {
      const li = el('li', endsGroup(items, i) ? 'group-end' : null, it.text);
      gestures(li, { onTap: () => lookUp(it.text), onLongPress: () => itemMenu(i) });
      return li;
    }));
  }

  // The list may change while a dialog is open, so the item is looked up
  // again afterwards rather than trusting its index.
  async function itemMenu(i) {
    const item = doc.data.items[i];
    const text = item.text;
    const choice = await menu(text, [['Edit', 'edit'], ['Delete', 'delete', 'danger'], ['Cancel', null]]);
    if (choice === 'delete') {
      const j = locate(doc.data.items, item);
      if (j < 0) return;
      doc.data.items.splice(j, 1);
    } else if (choice === 'edit') {
      const edited = (await promptText('Edit', text))?.trim();
      const j = locate(doc.data.items, item);
      if (!edited || edited === text || j < 0) return;
      doc.data.items[j].text = edited; // stays in its group
    } else {
      return;
    }
    doc.changed();
    render();
  }

  // The text being typed is kept too, in case the app is closed mid-entry.
  input.value = load('draft:kanji', '');
  input.addEventListener('input', () => save('draft:kanji', input.value));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text) {
      doc.data.items.unshift(newItem(doc.data.items, text));
      doc.changed();
      render();
      list.scrollTop = 0;
    }
    input.value = '';
    save('draft:kanji', '');
    input.focus(); // ready for the next word
  });

  list.addEventListener('scroll', debounce(() => save('scroll:kanji', list.scrollTop), 150), { passive: true });

  const setHidden = (hidden) => {
    page.classList.toggle('list-hidden', hidden);
    save('kanji:listHidden', hidden);
    if (!hidden) restoreScroll();
  };
  toggle.addEventListener('click', () => setHidden(!page.classList.contains('list-hidden')));
  setHidden(load('kanji:listHidden', false));

  const pad = initPad(document.getElementById('kanji-canvas'));
  document.getElementById('kanji-clear').addEventListener('click', pad.clear);

  doc.on((kind) => kind === 'remote' && render());
  render();

  return { onShow: restoreScroll };
}

function initPad(canvas) {
  const ctx = canvas.getContext('2d');
  let dpr = 1, width = 6, rect = null;

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return; // page hidden
    // Keep what's drawn if the area changes size (e.g. keyboard, rotation).
    let old = null;
    if (canvas.width) {
      old = document.createElement('canvas');
      old.width = canvas.width;
      old.height = canvas.height;
      old.getContext('2d').drawImage(canvas, 0, 0);
    }
    const oldDpr = dpr;
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    if (old) ctx.drawImage(old, 0, 0, (old.width / oldDpr) * dpr, (old.height / oldDpr) * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ctx.fillStyle = '#000';
    width = Math.max(3, Math.min(r.width, r.height) * BRUSH);
  }
  new ResizeObserver(resize).observe(canvas);

  let active = null, last = null, lastMid = null;
  const pos = (e) => ({ x: e.clientX - rect.left, y: e.clientY - rect.top });

  function segment(from, ctrl, to) {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y);
    ctx.stroke();
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (active !== null) return; // ignore extra fingers / palm
    e.preventDefault();
    active = e.pointerId;
    canvas.setPointerCapture(active);
    rect = canvas.getBoundingClientRect();
    last = lastMid = pos(e);
    ctx.beginPath();
    ctx.arc(last.x, last.y, width / 2, 0, Math.PI * 2);
    ctx.fill();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== active) return;
    const events = e.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e]) {
      const p = pos(ev);
      const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
      segment(lastMid, last, mid);
      last = p;
      lastMid = mid;
    }
  });

  // A cancelled stroke (e.g. a system gesture took over) stops where it is.
  const end = (e) => {
    if (e.pointerId !== active) return;
    segment(lastMid, last, e.type === 'pointerup' ? pos(e) : last);
    active = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  return {
    clear() {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    },
  };
}
