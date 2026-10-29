'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const { createUser } = require('../src/auth');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

function start(dataDir, overrides = {}) {
  const { app, db } = createApp({ dataDir, cookieSecure: false, ...overrides });
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ base, db, close: () => new Promise((r) => server.close(() => { db.close(); r(); })) });
    });
  });
}

function client(base) {
  let cookie = '';
  return async function call(p, { method = 'GET', body, form, headers = {} } = {}) {
    const h = { 'X-Diary-Client': '1', ...headers };
    if (cookie) h.Cookie = cookie;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + p, { method, headers: h, body: payload, redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, headers: res.headers };
  };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'diary-test-'));

test('only invited people can open the diary', async () => {
  const dir = tmp();
  const srv = await start(dir);
  createUser(srv.db, { username: 'owner', password: 'correct-horse', isAdmin: true });
  const anon = client(srv.base);

  assert.equal((await anon('/api/days/2026-10-29')).status, 401);
  const page = await anon('/');
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), '/login');

  assert.equal((await anon('/api/login', { method: 'POST', body: { username: 'owner', password: 'wrong-pass' } })).status, 401);
  // Missing CSRF header is rejected.
  const noHeader = await fetch(`${srv.base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'owner', password: 'correct-horse' }),
  });
  assert.equal(noHeader.status, 403);

  const owner = client(srv.base);
  assert.equal((await owner('/api/login', { method: 'POST', body: { username: 'OWNER', password: 'correct-horse' } })).status, 200);
  assert.equal((await owner('/api/me')).json.user.username, 'owner');

  // Admin invites a friend; friend can sign in; non-admin cannot invite.
  const created = await owner('/api/admin/users', {
    method: 'POST', body: { username: 'friend', displayName: 'Friend', password: 'friend-pass-1' },
  });
  assert.equal(created.status, 201);
  const friend = client(srv.base);
  assert.equal((await friend('/api/login', { method: 'POST', body: { username: 'friend', password: 'friend-pass-1' } })).status, 200);
  assert.equal((await friend('/api/admin/users')).status, 403);

  // Removing access signs them out immediately.
  await owner(`/api/admin/users/${created.json.user.id}`, { method: 'PATCH', body: { disabled: true } });
  assert.equal((await friend('/api/me')).status, 401);
  // The last owner cannot lock themselves out.
  const meId = (await owner('/api/me')).json.user.id;
  assert.equal((await owner(`/api/admin/users/${meId}`, { method: 'PATCH', body: { disabled: true } })).status, 400);
  await srv.close();
});

test('pages save, detect conflicts, and keep revisions', async () => {
  const dir = tmp();
  const srv = await start(dir);
  createUser(srv.db, { username: 'alice', displayName: 'Alice', password: 'alice-pass' });
  createUser(srv.db, { username: 'bob', displayName: 'Bob', password: 'bob-pass-1' });
  const alice = client(srv.base);
  const bob = client(srv.base);
  await alice('/api/login', { method: 'POST', body: { username: 'alice', password: 'alice-pass' } });
  await bob('/api/login', { method: 'POST', body: { username: 'bob', password: 'bob-pass-1' } });

  const day = '/api/days/2026-10-29';
  assert.equal((await alice(day)).json.entry, null);
  let r = await alice(`${day}/entry`, { method: 'PUT', body: { content: 'Morning walk.', version: 0 } });
  assert.equal(r.json.entry.version, 1);
  r = await alice(`${day}/entry`, { method: 'PUT', body: { content: 'Morning walk. Rain later.', version: 1 } });
  assert.equal(r.json.entry.version, 2);

  // A stale device trying to overwrite gets a 409 with the latest text.
  r = await alice(`${day}/entry`, { method: 'PUT', body: { content: 'stale', version: 1 } });
  assert.equal(r.status, 409);
  assert.equal(r.json.entry.content, 'Morning walk. Rain later.');

  // Bob writes the same day at the same time without touching Alice's page.
  const writes = [];
  for (let i = 0; i < 20; i++) {
    writes.push(bob(`${day}/entry`, { method: 'PUT', body: { content: `Bob ${i}`, version: i } }));
  }
  const results = await Promise.all(writes);
  assert.ok(results.every((x) => x.status === 200 || x.status === 409));
  const bobView = (await bob(day)).json;
  assert.equal(bobView.others[0].author, 'Alice');
  assert.equal(bobView.others[0].entry.content, 'Morning walk. Rain later.');

  const revisions = srv.db.prepare(
    "SELECT COUNT(*) AS n FROM entry_revisions r JOIN entries e ON e.id = r.entry_id JOIN users u ON u.id = e.user_id WHERE u.username = 'alice'",
  ).get().n;
  assert.equal(revisions, 2);

  assert.equal((await alice('/api/days/2026-02-30')).status, 400);
  const dates = (await alice('/api/dates')).json.dates;
  assert.deepEqual(dates, [{ date: '2026-10-29', mine: true }]);
  await srv.close();
});

test('photos upload, are protected, and only real images are accepted', async () => {
  const dir = tmp();
  const srv = await start(dir);
  createUser(srv.db, { username: 'alice', password: 'alice-pass' });
  const alice = client(srv.base);
  await alice('/api/login', { method: 'POST', body: { username: 'alice', password: 'alice-pass' } });

  const form = new FormData();
  form.append('images', new Blob([PNG], { type: 'image/png' }), 'dot.png');
  const up = await alice('/api/days/2026-10-29/images', { method: 'POST', form });
  assert.equal(up.status, 200);
  assert.equal(up.json.images.length, 1);
  const url = up.json.images[0].url;

  const img = await alice(url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await client(srv.base)(url)).status, 401);

  const bad = new FormData();
  bad.append('images', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'evil.png');
  assert.equal((await alice('/api/days/2026-10-29/images', { method: 'POST', form: bad })).status, 400);

  assert.equal((await alice(url, { method: 'DELETE' })).status, 200);
  assert.equal((await alice(url)).status, 404);
  await srv.close();
});

test('private mode hides other writers', async () => {
  const dir = tmp();
  const srv = await start(dir, { diaryMode: 'private' });
  createUser(srv.db, { username: 'alice', password: 'alice-pass' });
  createUser(srv.db, { username: 'bob', password: 'bob-pass-1' });
  const alice = client(srv.base);
  const bob = client(srv.base);
  await alice('/api/login', { method: 'POST', body: { username: 'alice', password: 'alice-pass' } });
  await bob('/api/login', { method: 'POST', body: { username: 'bob', password: 'bob-pass-1' } });
  await alice('/api/days/2026-10-29/entry', { method: 'PUT', body: { content: 'secret', version: 0 } });
  assert.deepEqual((await bob('/api/days/2026-10-29')).json.others, []);
  assert.deepEqual((await bob('/api/dates')).json.dates, []);
  await srv.close();
});

test('entries survive restarts and new schema migrations', async () => {
  const dir = tmp();
  let srv = await start(dir);
  createUser(srv.db, { username: 'alice', password: 'alice-pass' });
  let alice = client(srv.base);
  await alice('/api/login', { method: 'POST', body: { username: 'alice', password: 'alice-pass' } });
  await alice('/api/days/2026-10-29/entry', { method: 'PUT', body: { content: 'Day one.', version: 0 } });
  await srv.close();

  // Simulate shipping a new feature a month later that adds a column.
  const migrations = require('../src/migrations');
  migrations.push({ version: 999, name: 'test: add mood', up: (db) => db.exec('ALTER TABLE entries ADD COLUMN mood TEXT') });
  try {
    srv = await start(dir);
    alice = client(srv.base);
    await alice('/api/login', { method: 'POST', body: { username: 'alice', password: 'alice-pass' } });
    assert.equal((await alice('/api/days/2026-10-29')).json.entry.content, 'Day one.');
    assert.ok(fs.readdirSync(path.join(dir, 'backups')).some((f) => f.startsWith('pre-migration-v999')));
    await srv.close();
  } finally {
    migrations.pop();
  }
});
