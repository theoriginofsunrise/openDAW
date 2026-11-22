# EchoStudio server

A small server on Cloudflare Workers that keeps the projects and audio of the app in an R2 bucket, and hosts the live rooms. The app signs in
with Google, and only the emails on the allow list get in. Everybody has a private folder; nobody sees another folder.

## What it does

| Route | What |
|---|---|
| `POST /auth/google` | trades a Google ID token for a session (30 days). Only allowed emails. |
| `GET /auth/me` | who is signed in |
| `GET/PUT/HEAD/DELETE /files/<path>` | a file (a folder for `HEAD` and `DELETE`: everything below it) |
| `GET /list?path=<folder>` | names inside a folder |
| `POST /mpu/create`, `PUT /mpu/part`, `POST /mpu/complete`, `POST /mpu/abort` | files above 95 MB go up in parts |
| WebSocket `/<room>?token=...` | a live room: one Durable Object per room keeps the shared project while people are in it |
| WebSocket `/signaling?token=...` | the go-between of the peer-to-peer connections (follow, calls, audio transfer) |

Rooms need the same Google sign-in as the files, and the website's address must be in `ALLOWED_ORIGINS`. They are not stored:
when everybody has left, the room is gone, and everybody keeps their own copy of the project.

The shared catalog files (`index.json`, `tombstones.json`, `structure.json`) are only overwritten by a device that
has read their latest version (`X-Echo-If-Match`), so two devices cannot wipe each other's changes.

## One-time setup

1. **Cloudflare**: an R2 bucket named `echostudio-audio` (R2 object storage, Create bucket), and a workers.dev name for
   the account (Workers & Pages).
2. **API token** (My Profile, API Tokens): the token the app deploy uses also needs the rights
   *Workers Scripts: Edit* and *Workers R2 Storage: Edit* (keep *Cloudflare Pages: Edit*).
3. **GitHub** (the repository, Settings, Secrets and variables, Actions, Variables):
   - `ALLOWED_EMAILS`: your Google email(s), separated by commas
   - `ECHO_SERVER_URL`: `https://echostudio-server.<your workers.dev name>.workers.dev`
   - `GOOGLE_DRIVE_CLIENT_ID` is already there.
4. Run **Deploy EchoStudio server to Cloudflare** (Actions), then deploy the app again.
5. In the app, tap **Sync**, sign in with Google. From then on projects sync by themselves.

The Google project must list your email as a test user (OAuth consent screen, Test users) while it is in testing mode.
Nothing but the email is read from the Google account.

## Checks

```
npx vitest run                      # server logic with a fake bucket, and the app's handler against the real server code
ECHO_INTEGRATION=1 WRANGLER_BIN=$(which wrangler) npx vitest run integration   # on Cloudflare's local runtime
```
