'use strict';

const path = require('path');
const express = require('express');
const { loadConfig } = require('./config');
const { openDatabase } = require('./db');
const { createAuth } = require('./auth');
const { createApiRouter } = require('./routes/api');

const VIEWS = path.join(__dirname, '..', 'views');
const PUBLIC = path.join(__dirname, '..', 'public');

function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  const db = openDatabase(config);
  const auth = createAuth(db, config);
  const app = express();

  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; " +
        "font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'microphone=(self), camera=(self), geolocation=()');
    next();
  });

  app.use('/static', express.static(PUBLIC, { maxAge: '1h' }));
  app.use(
    '/fonts',
    express.static(path.join(path.dirname(require.resolve('@fontsource/kalam/package.json')), 'files'), { maxAge: '30d' }),
  );
  app.get('/manifest.webmanifest', (req, res) => res.sendFile(path.join(PUBLIC, 'manifest.webmanifest')));

  app.use(express.json({ limit: '1mb' }));
  app.use(auth.loadUser);

  // CSRF protection: state-changing API calls must carry a custom header,
  // which other websites cannot add to cross-site requests.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('X-Diary-Client') !== '1') {
      return res.status(403).json({ error: 'Request blocked.' });
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', createApiRouter({ db, config, auth }));

  const page = (file, { admin = false } = {}) => (req, res) => {
    if (!req.user) return res.redirect('/login');
    if (admin && !req.user.isAdmin) return res.redirect('/');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(VIEWS, file));
  };
  app.get('/', page('diary.html'));
  app.get('/admin', page('admin.html', { admin: true }));
  app.get('/login', (req, res) => {
    if (req.user) return res.redirect('/');
    res.sendFile(path.join(VIEWS, 'login.html'));
  });
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `Each photo must be smaller than ${config.maxUploadMb} MB.` });
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Add up to 10 photos at a time.' });
    }
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Your last change may not be saved.' });
  });

  return { app, db, config };
}

module.exports = { createApp };
