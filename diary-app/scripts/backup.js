'use strict';

// Usage: npm run backup
// Writes a consistent copy of the database into data/backups/ (safe to run
// while the app is in use). Copy the whole data/ folder for a full backup
// including photos.
const { loadConfig } = require('../src/config');
const { openDatabase, backupDatabase } = require('../src/db');

const config = loadConfig();
const db = openDatabase(config);
console.log('Backup written to', backupDatabase(db, config));
db.close();
