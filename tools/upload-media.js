/* 3S — push the encoded clips to the R2 bucket.
 *
 *   wrangler login                     (once, in your own terminal)
 *   node tools/upload-media.js [--bucket 3s-media] [--dry-run] [--force] [--prune]
 *
 * Uses wrangler's OAuth session rather than an S3 access key, so no long-lived
 * secret is stored on this machine or passed through a shell history.
 *
 * Uploads are idempotent: the bucket is listed first and anything already there
 * with the right size is skipped, so an interrupted run resumes instead of
 * starting over. `--force` re-uploads regardless.
 *
 * manifest.json goes up LAST. It is the file the app reads to discover clips, so
 * publishing it before its clips exist would advertise media that 404s.
 */
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const MEDIA = path.join(root, 'media');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const FORCE = args.includes('--force');
const PRUNE = args.includes('--prune');   // delete bucket objects the manifest dropped
const BUCKET = (() => {
  const i = args.indexOf('--bucket');
  return i >= 0 && args[i + 1] ? args[i + 1] : '3s-media';
})();
const CONCURRENCY = 6;

/* Run wrangler's JS entry point under this same node, rather than the shim on
 * PATH. On Windows the shim is a .cmd, which execFile cannot start without
 * shell: true — and turning the shell on would mean quoting paths by hand, which
 * this repo lives under a directory with a space in it. Resolving the module
 * sidesteps both problems and behaves identically on every platform. */
const WRANGLER_JS = (() => {
  const roots = [
    path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    path.join(process.env.HOME || '', '.npm-global', 'lib', 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    '/usr/local/lib/node_modules/wrangler/bin/wrangler.js',
  ];
  for (const p of roots) if (p && fs.existsSync(p)) return p;
  return null;
})();

if (!WRANGLER_JS) {
  console.error('could not find wrangler. Install it with:  npm install -g wrangler');
  process.exit(2);
}

/* Every wrangler call goes through here so the argument list stays a real array
 * and never becomes a shell string. */
function wrangler(args, opts = {}) {
  return [process.execPath, [WRANGLER_JS, ...args], opts];
}

if (!fs.existsSync(path.join(MEDIA, 'manifest.json'))) {
  console.error('no media/manifest.json — run tools/transcode.js first');
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(path.join(MEDIA, 'manifest.json'), 'utf8'));
const clipFiles = [...new Set(Object.values(manifest.clips).map((c) => c.file))];

/* Anything in media/ that the manifest does not reference would be dead weight in
 * the bucket, served to nobody. transcode.js reports these too; refuse rather
 * than quietly uploading them. */
const onDisk = fs.readdirSync(MEDIA).filter((f) => f.endsWith('.webm'));
const orphans = onDisk.filter((f) => !clipFiles.includes(f));
if (orphans.length) {
  console.error(`${orphans.length} clip(s) in media/ are not in the manifest. Delete them first:`);
  orphans.slice(0, 10).forEach((f) => console.error('  ' + f));
  process.exit(2);
}
const missing = clipFiles.filter((f) => !fs.existsSync(path.join(MEDIA, f)));
if (missing.length) {
  console.error(`${missing.length} clip(s) in the manifest are not on disk: ` + missing.slice(0, 5).join(', '));
  process.exit(2);
}

function auth() {
  try {
    const [cmd, args] = wrangler(['whoami']);
    const out = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (/not authenticated/i.test(out)) return null;
    const m = /([\w.+-]+@[\w.-]+)/.exec(out);
    return m ? m[1] : 'authenticated';
  } catch (e) {
    return null;
  }
}

/* Which files this machine has already sent, so an interrupted run resumes.
 *
 * A bucket listing would be the authoritative answer, but `wrangler r2 object`
 * offers only get, put and delete — there is no list — and the alternative (the
 * S3 API) needs a long-lived access key, which is the thing this script exists
 * to avoid. So the ledger is local: filename plus size, written as each upload
 * succeeds. `--force` ignores it, which is also the repair path if the bucket
 * and the ledger ever disagree. */
const LEDGER = path.join(MEDIA, '.upload-state.json');

function readLedger() {
  if (FORCE || !fs.existsSync(LEDGER)) return {};
  try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch (e) { return {}; }
}

function writeLedger(state) {
  fs.writeFileSync(LEDGER, JSON.stringify({ bucket: BUCKET, sent: state }, null, 1));
}

function put(key, file) {
  return new Promise((resolve, reject) => {
    const type = key.endsWith('.json') ? 'application/json' : 'video/webm';
    /* Clips are content-addressed by name and never edited in place, so they can
     * be cached hard. The manifest changes whenever the library does, so it must
     * revalidate or the app will keep asking for clips that no longer exist. */
    const cache = key.endsWith('.json')
      ? 'no-cache'
      : 'public, max-age=31536000, immutable';
    const [cmd, args] = wrangler(['r2', 'object', 'put', `${BUCKET}/${key}`, '--file', file,
      '--content-type', type, '--cache-control', cache, '--remote']);
    execFile(cmd, args, { encoding: 'utf8', maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).trim().split('\n').slice(-3).join(' ')));
      else resolve();
    });
  });
}

