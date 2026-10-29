import { api, localDate, parseDate, addDays, toast, el } from './common.js';
import { createDictation, LANGUAGES } from './voice.js';

const $ = (id) => document.getElementById(id);
const editor = $('editor');
const page = $('page');
const statusEl = $('save-status');
const SAVE_DELAY = 1200;
const REFRESH_MS = 30000;

const state = {
  me: null,
  diaryMode: 'shared',
  date: null,
  version: 0,          // server version this editor text is based on
  dirty: false,
  saving: null,        // promise of the in-flight save
  saveTimer: null,
  retryTimer: null,
  conflict: false,
  loadSeq: 0,
};

// ---------------------------------------------------------------- status

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = `save-status ${kind}`;
}

// ---------------------------------------------------------------- drafts
// Unsaved text is mirrored to this device so closing the tab or losing the
// connection never loses words; it is sent to the server as soon as it can be.

const draftKey = (date = state.date) => `diary-draft:${state.me.id}:${date}`;
function storeDraft() {
  try {
    localStorage.setItem(draftKey(), JSON.stringify({ content: editor.value, baseVersion: state.version, at: Date.now() }));
  } catch { /* storage full or disabled */ }
}
function readDraft(date) {
  try { return JSON.parse(localStorage.getItem(draftKey(date)) || 'null'); } catch { return null; }
}
function clearDraft(date) {
  try { localStorage.removeItem(draftKey(date)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- editor

function autoGrow() {
  const y = window.scrollY;
  editor.style.height = 'auto';
  editor.style.height = `${editor.scrollHeight}px`;
  window.scrollTo(0, y);
}

editor.addEventListener('input', () => {
  autoGrow();
  state.dirty = true;
  storeDraft();
  setStatus('Writing…');
  scheduleSave();
});
editor.addEventListener('blur', () => { if (state.dirty) save(); });

function scheduleSave(delay = SAVE_DELAY) {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(save, delay);
}

async function save() {
  clearTimeout(state.saveTimer);
  if (state.saving) {
    await state.saving;
    if (!state.dirty) return;
  }
  if (!state.dirty || state.conflict) return;
  const date = state.date;
  const content = editor.value;
  const version = state.version;
  state.dirty = false;
  setStatus('Saving…');

  state.saving = (async () => {
    try {
      const { entry } = await api(`/api/days/${date}/entry`, { method: 'PUT', body: { content, version } });
      if (date !== state.date) return;
      state.version = entry.version;
      if (state.dirty) {
        storeDraft();
        scheduleSave(SAVE_DELAY);
      } else {
        clearDraft(date);
        setStatus(`Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
      }
    } catch (err) {
      if (date !== state.date) return;
      state.dirty = true;
      if (err.status === 409) {
        showConflict(err.data.entry);
      } else {
        setStatus(navigator.onLine ? 'Not saved yet, retrying…' : 'Offline: kept on this device', 'error');
        clearTimeout(state.retryTimer);
        state.retryTimer = setTimeout(save, 5000);
      }
    } finally {
      state.saving = null;
    }
  })();
  return state.saving;
}

// Last-chance save when the app is hidden or closed (phones kill tabs freely).
function saveOnExit() {
  if (!state.dirty || state.conflict || !state.date) return;
  storeDraft();
  if (state.saving) return; // the in-flight save will follow up; the draft covers the rest
  api(`/api/days/${state.date}/entry`, {
    method: 'PUT',
    body: { content: editor.value, version: state.version },
    keepalive: true,
  }).then(({ entry }) => {
    state.version = entry.version;
    state.dirty = false;
    clearDraft(state.date);
    setStatus('Saved');
  }).catch(() => {});
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveOnExit();
  else refresh();
});
window.addEventListener('pagehide', saveOnExit);
window.addEventListener('online', () => { if (state.dirty) save(); });

// ---------------------------------------------------------------- conflicts

const conflictDialog = $('conflict-dialog');
let conflictServer = null;

function showConflict(serverEntry) {
  state.conflict = true;
  conflictServer = serverEntry || { content: '', version: 0 };
  $('conflict-other').textContent = conflictServer.content;
  setStatus('Needs your choice', 'error');
  if (!conflictDialog.open) conflictDialog.showModal();
}

conflictDialog.addEventListener('close', () => {
  const choice = conflictDialog.returnValue;
  const server = conflictServer;
  if (!server) return;
  state.conflict = false;
  conflictServer = null;
  state.version = server.version;
  if (choice === 'theirs') {
    editor.value = server.content;
    state.dirty = false;
    clearDraft(state.date);
    setStatus('Saved');
  } else {
    if (choice !== 'mine' && server.content.trim() && server.content.trim() !== editor.value.trim()) {
      editor.value = `${server.content.replace(/\s+$/, '')}\n\n${editor.value}`;
    }
    state.dirty = true;
    storeDraft();
    save();
  }
  autoGrow();
});

// ---------------------------------------------------------------- day pages

const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const fullFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

function renderHead(date) {
  const d = parseDate(date);
  $('weekday').textContent = date === localDate() ? `Today · ${weekdayFmt.format(d)}` : weekdayFmt.format(d);
  $('fulldate').textContent = fullFmt.format(d);
  $('date-input').value = date;
  document.title = `Diary · ${fullFmt.format(d)}`;
}

function photoCard(img, { mine }) {
  const image = el('img', { src: img.url, alt: img.name || 'Photo', loading: 'lazy', decoding: 'async' });
  image.addEventListener('click', () => openViewer(img.url));
  const card = el('figure', { class: 'photo', 'data-id': img.id }, image);
  if (mine) {
    card.append(el('button', {
      class: 'remove', type: 'button', 'aria-label': 'Remove photo', title: 'Remove photo',
      onclick: () => removePhoto(img.id, card),
    }, '✕'));
  }
  return card;
}

function renderMyPhotos(images) {
  $('my-photos').replaceChildren(...images.map((img) => photoCard(img, { mine: true })));
}

function renderOthers(others) {
  $('others').replaceChildren(...others.map((o) => el('div', { class: 'other' },
    el('div', { class: 'other-author' }, `✎ ${o.author}`),
    o.entry && o.entry.content ? el('div', { class: 'other-text' }, o.entry.content) : null,
    o.images.length ? el('div', { class: 'photos' }, o.images.map((img) => photoCard(img, { mine: false }))) : null,
  )));
}

async function openDay(date, { direction = 0, push = true } = {}) {
  if (state.date && state.dirty) await save();
  const seq = ++state.loadSeq;
  clearTimeout(state.retryTimer);
  state.date = date;
  state.dirty = false;
  state.version = 0;
  editor.value = '';
  renderHead(date);
  if (push) history.replaceState(null, '', `#${date}`);
  page.classList.remove('turn-next', 'turn-prev');
  if (direction) { void page.offsetWidth; page.classList.add(direction > 0 ? 'turn-next' : 'turn-prev'); }
  setStatus('Opening…');
  editor.disabled = true;
  try {
    const data = await api(`/api/days/${date}`);
    if (seq !== state.loadSeq) return;
    applyServerDay(data, { initial: true });
    setStatus(data.entry ? 'Saved' : 'New page');
  } catch (err) {
    if (seq !== state.loadSeq) return;
    const draft = readDraft(date);
    if (draft) { editor.value = draft.content; state.version = draft.baseVersion; state.dirty = true; }
    setStatus('Could not open this page, check your connection', 'error');
    state.retryTimer = setTimeout(() => { if (state.date === date) openDay(date, { push: false }); }, 5000);
  } finally {
    if (seq === state.loadSeq) {
      editor.disabled = false;
      autoGrow();
    }
  }
}

function applyServerDay(data, { initial = false } = {}) {
  const server = data.entry || { content: '', version: 0 };
  if (initial) {
    editor.value = server.content;
    state.version = server.version;
    const draft = readDraft(data.date);
    if (draft && draft.content !== server.content) {
      if (draft.baseVersion === server.version) {
        editor.value = draft.content;
        state.dirty = true;
        scheduleSave(300);
      } else {
        editor.value = draft.content;
        state.dirty = true;
        showConflict(server);
      }
    } else if (draft) clearDraft(data.date);
  } else if (!state.dirty && !state.conflict && !state.saving && server.version !== state.version) {
    // Updated from another device while this one sat idle: show the newest text.
    const atEnd = editor.selectionStart === editor.value.length;
    editor.value = server.content;
    state.version = server.version;
    if (atEnd && document.activeElement === editor) editor.setSelectionRange(editor.value.length, editor.value.length);
  }
  renderMyPhotos(data.images);
  renderOthers(data.others);
  autoGrow();
}

// Pick up what other writers (or my other devices) have added.
async function refresh() {
  if (!state.date || document.visibilityState !== 'visible' || document.querySelector('.photo.uploading')) return;
  const seq = state.loadSeq;
  try {
    const data = await api(`/api/days/${state.date}`);
    if (seq === state.loadSeq) applyServerDay(data);
  } catch { /* try again next time */ }
}
setInterval(refresh, REFRESH_MS);

const go = (n) => openDay(addDays(state.date, n), { direction: n });
$('prev-day').addEventListener('click', () => go(-1));
$('next-day').addEventListener('click', () => go(1));
$('today-btn').addEventListener('click', () => {
  const today = localDate();
  if (today !== state.date) openDay(today, { direction: today > state.date ? 1 : -1 });
});
$('date-input').addEventListener('change', (e) => {
  const v = e.target.value;
  if (v && v !== state.date) openDay(v, { direction: v > state.date ? 1 : -1 });
});
window.addEventListener('hashchange', () => {
  const d = location.hash.slice(1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d !== state.date) openDay(d, { push: false });
});
document.addEventListener('keydown', (e) => {
  if (e.altKey && e.key === 'ArrowLeft') go(-1);
  if (e.altKey && e.key === 'ArrowRight') go(1);
});

// Swipe left/right on the page (outside the writing area) to turn pages.
let touch = null;
page.addEventListener('touchstart', (e) => {
  if (e.target === editor || e.touches.length !== 1) { touch = null; return; }
  touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
}, { passive: true });
page.addEventListener('touchend', (e) => {
  if (!touch) return;
  const dx = e.changedTouches[0].clientX - touch.x;
  const dy = e.changedTouches[0].clientY - touch.y;
  if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 2 && Date.now() - touch.t < 600) go(dx < 0 ? 1 : -1);
  touch = null;
}, { passive: true });

// ---------------------------------------------------------------- photos

async function prepareImage(file) {
  // Shrink big camera photos before upload: faster on mobile data, same look.
  if (file.type === 'image/gif' || !('createImageBitmap' in window)) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const max = 2000;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024 && /^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
    if (!blob) return file;
    return new File([blob], (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file; // e.g. HEIC on a browser that can't decode it: the server stores the original
  }
}

$('photo-input').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  const date = state.date;
  const placeholders = files.map((f) => {
    const card = el('figure', { class: 'photo uploading' }, el('img', { src: URL.createObjectURL(f), alt: '' }));
    $('my-photos').append(card);
    return card;
  });
  try {
    for (let i = 0; i < files.length; i += 5) {
      const form = new FormData();
      for (const f of files.slice(i, i + 5)) {
        const ready = await prepareImage(f);
        form.append('images', ready, ready.name || 'photo.jpg');
      }
      const { images, rejected } = await api(`/api/days/${date}/images`, { method: 'POST', form });
      if (rejected && rejected.length) toast(`Skipped files that are not photos: ${rejected.join(', ')}`);
      if (date === state.date) {
        for (const img of images) $('my-photos').append(photoCard(img, { mine: true }));
      }
    }
    toast(files.length === 1 ? 'Photo added' : 'Photos added');
  } catch (err) {
    toast(err.message);
  } finally {
    for (const p of placeholders) { URL.revokeObjectURL(p.querySelector('img').src); p.remove(); }
  }
});

async function removePhoto(id, card) {
  if (!confirm('Remove this photo from the page?')) return;
  try {
    await api(`/api/images/${id}`, { method: 'DELETE' });
    card.remove();
  } catch (err) { toast(err.message); }
}

const viewer = $('viewer');
function openViewer(url) {
  $('viewer-img').src = url;
  viewer.showModal();
}
viewer.addEventListener('click', (e) => { if (e.target === viewer || e.target.id === 'viewer-img') viewer.close(); });

// ---------------------------------------------------------------- voice

const micBtn = $('mic-btn');
const langSelect = $('voice-lang');
const savedLang = (() => { try { return localStorage.getItem('diary-voice-lang'); } catch { return null; } })();
const defaultLang = LANGUAGES.find(([c]) => c === navigator.language)?.[0]
  || LANGUAGES.find(([c]) => c.startsWith((navigator.language || 'en').slice(0, 2)))?.[0] || 'en-IN';
langSelect.replaceChildren(...LANGUAGES.map(([code, name]) => el('option', { value: code }, name)));
langSelect.value = savedLang || defaultLang;
langSelect.addEventListener('change', () => {
  try { localStorage.setItem('diary-voice-lang', langSelect.value); } catch { /* ignore */ }
});

const dictation = createDictation({
  textarea: editor,
  interimEl: $('interim'),
  getLang: () => langSelect.value,
  onStateChange: (on) => {
    micBtn.setAttribute('aria-pressed', String(on));
    micBtn.querySelector('.tool-label').textContent = on ? 'Stop' : 'Speak';
    if (!on && state.dirty) save();
  },
  onError: (msg) => toast(msg, 6000),
});

if (!dictation) {
  micBtn.title = 'Voice typing is not supported in this browser. Use Chrome, Edge or Safari, or the microphone key on your phone keyboard.';
}
micBtn.addEventListener('click', () => {
  if (!dictation) return toast(micBtn.title, 6000);
  if (!window.isSecureContext) return toast('Voice typing needs the diary to be opened over https://', 6000);
  if (dictation.listening) dictation.stop();
  else {
    if (document.activeElement !== editor) {
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
    }
    dictation.start();
  }
});

// ---------------------------------------------------------------- menus

const menu = $('menu');
$('menu-btn').addEventListener('click', () => menu.showModal());
$('index-btn').addEventListener('click', openIndex);

menu.addEventListener('close', async () => {
  switch (menu.returnValue) {
    case 'index': return openIndex();
    case 'voice': return $('voice-dialog').showModal();
    case 'password': return $('password-dialog').showModal();
    case 'export': location.href = '/api/export'; return;
    case 'admin': await save(); location.href = '/admin'; return;
    case 'logout':
      await save();
      await api('/api/logout', { method: 'POST' }).catch(() => {});
      location.href = '/login';
      return;
    default:
  }
});

const pwForm = $('password-form');
pwForm.querySelector('[data-close]').addEventListener('click', () => $('password-dialog').close());
pwForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = pwForm.querySelector('.form-error');
  err.hidden = true;
  try {
    await api('/api/me/password', { method: 'POST', body: Object.fromEntries(new FormData(pwForm)) });
    pwForm.reset();
    $('password-dialog').close();
    toast('Password changed');
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

async function openIndex() {
  const dialog = $('index');
  const list = $('index-list');
  list.replaceChildren(el('p', { class: 'hint' }, 'Loading…'));
  dialog.showModal();
  try {
    const { dates } = await api('/api/dates');
    if (!dates.length) {
      list.replaceChildren(el('p', { class: 'hint' }, 'Nothing written yet. Today is a good day to start.'));
      return;
    }
    const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
    const groups = new Map();
    for (const d of dates) {
      const key = d.date.slice(0, 7);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(d);
    }
    list.replaceChildren(...[...groups].map(([month, days]) => el('div', {},
      el('div', { class: 'index-month' }, monthFmt.format(parseDate(`${month}-01`))),
      el('div', { class: 'index-days' }, days.map((d) => el('button', {
        class: `index-day${d.mine ? ' mine' : ''}${d.date === state.date ? ' current' : ''}`,
        title: d.mine ? 'You wrote on this day' : 'Others wrote on this day',
        onclick: () => { dialog.close(); openDay(d.date, { direction: d.date > state.date ? 1 : -1 }); },
      }, String(Number(d.date.slice(8)))))),
    )));
  } catch (err) {
    list.replaceChildren(el('p', { class: 'form-error' }, err.message));
  }
}

// ---------------------------------------------------------------- start

(async () => {
  const me = await api('/api/me');
  state.me = me.user;
  state.diaryMode = me.diaryMode;
  $('menu-user').textContent = `Signed in as ${me.user.displayName}`;
  document.querySelectorAll('.admin-only').forEach((n) => { n.hidden = !me.user.isAdmin; });
  const fromHash = location.hash.slice(1);
  await openDay(/^\d{4}-\d{2}-\d{2}$/.test(fromHash) ? fromHash : localDate());
  if (matchMedia('(min-width: 700px)').matches) editor.focus();
})();
