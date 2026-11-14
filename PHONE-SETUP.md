# Phone fork, Phase 0 setup

Goal of Phase 0: your own copy of openDAW, hosted at your own address, opening on the phone
(no "does not run on your phone" page), installable on the Home Screen. No touch fixes yet.

## What this patch changes (small on purpose, to keep merging upstream easy)

| File | Change |
|---|---|
| `packages/app/studio/src/main.ts` | Phone gate skipped when `VITE_ALLOW_MOBILE=true`; registers the service worker |
| `packages/app/studio/vite.config.ts` | `DEPLOY_BASE` env var overrides the CI base path (the upstream CI build assumes its own server layout) |
| `packages/app/studio/index.html` | iOS Home Screen meta tags, manifest link, `viewport-fit=cover` |
| `packages/app/studio/public/_headers` | COOP/COEP headers (the app refuses to boot without them) |
| `packages/app/studio/public/manifest.webmanifest`, icons | Installable app |
| `packages/app/studio/public/sw.js` | Offline app shell (see limits below) |
| `.github/workflows/deploy-phone.yml` | Build (Rust + Node) and publish to Cloudflare Pages |

## One-time setup (about 20 minutes, needs a computer)

1. **GitHub:** fork https://github.com/andremichelle/opendaw (keep the fork public: the code is AGPL).
2. **Apply the patch** in a clone of your fork:
   `git apply --3way phase0.patch`, then commit and push to `main`.
   (No git on the computer? Open each file on github.com, edit it, and upload the new files through
   "Add file → Upload files". The patch file lists every line.)
3. **Cloudflare:** create a free account. In the dashboard:
   - copy your **Account ID** (Workers & Pages page, right column);
   - create an **API token** (My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template,
     or a custom token with *Account → Cloudflare Pages → Edit*).
4. **GitHub secrets:** in your fork, Settings → Secrets and variables → Actions →
   new repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
   Optional variable `CLOUDFLARE_PROJECT_NAME` (default `opendaw-phone`; the address becomes
   `https://<project-name>.pages.dev`).
5. **Run it:** fork → Actions → "Deploy phone fork to Cloudflare Pages" → Run workflow.
   The first build is the slow one (expect roughly 15-40 minutes, Rust compiles the engine).

## Phase 0 test (on the phone, in Safari)

Open your `https://<project-name>.pages.dev` address, then:

1. The studio opens (not the "does not run on your phone" page) and there is **no** "crossOriginIsolated" alert.
2. Open a demo project and press play. **Do you hear audio?** (Demo projects and default samples come from
   opendaw.studio servers, see "Known risk".)
3. Browse the device/sample browser: **do default samples and soundfonts load?**
4. Share → Add to Home Screen, then launch from the icon: full screen, no Safari bars?
5. Close the app, switch Wi-Fi off, relaunch: does the shell open offline?
6. Arm an audio track and record a few seconds.

Report back what works and what does not (screenshots are enough).

## Known risk: assets hosted by opendaw.studio

The studio fetches default samples, soundfonts and demo projects from `api.opendaw.studio` and
`assets.opendaw.studio`. Their server decides which websites may read them (CORS). A new
`*.pages.dev` address may be refused. If step 2 or 3 fails, the studio itself still runs, and the fix is
a small proxy or a mirror of the assets. That is a follow-up, not part of this patch.

## Limits of Phase 0

- Touch scrolling, tapping and editing are unchanged from the desktop app (that is Phase 1).
- Offline: only files you already opened once are cached; samples and soundfonts from other servers are not.
- A new version is picked up the next time you launch the app (so an open session is never broken).
- Plugin (WCLAP) pages run on the studio origin instead of a separate isolated one.
  Fine for a personal copy, do not load plugins you do not trust.
- Built output files above Cloudflare's 25 MiB limit are dropped (the log lists them). If one is the
  speech/stem-separation runtime, that single feature stops working.
- **Not built or run by me:** the build needs the Rust toolchain, which my environment cannot download.
  I checked the JavaScript syntax and the workflow file syntax only. The first workflow run is the real test.
