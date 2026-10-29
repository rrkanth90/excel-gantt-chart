'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const migrations = require('./migrations');

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function openDatabase(config) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.uploadDir, { recursive: true });
  fs.mkdirSync(config.backupDir, { recursive: true });

  const db = new Database(config.dbFile);
  // WAL lets many readers work while one writer commits, which is what keeps
  // simultaneous writers fast. busy_timeout makes competing writers wait
  // instead of failing.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  migrate(db, config);
  return db;
}

function migrate(db, config) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);

  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const pending = migrations.filter((m) => !applied.has(m.version)).sort((a, b) => a.version - b.version);
  if (pending.length === 0) return;

  // Safety net: snapshot an existing database before changing its schema.
  if (applied.size > 0) {
    const file = path.join(config.backupDir, `pre-migration-v${pending[0].version}-${timestamp()}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  }

  for (const m of pending) {
    db.transaction(() => {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
    })();
  }
}

function backupDatabase(db, config) {
  const file = path.join(config.backupDir, `diary-${timestamp()}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

module.exports = { openDatabase, backupDatabase };
