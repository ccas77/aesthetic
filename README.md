# aesthetic

A server-side content factory for short, sepia-graded, beat-synced quote videos. Per book: quotes pool, songs pool, image bank, shared atmospheric pool. Cron renders pairs round-robin and (optionally) publishes via PostBridge.

## How it works

- **Server-side rendering** via `ffmpeg-static` on a Node serverless function. The browser never sees FFmpeg.
- **Image generation** calls Higgsfield directly at `fnf.higgsfield.ai/jobs/{model}` in **unlimited mode** so generations don't draw from your monthly credit pool.
- **Beat-aligned cuts** sync each still to the song's BPM (defaults to 80 when unspecified).
- **Round-robin dedup** picks the next `(quote, song)` pair the book hasn't rendered yet, then loops once all pairs are exhausted.
- **Fresh-first-two-stills** pins two never-before-used stills to the first two slots of every render.

## Architecture

```
app/page.tsx                        - homepage: queue control panel + recent renders
app/books/                          - book + categories + quotes + songs + publishing management
app/api/admin/generate-still        - generate one category still (Higgsfield direct)
app/api/admin/generate-filler       - generate one atmospheric still
app/api/admin/upload-still          - direct upload of a category still
app/api/admin/queue-renders         - enqueue N renders for a book
app/api/admin/higgsfield-probe      - smoke-test the Higgsfield auth pipeline
app/api/cron/render                 - drain one queued render per tick
app/api/cron/post                   - drain one un-posted render per tick (autopost-gated)
lib/render-server.ts                - server FFmpeg pipeline
lib/higgsfield-clerk.ts             - Clerk JWT manager (4-min cache)
lib/higgsfield-jobs.ts              - direct API client (submit + poll)
lib/higgsfield.ts                   - generateStillViaHiggsfield entry
lib/render-planner.ts               - round-robin + fresh-first-two
lib/queue.ts                        - Blob-backed queue
lib/renders-manifest.ts             - per-book books/{id}/renders.json
lib/post-bridge.ts                  - PostBridge client (TikTok / IG / FB)
```

## Environment variables

| Name | Where set | Purpose |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | Vercel (auto from `vercel blob create-store`) | Read/write all app state |
| `HIGGSFIELD_CLERK_COOKIE` | Vercel env | `__client` cookie from a logged-in higgsfield.ai browser session |
| `HIGGSFIELD_SESSION_ID` | Vercel env | Clerk session id, format `sess_xxxxxxx` |
| `HIGGSFIELD_DEFAULT_MODEL` | Vercel env (optional) | Defaults to `nano-banana-2` |
| `POSTBRIDGE_API_KEY` | Vercel env | PostBridge bearer token |
| `POSTBRIDGE_AUTOPOST_ENABLED` | Vercel env | Must equal `"true"` for `/api/cron/post` to actually publish; otherwise it dry-runs |
| `CRON_SECRET` | Vercel env | Bearer secret Vercel cron auth |

## Rotating the Higgsfield Clerk credentials

The `__client` cookie and session ID are tied to a logged-in browser session at higgsfield.ai. They eventually expire (cookie rotation, logout, etc.). When that happens, `/api/admin/higgsfield-probe` starts returning `ok: false` and every generation fails with a 401 from Clerk.

To rotate:

1. Open https://higgsfield.ai in Chrome and sign in.
2. **Cookie**: open DevTools → Application → Cookies → `https://higgsfield.ai`. Find the row with name `__client`. Copy the value (long base64-ish string starting with something like `eyJ...`). This is `HIGGSFIELD_CLERK_COOKIE`.
3. **Session ID**: in the same tab, open DevTools console and run:
   ```js
   window.Clerk.session.id
   ```
   Copy the returned string (`sess_xxxxxxx`). This is `HIGGSFIELD_SESSION_ID`.
4. Update both env vars in the Vercel dashboard (Project Settings → Environment Variables → Production). The encrypted-at-rest storage Vercel provides is sufficient; the app does not double-encrypt these.
5. Trigger a redeploy or wait for the next deploy. The next invocation will mint a fresh Clerk JWT.
6. Verify: `curl https://aesthetic-pearl.vercel.app/api/admin/higgsfield-probe` should return `{ ok: true, user: {...} }` with a `has_unlim` flag set.

**Security caveats:**
- Treat `__client` as a password. Anyone with it can act as you on higgsfield.ai. Never commit it. Never paste it into chat unless you trust the channel end-to-end.
- The app strips both values from error messages and stack traces, but if you patch error handling, audit any new log statements for cookie/session leaks.
- Unlimited Nano Banana is locked to your Plus/Ultra plan + the unlimited model selection you made on activation. If the plan downgrades, generations will start failing with Higgsfield's own error message; the app surfaces it intact.

## Cron

`vercel.json` registers two cron jobs:

- `/api/cron/render` at `*/30 * * * *` (every 30 minutes) - drains one queued render
- `/api/cron/post` at `15,45 * * * *` (every 30 min, offset 15) - drains one un-posted render, hard-gated by `POSTBRIDGE_AUTOPOST_ENABLED=true`

## Development

```bash
npm install
npm run build
```

There is no `npm run dev` workflow; the app is exercised on the deployed Vercel preview/production URL.

## License

MIT.
