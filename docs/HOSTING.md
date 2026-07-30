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

### R2 — done

R2 is only required once you own media. It is **not** blocking anything today, so
don't attach it before there's something to put in it.

Subscription added by the account owner (it accepts Cloudflare's terms and
attaches an auto-renewing subscription to a payment method, so it is a user step
by policy, not an agent one). Bucket `3s-media` created and verified empty and
non-public.

### you: buy and upload the clips

5. Buy from ExerciseAnimatic. Three things that make the pipeline work well:
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
6. Put the source files in one folder and run:
   ```bash
   node tools/transcode.js /path/to/purchased/clips media
   ```
   This crops to the figure, keys green backgrounds, scales to 480px, encodes VP9
   (with alpha where keyed), and writes `media/manifest.json`. Expect **100–140 KB
   per exercise** — roughly 15 MB for the full library.
7. Upload the contents of `media/` to the `3s-media` bucket (drag-and-drop in the
   dashboard is fine at this size).
8. In `js/media.js` set `CONFIG.enabled = true` and point `CONFIG.base` at the
   bucket's public or signed URL. Those two lines are the **only** code change
   needed — every clip URL in the app is built in that one function. `enabled`
   stays false by default so a build without clips never requests a manifest it
   knows is absent.

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
