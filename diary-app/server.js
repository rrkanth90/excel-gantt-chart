'use strict';

const { createApp } = require('./src/app');
const { backupDatabase } = require('./src/db');

const { app, db, config } = createApp();

const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

const server = app.listen(config.port, () => {
  console.log(`Diary is open at http://localhost:${config.port}  (data folder: ${config.dataDir})`);
  if (userCount === 0) {
    console.log('No users yet. Create the owner account with:  npm run create-user -- --admin <login-id>');
  }
});

// Daily automatic backup of the database, keeping the most recent 14.
const fs = require('fs');
const path = require('path');
function dailyBackup() {
  try {
    backupDatabase(db, config);
    const old = fs
      .readdirSync(config.backupDir)
      .filter((f) => /^diary-.*\.db$/.test(f))
      .sort()
      .slice(0, -14);
    for (const f of old) fs.rmSync(path.join(config.backupDir, f), { force: true });
  } catch (err) {
    console.error('Backup failed:', err);
  }
}
dailyBackup();
setInterval(dailyBackup, 24 * 60 * 60 * 1000).unref();

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