/* One clip in 300 failed on the first real run — a transient error, not a bad
 * file, since the same upload succeeded immediately afterwards. At this size that
 * is a nuisance; on a larger library it would fail most runs. Retry a few times
 * with a widening gap before treating it as real. */
async function withRetry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw last;
}

async function main() {
  const who = auth();
  if (!who) {
    console.error('wrangler is not authenticated.\n');
    console.error('Run this in your own terminal, then re-run this script:\n');
    console.error('    wrangler login\n');
    console.error('It opens a browser to authorise Cloudflare. No key is stored here.');
    process.exit(3);
  }
  console.log(`authenticated as ${who}`);
  console.log(`bucket: ${BUCKET}`);

  const ledger = readLedger();
  const sent = ledger.bucket === BUCKET ? (ledger.sent || {}) : {};
  if (Object.keys(sent).length) console.log(`previously uploaded from here: ${Object.keys(sent).length}`);

  const todo = clipFiles.filter((f) => sent[f] !== fs.statSync(path.join(MEDIA, f)).size);

  const bytes = todo.reduce((t, f) => t + fs.statSync(path.join(MEDIA, f)).size, 0);
  console.log(`\n${todo.length} clip(s) to upload (${(bytes / 1e6).toFixed(1)} MB); ` +
              `${clipFiles.length - todo.length} already current\n`);
  if (DRY) { console.log('(dry run — nothing sent)'); return; }
  if (!todo.length && !FORCE) console.log('clips already current; refreshing the manifest only');

  let done = 0, failed = [];
  const queue = todo.slice();
  async function worker() {
    for (;;) {
      const f = queue.shift();
      if (!f) return;
      try {
        await withRetry(() => put(f, path.join(MEDIA, f)));
        sent[f] = fs.statSync(path.join(MEDIA, f)).size;
        done++;
        /* Persist as we go: the whole point of the ledger is surviving an
         * interruption, and one written at the end would not. */
        if (done % 10 === 0) writeLedger(sent);
        if (done % 20 === 0 || done === todo.length) console.log(`  ${done}/${todo.length}`);
      } catch (e) {
        failed.push(`${f}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, todo.length)) }, worker));
  writeLedger(sent);

  if (failed.length) {
    console.error(`\n${failed.length} upload(s) failed — manifest NOT published:`);
    failed.slice(0, 10).forEach((f) => console.error('  ' + f));
    console.error('\nFix the cause and re-run; completed uploads are skipped.');
    process.exit(1);
  }

  /* Clips the bucket still holds from an earlier library. They are unreachable —
   * the manifest is the only index — but they accumulate on every regeneration
   * and a reused name would serve stale content. wrangler cannot list a bucket,
   * so the ledger is what makes this knowable: it records everything this
   * machine ever sent, and anything in it that the manifest no longer references
   * is an orphan.
   *
   * Reported by default and deleted only with --prune, because this is the one
   * operation here that destroys something. */
  const stale = Object.keys(sent).filter((f) => !clipFiles.includes(f));
  if (stale.length) {
    console.log(`\n${stale.length} clip(s) in the bucket are no longer in the manifest:`);
    stale.slice(0, 8).forEach((f) => console.log('  ' + f));
    if (stale.length > 8) console.log(`  …and ${stale.length - 8} more`);
    if (!PRUNE) {
      console.log('  (left in place — re-run with --prune to delete them)');
    } else {
      let pruned = 0;
      for (const f of stale) {
        try {
          const [cmd, a] = wrangler(['r2', 'object', 'delete', `${BUCKET}/${f}`, '--remote']);
          execFileSync(cmd, a, { stdio: 'ignore' });
          delete sent[f];
          pruned++;
        } catch (e) { console.error(`  could not delete ${f}`); }
      }
      writeLedger(sent);
      console.log(`  deleted ${pruned}`);
    }
  }

  /* Last, and only once every clip it references is in place. */
  await put('manifest.json', path.join(MEDIA, 'manifest.json'));
  console.log(`\nuploaded ${done} clip(s) + manifest.json to ${BUCKET}`);
  console.log('next: wrangler versions upload, check the preview URL, then wrangler deploy');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
