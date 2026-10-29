'use strict';

const { createApp } = require('./src/app');
const { backupDatabase } = require('./src/db');
const { createOwnerFromEnv } = require('./src/auth');

const { app, db, config } = createApp();

try {
  if (createOwnerFromEnv(db, process.env)) console.log(`Created owner account "${process.env.OWNER_USERNAME}".`);
} catch (err) {
  console.error(`Could not create the owner account from OWNER_USERNAME/OWNER_PASSWORD: ${err.message}`);
}

const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

const server = app.listen(config.port, () => {
  console.log(`Diary is open at http://localhost:${config.port}  (data folder: ${config.dataDir})`);
  if (userCount === 0) {
    console.log('No users yet. Set OWNER_USERNAME and OWNER_PASSWORD and restart, or run:  npm run create-user -- --admin <login-id>');
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
