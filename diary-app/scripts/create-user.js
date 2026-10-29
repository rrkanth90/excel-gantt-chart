'use strict';

// Usage: npm run create-user -- [--admin] <login-id> ["Display Name"]
// Prompts for the password so it never ends up in your shell history.
const readline = require('readline');
const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');
const { createUser } = require('../src/auth');

const args = process.argv.slice(2);
const isAdmin = args.includes('--admin');
const [username, displayName] = args.filter((a) => a !== '--admin');

if (!username) {
  console.error('Usage: npm run create-user -- [--admin] <login-id> ["Display Name"]');
  process.exit(1);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    rl.stdoutMuted = true;
    rl._writeToOutput = function (s) {
      if (rl.stdoutMuted && s !== question) rl.output.write('*');
      else rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

(async () => {
  const password = process.env.DIARY_PASSWORD || (await ask('Password (min 8 characters): '));
  if (!process.env.DIARY_PASSWORD) {
    const again = await ask('Repeat password: ');
    if (again !== password) {
      console.error('Passwords did not match.');
      process.exit(1);
    }
  }
  const db = openDatabase(loadConfig());
  try {
    createUser(db, { username, displayName, password, isAdmin });
    console.log(`Created ${isAdmin ? 'owner' : 'user'} "${username}".`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})();
