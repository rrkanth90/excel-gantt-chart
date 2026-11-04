import { api, parseDate, el } from './common.js';

const book = document.getElementById('book');
const button = document.getElementById('save-pdf');
const params = new URLSearchParams(location.search);
const from = params.get('from');
const to = params.get('to');
const everyone = params.get('everyone') === '1';

const fullFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long' });

function writerBlock(w, showAuthor) {
  return el('section', { class: `print-writer${w.mine ? ' mine' : ''}` },
    showAuthor ? el('div', { class: 'print-author' }, w.mine ? `✎ ${w.author} (me)` : `✎ ${w.author}`) : null,
    w.content ? el('p', { class: 'print-text' }, w.content) : null,
    w.images.length
      ? el('div', { class: 'print-photos' }, w.images.map((img) => el('figure', {}, el('img', { src: img.url, alt: img.name || 'Photo' }))))
      : null,
  );
}

function dayPage(day) {
  const d = parseDate(day.date);
  // Name each writer when the page has more than one, or when it isn't mine.
  const showAuthor = day.writers.length > 1 || !day.writers[0].mine;
  return el('article', { class: 'print-sheet' },
    el('header', { class: 'print-date' },
      el('div', { class: 'wd' }, weekdayFmt.format(d)),
      el('div', { class: 'dt' }, fullFmt.format(d))),
    day.writers.map((w) => writerBlock(w, showAuthor)),
  );
}

async function whenLoaded() {
  await Promise.all([...book.querySelectorAll('img')].map((img) => img.decode().catch(() => {})));
  if (document.fonts) await document.fonts.ready;
}

(async () => {
  try {
    const query = new URLSearchParams({ from, to, everyone: everyone ? '1' : '0' });
    const [{ user }, data] = await Promise.all([api('/api/me'), api(`/api/pages?${query}`)]);
    const range = from === to ? fullFmt.format(parseDate(from)) : `${fullFmt.format(parseDate(from))} – ${fullFmt.format(parseDate(to))}`;
    document.title = `Diary ${from === to ? from : `${from} to ${to}`}`;
    if (!data.days.length) {
      book.replaceChildren(el('p', { class: 'print-empty' }, `Nothing was written between ${range}.`));
      button.textContent = 'Nothing to save';
      return;
    }
    book.replaceChildren(
      el('section', { class: 'print-sheet print-cover' },
        el('div', {},
          el('h1', {}, 'My Diary'),
          el('p', {}, range),
          el('p', {}, `${data.days.length} ${data.days.length === 1 ? 'page' : 'pages'} · ${everyone ? 'everyone\'s writing' : `written by ${user.displayName}`}`))),
      ...data.days.map(dayPage),
    );
    await whenLoaded();
    button.textContent = 'Save as PDF';
    button.disabled = false;
  } catch (err) {
    book.replaceChildren(el('p', { class: 'print-empty' }, err.message));
    button.textContent = 'Could not prepare pages';
  }
})();

button.addEventListener('click', () => window.print());
