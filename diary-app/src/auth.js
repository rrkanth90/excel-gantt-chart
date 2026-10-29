'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const COOKIE = 'diary_sid';
const MIN_PASSWORD = 8;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return `Password must be at least ${MIN_PASSWORD} characters.`;
  }
  if (password.length > 200) return 'Password is too long.';
  return null;
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 12);
}

function createUser(db, { username, displayName, password, isAdmin = false }) {
  username = String(username || '').trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) {
    throw new Error('Login ID must be 3-40 characters: letters, numbers, dot, dash or underscore.');
  }
  const problem = validatePassword(password);
  if (problem) throw new Error(problem);
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  if (exists) throw new Error('That login ID is already taken.');
  const info = db
    .prepare('INSERT INTO users (username, display_name, password_hash, is_admin) VALUES (?, ?, ?, ?)')
    .run(username, String(displayName || username).trim().slice(0, 60) || username, hashPassword(password), isAdmin ? 1 : 0);
  return info.lastInsertRowid;
}

// Lets hosts without a terminal create the first owner from environment
// variables. Only acts on an empty diary, so it can never touch existing users.
function createOwnerFromEnv(db, env) {
  if (!env.OWNER_USERNAME || !env.OWNER_PASSWORD) return false;
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return false;
  createUser(db, {
    username: env.OWNER_USERNAME,
    displayName: env.OWNER_DISPLAY_NAME || env.OWNER_USERNAME,
    password: env.OWNER_PASSWORD,
    isAdmin: true,
  });
  return true;
}

// Simple brute-force protection: too many failed logins for the same
// login ID or from the same address locks that key out for a while.
class LoginLimiter {
  constructor({ maxFailures = 8, windowMs = 15 * 60 * 1000 } = {}) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.failures = new Map();
  }
  _keys(ip, username) {
    return [`ip:${ip}`, `user:${String(username || '').toLowerCase()}`];
  }
  isBlocked(ip, username) {
    const now = Date.now();
    return this._keys(ip, username).some((k) => {
      const rec = this.failures.get(k);
      if (!rec) return false;
      if (now - rec.first > this.windowMs) {
        this.failures.delete(k);
        return false;
      }
      return rec.count >= this.maxFailures;
    });
  }
  fail(ip, username) {
    const now = Date.now();
    for (const k of this._keys(ip, username)) {
      const rec = this.failures.get(k);
      if (!rec || now - rec.first > this.windowMs) this.failures.set(k, { count: 1, first: now });
      else rec.count += 1;
    }
  }
  succeed(ip, username) {
    this.failures.delete(`user:${String(username || '').toLowerCase()}`);
  }
}

function createAuth(db, config) {
  const ttlMs = config.sessionDays * 24 * 60 * 60 * 1000;
  const limiter = new LoginLimiter();

  const findSession = db.prepare(`
    SELECT s.token_hash, s.expires_at, u.id, u.username, u.display_name, u.is_admin
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND u.disabled = 0`);

  function setCookie(res, token, maxAgeMs) {
    const parts = [
      `${COOKIE}=${token}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    ];
    if (config.cookieSecure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  function startSession(res, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
      sha256(token),
      userId,
      Date.now() + ttlMs,
    );
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    setCookie(res, token, ttlMs);
  }

  function endSession(req, res) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    setCookie(res, '', 0);
  }

  // Attaches req.user when the request carries a valid session cookie.
  function loadUser(req, res, next) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const hash = sha256(token);
      const row = findSession.get(hash);
      if (row && row.expires_at > Date.now()) {
        req.user = { id: row.id, username: row.username, displayName: row.display_name, isAdmin: !!row.is_admin };
        // Sliding expiry: keep active writers signed in.
        if (row.expires_at - Date.now() < ttlMs / 2) {
          db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(Date.now() + ttlMs, hash);
          setCookie(res, token, ttlMs);
        }
      }
    }
    next();
  }

  function requireUser(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    next();
  }

  function requireAdmin(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Only the diary owner can do that.' });
    next();
  }

  function login(username, password, ip) {
    if (limiter.isBlocked(ip, username)) {
      return { error: 'Too many attempts. Please wait 15 minutes and try again.', status: 429 };
    }
    const user = db
      .prepare('SELECT id, password_hash, disabled FROM users WHERE username = ?')
      .get(String(username || '').trim());
    // Always run bcrypt so response time does not reveal whether the user exists.
    const ok = bcrypt.compareSync(String(password || ''), user ? user.password_hash : '$2a$12$' + 'x'.repeat(53));
    if (!user || !ok || user.disabled) {
      limiter.fail(ip, username);
      return { error: 'Login ID or password is incorrect.', status: 401 };
    }
    limiter.succeed(ip, username);
    return { userId: user.id };
  }

  return { loadUser, requireUser, requireAdmin, startSession, endSession, login };
}

module.exports = { createAuth, createUser, createOwnerFromEnv, hashPassword, validatePassword, parseCookies };
