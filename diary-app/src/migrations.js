'use strict';

// Append-only list of schema changes.
//
// RULES (these are what keep your existing entries safe as the app grows):
//   * Never edit or delete a migration that has already shipped.
//   * Only ever add a new object with the next version number at the end.
//   * Prefer additive changes (new tables, new nullable columns). If a column
//     must change shape, copy the data across in the same migration.
// Each migration runs inside a transaction and the database is backed up
// automatically before any pending migration is applied.
module.exports = [
  {
    version: 1,
    name: 'initial schema',
    up(db) {
      db.exec(`
        CREATE TABLE users (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
          display_name  TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          is_admin      INTEGER NOT NULL DEFAULT 0,
          disabled      INTEGER NOT NULL DEFAULT 0,
          created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );

        CREATE TABLE sessions (
          token_hash TEXT PRIMARY KEY,
          user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX idx_sessions_user ON sessions(user_id);

        -- One page per writer per day.
        CREATE TABLE entries (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id    INTEGER NOT NULL REFERENCES users(id),
          entry_date TEXT NOT NULL,              -- YYYY-MM-DD
          content    TEXT NOT NULL DEFAULT '',
          version    INTEGER NOT NULL DEFAULT 1, -- optimistic concurrency
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          UNIQUE (user_id, entry_date)
        );
        CREATE INDEX idx_entries_date ON entries(entry_date);

        CREATE TABLE images (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id       INTEGER NOT NULL REFERENCES users(id),
          entry_date    TEXT NOT NULL,
          stored_name   TEXT NOT NULL UNIQUE,    -- path relative to uploads/
          original_name TEXT,
          mime_type     TEXT NOT NULL,
          size_bytes    INTEGER NOT NULL,
          created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );
        CREATE INDEX idx_images_day ON images(entry_date, user_id);

        -- Every saved version of a page, so nothing typed is ever truly lost.
        CREATE TABLE entry_revisions (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          entry_id   INTEGER NOT NULL REFERENCES entries(id),
          version    INTEGER NOT NULL,
          content    TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );
        CREATE INDEX idx_revisions_entry ON entry_revisions(entry_id, version);
      `);
    },
  },
];
