/* 3S — push the encoded clips to the R2 bucket.
 *
 *   wrangler login                     (once, in your own terminal)
 *   node tools/upload-media.js [--bucket 3s-media] [--dry-run] [--force]
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
const BUCKET = (() => {
  const i = args.indexOf('--bucket');
  return i >= 0 && args[i + 1] ? args[i + 1] : '3s-media';
})();
const CONCURRENCY = 6;

const WRANGLER = process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler';

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
    const out = execFileSync(WRANGLER, ['whoami'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (/not authenticated/i.test(out)) return null;
    const m = /([\w.+-]+@[\w.-]+)/.exec(out);
    return m ? m[1] : 'authenticated';
  } catch (e) {
    return null;
  }
}

/* What is already in the bucket, so a resumed run does not re-send it. */
function remoteIndex() {
  const index = new Map();
  let cursor = null;
  for (;;) {
    const a = ['r2', 'object', 'list', BUCKET, '--remote'];
    if (cursor) a.push('--cursor', cursor);
    let out;
    try {
      out = execFileSync(WRANGLER, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 << 20 });
    } catch (e) {
      return null;                       // older wrangler, or no list permission
    }
    const json = out.slice(out.indexOf('{'));
    let parsed;
    try { parsed = JSON.parse(json); } catch (e) { return null; }
    for (const o of parsed.objects || []) index.set(o.key, o.size);
    if (!parsed.truncated || !parsed.cursor) break;
    cursor = parsed.cursor;
  }
  return index;
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
    execFile(WRANGLER, ['r2', 'object', 'put', `${BUCKET}/${key}`, '--file', file,
      '--content-type', type, '--cache-control', cache, '--remote'],
    { encoding: 'utf8', maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).trim().split('\n').slice(-3).join(' ')));
      else resolve();
    });
  });
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

  const remote = FORCE ? new Map() : remoteIndex();
  if (remote === null) console.log('could not list the bucket — uploading everything');
  else console.log(`already in the bucket: ${remote.size} object(s)`);

  const todo = clipFiles.filter((f) => {
    if (FORCE || !remote) return true;
    const size = remote.get(f);
    return size === undefined || size !== fs.statSync(path.join(MEDIA, f)).size;
  });

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
        await put(f, path.join(MEDIA, f));
        done++;
        if (done % 20 === 0 || done === todo.length) console.log(`  ${done}/${todo.length}`);
      } catch (e) {
        failed.push(`${f}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, todo.length)) }, worker));

  if (failed.length) {
    console.error(`\n${failed.length} upload(s) failed — manifest NOT published:`);
    failed.slice(0, 10).forEach((f) => console.error('  ' + f));
    console.error('\nFix the cause and re-run; completed uploads are skipped.');
    process.exit(1);
  }

  /* Last, and only once every clip it references is in place. */
  await put('manifest.json', path.join(MEDIA, 'manifest.json'));
  console.log(`\nuploaded ${done} clip(s) + manifest.json to ${BUCKET}`);
  console.log('next: point CONFIG.base in js/media.js at the bucket origin and set enabled: true');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
