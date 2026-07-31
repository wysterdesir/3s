# Hosting 3S, and the path to charging for it

Two constraints drive every choice here:

1. **Licensed exercise clips must never enter this repo.** It is public, and the
   ExerciseAnimatic N-EB2BL licence forbids distributing raw files. `.gitignore`
   blocks `media/`, `*.mp4`, and `*.webm` so this can't happen by accident.
2. **Video egress is the cost that scales.** Storage is trivial; bandwidth is not.
   Cloudflare R2 charges **$0 for egress at any volume**, which is why it wins over
   S3, Vercel Blob, or Firebase Storage for a clip library.

Everything below is already prepared in the repo. The steps marked **you** need an
account or a payment method, so they aren't something the agent can do.

---

## Phase 0 — Cloudflare hosting (DONE) + R2 when clips exist

**Status: the hosting port is complete and verified.**

- Live at **https://3s.wyster-desir.workers.dev**
- Connected to `wysterdesir/3s`, deploys automatically on push to `main`
- `_headers` is honoured: JS/CSS revalidate, icons cache a week, security
  headers present
- Full harness passes against it (no console errors, no overflow, ring drains,
  all 119 exercises fit)

Note it is a **Worker with static assets**, not a classic Pages project —
Cloudflare merged the two products, so "Workers & Pages → Create" now produces a
Worker and a `*.workers.dev` URL rather than `*.pages.dev`. Functionally this is
better for us: the dashboard states that requests to a static-assets-only Worker
are *served at no charge*.

GitHub Pages remains live and untouched. Both URLs work; nothing needs retiring.

### Account facts (needed for the Worker and signed URLs later)

| | |
|---|---|
| Live app | `https://3s.wyster-desir.workers.dev` |
| Account ID | `b28865e19bb98f931b851c3f2c475d16` |
| R2 bucket | `3s-media` (Standard, Automatic location, **not** public) |
| S3 API endpoint | `https://b28865e19bb98f931b851c3f2c475d16.r2.cloudflarestorage.com` |

R2 subscription is active; billable usage $0.00 against a 10 GB free allowance.

### R2 — done, and now populated

Subscription added by the account owner (it accepts Cloudflare's terms and
attaches an auto-renewing subscription to a payment method, so it is a user step
by policy, not an agent one). Bucket `3s-media` created **non-public**, and it
stays that way.

**The bucket is never exposed directly.** `worker/index.js` sits in front of the
app and serves `/media/*` by reading the bucket; nothing else can reach it. Three
reasons this beats a public bucket or an `r2.dev` URL:

- The licence forbids distributing raw files, and a public bucket is
  distribution. Behind the Worker, the clips are only ever delivered to the app.
- Same-origin, so there is no CORS policy to get wrong.
- The Phase 1 entitlement check has exactly one place to live — every clip
  request already passes through it.

`/media/` is also where the dev server has the clips on disk, so the app uses one
path in every environment. `js/media.js` decides `enabled` from the hostname:
GitHub Pages genuinely has no media and must not request a manifest it cannot
have, while the Worker and localhost both do.

To push clips to the bucket:

```bash
wrangler login                    # once, in your own terminal
node tools/upload-media.js        # ~109 MB, resumable
```

It uses wrangler's OAuth session rather than an S3 access key, so no long-lived
secret lands on the machine. `wrangler r2 object` has no `list` subcommand, so
resumption is tracked in a local ledger at `media/.upload-state.json`; `--force`
ignores it and re-sends everything, which is also the repair path if the bucket
and the ledger disagree.

### The deploy hazard worth knowing about

`assets.directory` is the repo root, and **wrangler reads `.assetsignore`, not
`.gitignore`**. Anything sitting in the working directory at deploy time is a
candidate to be published — including files git never sees. `media/` is 109 MB of
licensed clips that exist locally on the machine that built them, so publishing
it as static assets would put the raw files on a public URL: precisely what the
licence forbids and what the private bucket exists to prevent.

`.assetsignore` therefore excludes `media`, `media-samples`, and the video
extensions outright, alongside the toolchain and docs.

Verify rather than trust it. Upload a version without promoting it, then probe
for a file that exists locally but was never sent to R2:

```bash
wrangler versions upload
curl -I <preview-url>/media/.upload-state.json    # must be 404
curl -I <preview-url>/tools/build-library.js      # must be 404
```

