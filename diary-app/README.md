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

### Deploy on Fly.io (cheapest)

`fly.toml` runs the diary on the smallest Fly.io server (256 MB) with a 1 GB volume for your data. The server sleeps when nobody is using the diary and wakes in a couple of seconds on the next visit, so you mostly pay for storage.

1. Install `flyctl` ([instructions](https://fly.io/docs/flyctl/install/)) and sign up or sign in: `fly auth signup` or `fly auth login`. Fly.io asks for a card.
2. Get the code and go to the app folder:
   ```bash
   git clone https://github.com/rrkanth90/excel-gantt-chart.git
   cd excel-gantt-chart/diary-app
   ```
3. Create the app from the included config, without deploying yet:
   ```bash
   fly launch --copy-config --no-deploy
   ```
   Pick a unique app name when asked, and say no to adding databases or Redis. If you want a different region from `bom` (Mumbai), set it in `fly.toml` first; `fly platform regions` lists them.
4. Create the storage volume in the same region:
   ```bash
   fly volumes create diary_data --size 1 --region bom
   ```
5. Set your first login (only used while the diary has no users):
   ```bash
   fly secrets set OWNER_USERNAME=yourname OWNER_PASSWORD='a-strong-password' OWNER_DISPLAY_NAME='Your Name'
   ```
6. Deploy. Keep it to **one** server, because the data lives on one volume:
   ```bash
   fly deploy --ha=false
   ```
7. Open `https://<your-app-name>.fly.dev`, sign in, and add your family from **⋯ → Manage who can open the diary**.

Later updates: pull the new code and run `fly deploy` again. Your data stays on the volume. For an extra copy, run `fly ssh console -C "node scripts/backup.js"`, and take a volume snapshot with `fly volumes snapshots create <volume-id>` (`fly volumes list` shows the id).

### Deploy on Render

The repository has a `render.yaml` Blueprint at its root. It sets up the app with HTTPS, a persistent 1 GB disk at `/var/data` and the right settings.

1. Sign in at [render.com](https://render.com) with GitHub and allow Render to see this repository.
2. Click **New → Blueprint**, pick this repository and branch `master`.
3. Render asks for three values. These become your first login:
   - `OWNER_USERNAME`: your login ID (letters, numbers, `.`, `-`, `_`)
   - `OWNER_PASSWORD`: at least 8 characters
   - `OWNER_DISPLAY_NAME`: the name shown on your pages
4. Click **Apply**. The first build takes a few minutes. Your diary is then at `https://my-diary-xxxx.onrender.com`, the address shown on the service page.
5. Sign in, open **⋯ → Manage who can open the diary** and add the people you want to share with.

Notes:
- The Blueprint uses the paid **Starter** instance because free instances can't have a disk. Without a disk, every entry and photo would be wiped on each restart or deploy.
- The owner settings are only used while the diary has no users. After you have signed in you can delete them in **Environment**, and change your password from the app's menu.
- Every push to `master` redeploys automatically. Your data stays on the disk.
- For an extra copy of your data, open the service's **Shell** tab and run `npm run backup`, or download your entries from the app's menu.

### Putting it online elsewhere

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
| `OWNER_USERNAME`, `OWNER_PASSWORD`, `OWNER_DISPLAY_NAME` | | Creates the first owner login at startup, only when the diary has no users yet |

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
