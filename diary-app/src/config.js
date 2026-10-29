'use strict';

const path = require('path');

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function loadConfig(overrides = {}) {
  const env = process.env;
  const production = env.NODE_ENV === 'production';
  const config = {
    port: Number(env.PORT) || 3000,
    // Everything that must survive upgrades lives in this one folder:
    // the SQLite database, uploaded images and automatic backups.
    dataDir: path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data')),
    // "shared": everyone with a login sees every writer's page for a day.
    // "private": each person only ever sees their own pages.
    diaryMode: env.DIARY_MODE === 'private' ? 'private' : 'shared',
    sessionDays: Number(env.SESSION_DAYS) || 30,
    cookieSecure: bool(env.COOKIE_SECURE, production),
    trustProxy: bool(env.TRUST_PROXY, false),
    maxUploadMb: Number(env.MAX_UPLOAD_MB) || 15,
    ...overrides,
  };
  config.dbFile = path.join(config.dataDir, 'diary.db');
  config.uploadDir = path.join(config.dataDir, 'uploads');
  config.backupDir = path.join(config.dataDir, 'backups');
  return config;
}

module.exports = { loadConfig };