A 200 on either means `.assetsignore` is not doing its job and the deploy must
not be promoted.

### you: buy and upload the clips

**The product: ExerciseAnimatic "Ultimate Bundle + Lifetime License"** — the only
bundle they sell; everything else is $1 per individual clip.
`/product-page/complete-2000-exercise-videos-lifetime-unlimited-license-workout-yoga-animation-exercise-fitness-gym`

- $599 regular, **$359 sale** ("SUMMER SALES JULY"), one-time payment, tax included
- Code **`SUB10DISCOUNT`** = 10% off a first order → **~$323**
- 2,500+ clips at 4K/60fps, plus **1,200+ green-screen versions** (what we key)
- Includes **Cardio**, **Stretching**, and **Yoga** categories, and 600+ bodyweight
  home exercises — the coverage gap that disqualified MoveKit
- 4,500 start/finish illustrations and 1,500 written instructions (the latter may
  improve our coaching cues)
- All future weekly releases included free, forever

**Operational traps, in order of how much they'd cost to get wrong:**

1. **30-day download window.** Delivery is via Dropbox and their FAQ states files
   are erased after 30 days. Download everything and back it up to two places
   immediately. Do not treat their Dropbox as storage.
2. **Ask for the no-logo version.** Logo encoding takes 4 business days; without a
   logo you get express access. A burned-in logo is wrong for this app, and it can
   be added later for free if you ever want it.
3. **No refunds** on digital products — so validate the pipeline on the first batch
   of files before assuming the rest are fine.
4. Green-screen clips now live inside the bundle's Master Folder — grab those in
   preference to the white-background versions wherever both exist.

5. When buying, three things that make the pipeline work well:
   - Prefer **green-background** variants — they key cleanly onto the dark theme.
     White-background clips still work, they just sit on a light panel.
   - Take the **highest resolution offered**. `transcode.js` downscales to 480px;
     starting from 4K gives a cleaner crop and key.
   - **Keep the original filenames.** The transcoder maps filename slugs to
     exercise ids automatically, and unmatched files are reported rather than
     silently dropped. Don't pre-rename them.
   - Consider a **~10 clip test batch first** (~$10) spanning one stretch, one
     strength, one cardio move, and at least one green and one non-green
     background. That validates the whole chain end to end before committing to
     the full bundle.
6. Point the transcoder at the bundle:
   ```bash
   node tools/transcode.js "/path/to/bundle" media
   ```
   This crops to the figure, keys green backgrounds, scales to 480px, encodes VP9
   (with alpha where keyed), and writes `media/manifest.json`. The real library
   came out at **~365 KB per exercise, 109 MB for 300** — the earlier 15 MB
   estimate assumed a much smaller library and shorter clips.

   It keeps clips it has already encoded, so regenerating the library costs only
   the entries that changed, and it names orphaned clips from a previous library
   rather than letting them ride along into the upload.
7. `node tools/upload-media.js` — see the R2 section above.
8. No code change needed. `js/media.js` already points at `/media/` and enables
   itself everywhere except GitHub Pages.

### If the bundle is too big to download (it will be)

The bundle is hundreds of GB — 2,500 clips in 4K, 1080p, vertical, and green
screen, plus illustrations. Dropbox builds folder downloads as a server-side zip
with size and file-count limits, so a whole-folder download fails no matter how
good the connection. That is a Dropbox limit, not a network problem, and
retrying will not fix it.

**You do not need the bundle. You need about 119 files.** Matching only requires
filenames, not bytes, so plan the download first:

1. Install the **Dropbox desktop app** and add the shared folder as
   **online-only** (right-click → Make online-only, or leave Smart Sync default).
   Windows shows the whole tree as zero-byte placeholders — you get every
   filename without transferring content.
2. Enumerate the tree into a text file (from the folder root):
   ```bash
   find . -name "*.mp4" > listing.txt        # or:  dir /s /b *.mp4 > listing.txt
   ```
3. Work out exactly which files matter:
   ```bash
   node tools/transcode.js --list listing.txt
   ```
   This writes `tools/download-list.txt` containing only the files we use.
4. Mark **only those** as "Always keep on this device" (or download them
   individually — single-file downloads avoid the zip path that is failing).
5. Transcode as normal.

