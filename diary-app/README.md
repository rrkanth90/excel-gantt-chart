# My Diary

A private, notebook-style diary for you and the people you invite.

- **Invite-only:** no sign-up page. The owner creates a login ID and password for each person. Passwords are stored as bcrypt hashes, failed logins are rate-limited, and the owner can remove someone's access at any time.
- **One page per day:** a ruled notebook page with a red margin and handwriting. Swipe, use the ‹ › buttons or open the **Index** to move between days.
- **Autosave:** your writing is saved about a second after you stop typing. Unsaved text is also kept on the device, so a dropped connection or a closed tab loses nothing.
- **Photos:** add photos from your phone's camera or gallery, or from your computer. Large photos are shrunk before upload.
- **Voice typing:** tap 🎤 and speak. It supports English and Indian languages among others. In English you can say "new line", "full stop", "comma" or "question mark".
- **Many writers at once:** every person has their own page for each day, so writers never overwrite each other. In `shared` mode everyone also sees what the others wrote that day, and the page refreshes every 30 seconds. If you edit the same page on two devices, the diary asks which version to keep instead of losing either one.
- **Mobile friendly:** works on phones and tablets. Use "Add to Home Screen" to open it like an app.

## Run it

```bash
cd diary-app
npm install
npm run create-user -- --admin yourname "Your Name"   # asks for a password
npm start                                            # http://localhost:3000
```

Sign in, open **⋯ → Manage who can open the diary** and add the people you want to share with. Then send each of them their login ID and password privately.

Or with Docker: `docker compose up -d --build`, then
`docker compose exec diary node scripts/create-user.js --admin yourname "Your Name"`.

### Putting it online

Put the diary behind HTTPS. Voice typing only works over `https://` (or on `localhost`), and HTTPS also protects passwords in transit. Any host that runs Node 18+ or Docker **and gives you a persistent disk** will work. Examples are Render or Railway with a disk, Fly.io with a volume, a small VPS, or a home server behind Caddy or Cloudflare Tunnel. Set:

| Variable | Default | Meaning |
|---|---|---|
| `DATA_DIR` | `./data` | Where the database, photos and backups live. **Must be on persistent storage.** |
| `PORT` | `3000` | HTTP port |
| `DIARY_MODE` | `shared` | `shared`: everyone sees all writers' pages. `private`: each person sees only their own. |
| `NODE_ENV` | | Set to `production` online. This makes cookies HTTPS-only. |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy or load balancer. |
| `SESSION_DAYS` | `30` | How long people stay signed in |
| `MAX_UPLOAD_MB` | `15` | Size limit for each photo |

## Your data is safe across upgrades

Everything lives in one folder (`DATA_DIR`): `diary.db` (SQLite) holds the text, `uploads/` holds the photos and `backups/` holds the backups.

- **Upgrading never replaces that folder.** Deploy new code and restart. The same data folder is picked up.
- **Schema changes are migrations** in `src/migrations.js`. Existing migrations are never edited. New features only *append* new ones. On startup, pending migrations run inside a transaction, after an automatic `backups/pre-migration-*.db` snapshot.
- **Every saved version of every page** is kept in `entry_revisions`.
- **Daily backups:** a `backups/diary-*.db` copy is made on start and every 24 h. The last 14 are kept. Run `npm run backup` any time. For off-site safety, copy the whole data folder (database + photos) somewhere else regularly.
- **Export:** each writer can download all their entries as JSON from **⋯ → Download my entries**.

## Development

```bash
npm test     # API tests: access control, saving and conflicts, photos, private mode, migrations
```

Layout: `server.js` (entry point) · `src/` (config, database and migrations, auth, API) · `views/` (HTML pages) · `public/` (CSS, JS, icons) · `scripts/` (create-user, backup).
