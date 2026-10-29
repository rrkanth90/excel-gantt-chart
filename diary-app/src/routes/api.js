'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { hashPassword, validatePassword, createUser } = require('../auth');

const MAX_CONTENT = 200000;

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Identify image type from the file's first bytes rather than trusting the
// browser-supplied name or MIME type.
function sniffImage(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.slice(0, 6).toString('latin1'))) return { mime: 'image/gif', ext: 'gif' };
  if (buf.length >= 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (buf.length >= 12 && buf.slice(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.slice(8, 12).toString('latin1');
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return { mime: 'image/heic', ext: 'heic' };
    if (brand === 'avif' || brand === 'avis') return { mime: 'image/avif', ext: 'avif' };
  }
  return null;
}

function readHead(file, n = 16) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(n);
    const read = fs.readSync(fd, buf, 0, n, 0);
    return buf.slice(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

function createApiRouter({ db, config, auth }) {
  const router = express.Router();
  const shared = config.diaryMode === 'shared';
  const tmpDir = path.join(config.uploadDir, '.tmp');
  fs.mkdirSync(tmpDir, { recursive: true });

  const upload = multer({
    dest: tmpDir,
    limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 10 },
  });

  const imageJson = (row) => ({
    id: row.id,
    url: `/api/images/${row.id}`,
    name: row.original_name,
    createdAt: row.created_at,
  });
  const entryJson = (row) =>
    row ? { content: row.content, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at } : null;

  // ---- session --------------------------------------------------------------

  router.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    const result = auth.login(username, password, req.ip);
    if (result.error) return res.status(result.status).json({ error: result.error });
    auth.startSession(res, result.userId);
    res.json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    auth.endSession(req, res);
    res.json({ ok: true });
  });

  router.use(auth.requireUser);

  router.get('/me', (req, res) => {
    res.json({ user: req.user, diaryMode: config.diaryMode, maxUploadMb: config.maxUploadMb });
  });

  router.post('/me/password', (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(String(currentPassword || ''), row.password_hash)) {
      return res.status(400).json({ error: 'Your current password is not correct.' });
    }
    const problem = validatePassword(newPassword);
    if (problem) return res.status(400).json({ error: problem });
    db.prepare("UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(
      hashPassword(newPassword),
      req.user.id,
    );
    res.json({ ok: true });
  });

  // ---- day pages -------------------------------------------------------------

  router.param('date', (req, res, next, value) => {
    if (!isValidDate(value)) return res.status(400).json({ error: 'Invalid date.' });
    next();
  });

  router.get('/days/:date', (req, res) => {
    const date = req.params.date;
    const mine = db.prepare('SELECT * FROM entries WHERE user_id = ? AND entry_date = ?').get(req.user.id, date);
    const myImages = db
      .prepare('SELECT * FROM images WHERE user_id = ? AND entry_date = ? ORDER BY id')
      .all(req.user.id, date)
      .map(imageJson);

    let others = [];
    if (shared) {
      const writers = db
        .prepare(
          `SELECT u.id, u.display_name FROM users u
           WHERE u.id != ? AND (
             EXISTS (SELECT 1 FROM entries e WHERE e.user_id = u.id AND e.entry_date = ? AND e.content != '')
             OR EXISTS (SELECT 1 FROM images i WHERE i.user_id = u.id AND i.entry_date = ?))
           ORDER BY u.display_name`,
        )
        .all(req.user.id, date, date);
      const entryStmt = db.prepare('SELECT * FROM entries WHERE user_id = ? AND entry_date = ?');
      const imgStmt = db.prepare('SELECT * FROM images WHERE user_id = ? AND entry_date = ? ORDER BY id');
      others = writers.map((w) => ({
        author: w.display_name,
        entry: entryJson(entryStmt.get(w.id, date)),
        images: imgStmt.all(w.id, date).map(imageJson),
      }));
    }

    res.json({ date, entry: entryJson(mine), images: myImages, others });
  });

  // Save my page for a day. The client sends the version it started editing
  // from; if the page changed meanwhile (e.g. edited on another device) the
  // save is rejected with 409 and the latest copy so nothing is overwritten.
  router.put('/days/:date/entry', (req, res) => {
    const { content, version } = req.body || {};
    if (typeof content !== 'string') return res.status(400).json({ error: 'Content is required.' });
    if (content.length > MAX_CONTENT) return res.status(413).json({ error: 'This page is too long.' });
    const baseVersion = Number(version) || 0;

    const result = db.transaction(() => {
      const existing = db
        .prepare('SELECT * FROM entries WHERE user_id = ? AND entry_date = ?')
        .get(req.user.id, req.params.date);
      if (!existing) {
        const info = db
          .prepare('INSERT INTO entries (user_id, entry_date, content, version) VALUES (?, ?, ?, 1)')
          .run(req.user.id, req.params.date, content);
        db.prepare('INSERT INTO entry_revisions (entry_id, version, content) VALUES (?, 1, ?)').run(info.lastInsertRowid, content);
        return { row: db.prepare('SELECT * FROM entries WHERE id = ?').get(info.lastInsertRowid) };
      }
      if (existing.version !== baseVersion) return { conflict: existing };
      if (existing.content === content) return { row: existing };
      db.prepare(
        "UPDATE entries SET content = ?, version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
      ).run(content, existing.id);
      db.prepare('INSERT INTO entry_revisions (entry_id, version, content) VALUES (?, ?, ?)').run(
        existing.id,
        existing.version + 1,
        content,
      );
      return { row: db.prepare('SELECT * FROM entries WHERE id = ?').get(existing.id) };
    })();

    if (result.conflict) {
      return res.status(409).json({ error: 'This page was changed somewhere else.', entry: entryJson(result.conflict) });
    }
    res.json({ entry: entryJson(result.row) });
  });

  router.post('/days/:date/images', upload.array('images', 10), (req, res) => {
    const files = req.files || [];
    const saved = [];
    const rejected = [];
    for (const file of files) {
      try {
        const kind = sniffImage(readHead(file.path));
        if (!kind) {
          rejected.push(file.originalname);
          continue;
        }
        const [y, m] = req.params.date.split('-');
        const relative = path.posix.join(y, m, `${crypto.randomUUID()}.${kind.ext}`);
        const target = path.join(config.uploadDir, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(file.path, target);
        const info = db
          .prepare(
            'INSERT INTO images (user_id, entry_date, stored_name, original_name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(req.user.id, req.params.date, relative, String(file.originalname || '').slice(0, 200), kind.mime, file.size);
        saved.push(imageJson(db.prepare('SELECT * FROM images WHERE id = ?').get(info.lastInsertRowid)));
      } finally {
        fs.rm(file.path, { force: true }, () => {});
      }
    }
    if (saved.length === 0 && files.length > 0) {
      return res.status(400).json({ error: 'Only photos (JPEG, PNG, GIF, WebP, HEIC) can be added.' });
    }
    res.json({ images: saved, rejected });
  });

  router.get('/images/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM images WHERE id = ?').get(Number(req.params.id));
    if (!row || (!shared && row.user_id !== req.user.id)) return res.status(404).end();
    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(path.join(config.uploadDir, row.stored_name), (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  router.delete('/images/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM images WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
    if (!row) return res.status(404).json({ error: 'Photo not found.' });
    db.prepare('DELETE FROM images WHERE id = ?').run(row.id);
    fs.rm(path.join(config.uploadDir, row.stored_name), { force: true }, () => {});
    res.json({ ok: true });
  });

  // Dates that have something written on them (for the index / contents page).
  router.get('/dates', (req, res) => {
    const who = shared ? '' : 'AND user_id = @me';
    const rows = db
      .prepare(
        `SELECT entry_date AS date, MAX(mine) AS mine FROM (
           SELECT entry_date, user_id = @me AS mine FROM entries WHERE content != '' ${who}
           UNION ALL
           SELECT entry_date, user_id = @me AS mine FROM images WHERE 1 ${who}
         ) GROUP BY entry_date ORDER BY entry_date DESC`,
      )
      .all({ me: req.user.id });
    res.json({ dates: rows.map((r) => ({ date: r.date, mine: !!r.mine })) });
  });

  // Download everything you have written as JSON (your data is always yours).
  router.get('/export', (req, res) => {
    const entries = db
      .prepare('SELECT entry_date, content, created_at, updated_at FROM entries WHERE user_id = ? ORDER BY entry_date')
      .all(req.user.id);
    const images = db
      .prepare('SELECT id, entry_date, original_name, mime_type, created_at FROM images WHERE user_id = ? ORDER BY id')
      .all(req.user.id);
    res.setHeader('Content-Disposition', `attachment; filename="diary-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ exportedAt: new Date().toISOString(), user: req.user.username, entries, images });
  });

  // ---- admin: managing who can open the diary -----------------------------

  const admin = express.Router();
  admin.use(auth.requireAdmin);

  const userJson = (u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    isAdmin: !!u.is_admin,
    disabled: !!u.disabled,
    createdAt: u.created_at,
  });

  admin.get('/users', (req, res) => {
    res.json({ users: db.prepare('SELECT * FROM users ORDER BY created_at').all().map(userJson) });
  });

  admin.post('/users', (req, res) => {
    try {
      const { username, displayName, password, isAdmin } = req.body || {};
      const id = createUser(db, { username, displayName, password, isAdmin: !!isAdmin });
      res.status(201).json({ user: userJson(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  admin.patch('/users/:id', (req, res) => {
    const id = Number(req.params.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const { password, disabled, isAdmin, displayName } = req.body || {};

    const removingAdmin = (disabled === true || isAdmin === false) && user.is_admin && !user.disabled;
    if (removingAdmin) {
      const admins = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND disabled = 0').get().n;
      if (admins <= 1) return res.status(400).json({ error: 'The diary needs at least one active owner.' });
    }

    db.transaction(() => {
      if (typeof password === 'string') {
        const problem = validatePassword(password);
        if (problem) throw Object.assign(new Error(problem), { status: 400 });
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      }
      if (typeof disabled === 'boolean') {
        db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, id);
        if (disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      }
      if (typeof isAdmin === 'boolean') db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, id);
      if (typeof displayName === 'string' && displayName.trim()) {
        db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName.trim().slice(0, 60), id);
      }
      db.prepare("UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(id);
    })();

    res.json({ user: userJson(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
  });

  router.use('/admin', admin);

  return router;
}

module.exports = { createApiRouter, isValidDate, sniffImage };