Prefer the **1080p green-screen** versions if both exist. Everything is
downscaled to 480x480 anyway, so 4K buys only a marginally cleaner crop at five
times the bytes. 119 files at 1080p is roughly 1-2 GB instead of 100+ GB.

### filenames map to exercises automatically

`transcode.js` matches a source filename to an exercise id by slug
(`bodyweight-squat.mp4` → `squat`). Anything it can't match is listed as skipped;
add those to `tools/catalogues/mapping.json` as `"source-slug": "exercise-id"`.

Exercises without a clip fall back to the drawn figure, so the library can be
filled in over time and the app is never broken mid-way.

---

## Phase 1 — the paywall

Add these only when you decide to charge. Nothing in Phase 0 needs redoing.

### Architecture

```
buyer → merchant of record (checkout) → webhook → Worker (KV: licence keys)
app → Worker /entitle?key=… → { ok, signedUrls } → R2
```

- **No accounts.** A licence key is enough: the buyer gets one by email, pastes it
  into the app once, and the app stores it locally. No passwords, no auth provider,
  no user table beyond a keys namespace. Data-minimal by design, which is also the
  easiest privacy posture.
- **Signed URLs, not public files.** The Worker validates the key and returns
  short-lived presigned R2 URLs. Non-payers can't hotlink, and payers can't
  enumerate the library. R2 presigned egress is still free.
- **Subscriptions** work the same way: the webhook marks a key active or lapsed,
  and the Worker checks status on each entitlement call.

### Code seams already in place

| Seam | File | What changes |
|---|---|---|
| Clip URL construction | `js/media.js` → `mediaUrl()` | static path → `fetch` of a signed URL |
| Entitlement | `js/media.js` → `hasAccess()` | `return true` → licence-key check |
| Persistence | `js/app.js` → `load()` / `save()` | add a server sync alongside localStorage |

Because `mediaUrl()` is the only place a URL is built and `hasAccess()` is already
called on every clip lookup, Phase 1 touches one file plus a new Worker.

### Payments: use a merchant of record

With Stripe **you** are the merchant of record and are legally responsible for
registering, collecting, filing, and remitting sales tax and VAT everywhere you
have customers. Stripe Tax calculates but does not file. Paddle and Lemon Squeezy
become the merchant of record and handle global tax compliance — roughly 5% versus
2.9% + 30¢, which is a rounding error against VAT compliance across 27 EU states
for a solo operator.

**Avoid the app stores for selling.** If 3S is ever wrapped as a native app,
Apple and Google require their in-app purchase for digital goods and take 15–30%.
Selling on the web and staying a PWA avoids that entirely.

### Licence check

The N-EB2BL licence explicitly permits *"your own website or app that allows
access to your users as a paid subscription"*, single tier, unlimited end users.
It forbids selling the clips as standalone products or selling a reseller licence.
Confirm your specific model with `contact@exerciseanimatic.shop` before charging.

### Before taking money

- Health disclaimer — not medical advice, consult a physician. Matters more when
  selling fitness instruction to strangers than when it's your own app.
- Terms of Service and Privacy Policy specific to 3S.
- For subscriptions: auto-renewal disclosure and easy cancellation (US FTC
  negative-option rules, EU consumer law). A merchant of record covers most of the
  billing mechanics but not your own disclosures.

Not legal advice — worth a short consult before the first sale.

---

## Cutover checklist (GitHub Pages → Cloudflare Pages)

Keep both live until the last step.

- [x] Cloudflare deploy succeeds and the URL loads
- [x] `node tools/shoot.js https://3s.wyster-desir.workers.dev/` — clean
- [ ] Run a full session on your phone from the new URL
- [ ] Custom domain attached (Cloudflare DNS makes this free), e.g. `3smethod.com`
- [ ] Home-screen install works from the new URL
- [ ] Only then: retire the GitHub Pages deployment

**Until the cutover, keep doing your workouts on the GitHub Pages install.** A PWA
is tied to its origin, so installing the `workers.dev` version creates a second
app with its own empty `localStorage` — your streak, level, and exercise history
would not follow. Open the new URL in a browser tab to sanity-check it, but don't
make it your daily app yet.

The cutover is worth doing once, to a custom domain, with progress carried over.
Say the word and I'll add export/import of progress first so nothing is lost.
