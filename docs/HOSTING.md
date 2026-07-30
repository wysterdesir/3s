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

## Phase 0 — Cloudflare Pages + private R2 (free, no paywall yet)

The app keeps working on GitHub Pages the whole time. Nothing is cut over until
the new host is verified on your phone.

### you: create the accounts

1. Sign up at `dash.cloudflare.com` (free plan is sufficient).
2. **Workers & Pages → Create → Pages → Connect to Git**, pick `wysterdesir/3s`.
   - Framework preset: **None**
   - Build command: *(leave empty — there is no build step)*
   - Output directory: `/`
3. Deploy. You'll get `3s-xxx.pages.dev`. `_headers` in the repo root is picked up
   automatically, so caching and security headers are already correct.
4. **R2 → Create bucket**, name it `3s-media`. Leave public access **off**.

### you: buy and upload the clips

5. Buy from ExerciseAnimatic. Prefer **green-background** variants — they key
   cleanly onto the dark theme. White-background clips still work, they just sit
   on a light panel.
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

- [ ] Cloudflare Pages build succeeds and `*.pages.dev` loads
- [ ] `node tools/shoot.js https://<pages-url>/` reports no errors and no overflow
- [ ] Run a full session on your phone from the Pages URL
- [ ] Custom domain attached (Cloudflare DNS makes this free), e.g. `3smethod.com`
- [ ] Home-screen install works from the new URL
- [ ] Only then: retire the GitHub Pages deployment

Note the installed PWA is tied to its origin, so moving domains means installing
again from the new URL and starting a fresh `localStorage` — your streak and level
won't follow automatically. If that matters, say so and I'll add an
export/import of progress before the cutover.
