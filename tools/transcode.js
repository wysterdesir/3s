/* 3S — turn purchased exercise clips into app-ready assets.
 *
 *   node tools/transcode.js <sourceDir> [outDir] [--dry-run] [--female] [--limit N]
 *
 * The ExerciseAnimatic bundle arrives as a categorized Dropbox tree with several
 * variants of every exercise — 4K, 1080p, vertical 9:16, green screen, male and
 * female. So this does three things before encoding anything:
 *
 *   1. Walks the tree recursively (the files are in subfolders, not one directory).
 *   2. Groups every file that resolves to the same exercise and picks ONE best
 *      variant: green screen wins (it keys cleanly onto the dark theme), then 4K,
 *      and vertical is excluded outright because the stage is square.
 *   3. --dry-run reports the mapping in seconds without transcoding, so coverage
 *      can be checked before committing to a long encode.
 *
 * Only exercises in our library are encoded; the other ~2,400 clips in the bundle
 * are ignored. Anything unmatched is reported, never silently dropped.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));
const SRC = positional[0];
const OUT = positional[1] || 'media';
const DRY = flags.has('--dry-run');
const PREFER_FEMALE = flags.has('--female');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : Infinity;
})();

if (!SRC) {
  console.error('usage: node tools/transcode.js <sourceDir> [outDir] [--dry-run] [--female] [--limit N]');
  process.exit(2);
}

const root = path.join(__dirname, '..');
const sandbox = { window: {}, Math, JSON, console };
vm.createContext(sandbox);
for (const f of ['js/rig.js', 'js/exercises.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const EX = sandbox.window.S3.exercises.all;

const mapPath = path.join(__dirname, 'catalogues', 'mapping.json');
const mapping = fs.existsSync(mapPath) ? JSON.parse(fs.readFileSync(mapPath, 'utf8')) : {};

/* ---------- name matching ---------- */

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/* Words in their filenames that carry no identity: format markers, delivery tags,
 * and the gender suffix (handled separately as a preference, not an identity).
 * Deliberately absent: 'single', 'alternating', 'left', 'right', 'front', 'side'.
 * Those ARE identity-bearing — a Single-Leg Glute Bridge is not a Glute Bridge,
 * and a front view is a different clip from a side view. */
const NOISE = /\b(4k|2k|1080p?|720p?|hd|uhd|fhd|60fps|30fps|vertical|portrait|landscape|green|greenscreen|screen|chroma|background|with|without|logo|copy|final|slow|fast|v\d+)\b/g;

/* Their names pluralise inconsistently against ours — "Bodyweight Squats" versus
 * our "Bodyweight Squat", "Push-Ups" versus "Push-Up". Unhandled, that silently
 * loses dozens of clips, so both sides are singularised before comparison. */
function sing(w) {
  if (w.length <= 3) return w;
  if (/(ch|sh|ss|x|z)es$/.test(w)) return w.slice(0, -2);
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
  if (/(ss|us|is)$/.test(w)) return w;
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}

function core(s) {
  return slug(s).replace(/-/g, ' ').replace(NOISE, ' ')
    .split(/\s+/).filter(Boolean).map(sing).join('-');
}

/* Build lookup tables from our library: exact ids, exact name slugs, and
 * noise-stripped cores. Longest-first so 'diamond push up' beats 'push up'. */
const byExact = {}, byCore = {};
for (const e of EX) {
  byExact[e.id] = e.id;
  byExact[slug(e.name)] = e.id;
  const c = core(e.name);
  if (c && !byCore[c]) byCore[c] = e.id;
  byCore[core(e.id)] = e.id;
}
const coreKeys = Object.keys(byCore).sort((a, b) => b.length - a.length);

function resolveId(file, relDir) {
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  const s = slug(base);
  if (mapping[s]) return mapping[s];
  if (byExact[s]) return byExact[s];

  const c = core(base);
  if (mapping[c]) return mapping[c];
  if (byCore[c]) return byCore[c];

  /* Substring fallback, longest core first, so 'Barbell Bench Press 4K Male'
   * still lands on a shorter library name it contains. */
  for (const k of coreKeys) {
    if (k.length >= 6 && (c === k || c.includes('-' + k) || c.includes(k + '-') || c === k)) return byCore[k];
  }
  return null;
}

/* ---------- variant preference ---------- */

function classify(full, relPath) {
  const hay = (relPath + ' ' + path.basename(full)).toLowerCase();
  return {
    green: /green|chroma/.test(hay),
    fourK: /4k|uhd|3840|2160/.test(hay),
    vertical: /vertical|9.16|portrait|1080x1920/.test(hay),
    female: /female/.test(hay),
    logo: /with.?logo/.test(hay) && !/without.?logo/.test(hay)
  };
}

function score(v) {
  let s = 0;
  if (v.vertical) return -1000;                 // stage is square; never use 9:16
  if (v.logo) s -= 50;                          // prefer the clean, unbranded copy
  if (v.green) s += 100;                        // keys onto the dark theme
  if (v.fourK) s += 10;                         // more pixels to crop into
  if (v.female === PREFER_FEMALE) s += 1;       // consistent model across the app
  return s;
}

/* ---------- discovery ---------- */

const VIDEO = /\.(mp4|mov|webm|m4v)$/i;
const SKIP_DIR = /^(__macosx|\.git|thumbs?|illustrations?|images?|instructions?|pdf|docs?)$/i;

function walk(dir, rel, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIR.test(e.name)) walk(full, r, out);
    } else if (VIDEO.test(e.name)) {
      out.push({ full: full, rel: r });
    }
  }
  return out;
}

/* --list takes a plain text file of paths (one per line) instead of a directory.
 * This is how we plan a download: the bundle is hundreds of GB, but matching only
 * needs FILENAMES, not bytes. Enumerate the names, work out the ~119 files we
 * actually use, and fetch only those. */
const LIST = (() => {
  const i = args.indexOf('--list');
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();

let files;
if (LIST) {
  const lines = fs.readFileSync(LIST, 'utf8').split(/\r?\n/)
    .map((l) => l.trim()).filter((l) => l && VIDEO.test(l));
  files = lines.map((l) => ({ full: l, rel: l.replace(/^.*?[\\/](?=[^\\/]*[\\/])/, '') }));
  console.log(`read ${files.length} video paths from ${LIST}\n`);
} else {
  console.log('scanning ' + SRC + ' ...');
  files = walk(SRC, '', []);
  console.log(`found ${files.length} video files\n`);
}

if (!files.length) {
  console.error('No video files found. Check the path; nested folders are walked automatically.');
  process.exit(1);
}

/* group by exercise, keeping the best variant */
const best = {};
const unmatched = [];
for (const f of files) {
  const id = resolveId(f.full, f.rel);
  if (!id) { unmatched.push(f.rel); continue; }
  const v = classify(f.full, f.rel);
  const s = score(v);
  if (s <= -1000) continue;
  if (!best[id] || s > best[id].score) best[id] = { file: f, variant: v, score: s };
}

const matchedIds = Object.keys(best);
const missing = EX.filter((e) => !best[e.id]);

console.log(`mapped ${matchedIds.length} of ${EX.length} exercises`);
console.log(`  with green screen : ${matchedIds.filter((i) => best[i].variant.green).length}`);
console.log(`  4K source         : ${matchedIds.filter((i) => best[i].variant.fourK).length}`);
console.log(`unmatched source files: ${unmatched.length} (bundle has thousands we don't use)\n`);

for (const pool of ['stretch', 'strength', 'sweat']) {
  const set = EX.filter((e) => e.pool === pool);
  const hit = set.filter((e) => best[e.id]).length;
  console.log(`  ${pool.padEnd(9)} ${String(hit).padStart(3)} / ${set.length}  (${Math.round(hit / set.length * 100)}%)`);
}

if (missing.length) {
  console.log(`\nno clip found for ${missing.length} exercises (these keep the drawn figure):`);
  console.log('  ' + missing.map((e) => e.name).join(', '));
  console.log('\nTo map one by hand, add to tools/catalogues/mapping.json:');
  console.log('  { "their-file-slug": "our-exercise-id" }');
}

if (DRY || LIST) {
  console.log('\n--- nothing encoded ---');
  console.log('chosen sources:');
  const show = DRY && !LIST ? 40 : matchedIds.length;
  matchedIds.sort().slice(0, show).forEach((id) => {
    const b = best[id];
    const tags = [b.variant.green ? 'green' : '', b.variant.fourK ? '4K' : ''].filter(Boolean).join('+');
    console.log(`  ${id.padEnd(24)} ${tags.padEnd(9)} ${b.file.rel}`);
  });
  if (matchedIds.length > show) console.log(`  ... and ${matchedIds.length - show} more`);

  /* The whole point of --list: emit exactly the files worth downloading, so a
   * 100+ GB bundle becomes a ~1-2 GB fetch. */
  if (LIST) {
    const outFile = path.join(__dirname, 'download-list.txt');
    fs.writeFileSync(outFile, matchedIds.sort().map((id) => best[id].file.full).join('\n') + '\n');
    console.log(`\nwrote ${matchedIds.length} paths to ${outFile}`);
    console.log('Download ONLY these. Everything else in the bundle is unused.');
  }
  process.exit(0);
}

/* ---------- encode ---------- */

const outDir = path.isAbsolute(OUT) ? OUT : path.join(root, OUT);
fs.mkdirSync(outDir, { recursive: true });
const TMP = path.join(os.tmpdir(), '3s-transcode');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

function ff(a) { return execFileSync('ffmpeg', a, { encoding: 'buffer' }); }
function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const [w, h] = out.trim().split(',').map(Number);
  return { w: w, h: h };
}

/* Sample frames, find the dominant background colour, and take the union bounding
 * box of everything that isn't it. Union across frames matters: cropping to one
 * frame clips a limb mid-movement. */
function analyse(file) {
  const dir = path.join(TMP, 'fr');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  ff(['-v', 'error', '-y', '-i', file, '-vf', 'fps=4,scale=240:-1', '-frames:v', '20',
      path.join(dir, 'f%02d.ppm')]);
  const frames = fs.readdirSync(dir).filter((f) => f.endsWith('.ppm')).sort();
  let bg = null, W = 0, H = 0;
  const box = [1e9, 1e9, -1, -1];

  for (const f of frames) {
    const buf = fs.readFileSync(path.join(dir, f));
    let p = 0; const tok = [];
    while (tok.length < 4) {
      while (buf[p] === 32 || buf[p] === 10 || buf[p] === 13 || buf[p] === 9) p++;
      if (buf[p] === 35) { while (buf[p] !== 10) p++; continue; }
      const s0 = p; while (p < buf.length && buf[p] > 32) p++;
      tok.push(buf.slice(s0, p).toString());
    }
    p++;
    W = +tok[1]; H = +tok[2];
    const px = (x, y) => { const o = p + (y * W + x) * 3; return [buf[o], buf[o + 1], buf[o + 2]]; };
    if (!bg) {
      const tally = new Map();
      for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
        const k = px(x, y).join(',');
        tally.set(k, (tally.get(k) || 0) + 1);
      }
      bg = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
    }
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
      const c = px(x, y);
      if (Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) > 70) {
        if (x < box[0]) box[0] = x;
        if (y < box[1]) box[1] = y;
        if (x > box[2]) box[2] = x;
        if (y > box[3]) box[3] = y;
      }
    }
  }
  const greenish = bg[1] > 120 && bg[1] > bg[0] * 2 && bg[1] > bg[2] * 2;
  return { bg: bg, greenish: greenish, box: box, sampleW: W, sampleH: H };
}

const clips = {};
let n = 0;
const todo = matchedIds.sort().slice(0, LIMIT);
console.log(`\nencoding ${todo.length} clips -> ${outDir}\n`);

for (const id of todo) {
  const src = best[id].file.full;
  let a, dim;
  try { dim = probe(src); a = analyse(src); }
  catch (e) { console.log(`${id.padEnd(24)} SKIP (unreadable: ${e.message.split('\n')[0]})`); continue; }

  const sx = dim.w / a.sampleW;
  const cx = ((a.box[0] + a.box[2]) / 2) * sx;
  const cy = ((a.box[1] + a.box[3]) / 2) * sx;
  let side = Math.max((a.box[2] - a.box[0]) * sx, (a.box[3] - a.box[1]) * sx) * 1.1;
  side = Math.min(side, dim.w, dim.h);
  const x = Math.max(0, Math.min(dim.w - side, cx - side / 2));
  const y = Math.max(0, Math.min(dim.h - side, cy - side / 2));
  const crop = `crop=${Math.round(side)}:${Math.round(side)}:${Math.round(x)}:${Math.round(y)}`;
  const hex = '0x' + a.bg.map((v) => v.toString(16).padStart(2, '0')).join('');

  const vf = a.greenish
    ? `${crop},chromakey=${hex}:0.16:0.04,despill,scale=480:480:flags=lanczos,format=yuva420p`
    : `${crop},scale=480:480:flags=lanczos`;
  const enc = ['-v', 'error', '-y', '-i', src, '-vf', vf,
    '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-auto-alt-ref', '0', '-row-mt', '1', '-an'];
  if (a.greenish) enc.push('-pix_fmt', 'yuva420p');
  const dest = path.join(outDir, id + '.webm');
  enc.push(dest);
  ff(enc);

  const kb = Math.round(fs.statSync(dest).size / 1024);
  clips[id] = { file: id + '.webm', fit: a.greenish ? 'alpha' : 'card' };
  n++;
  console.log(`${String(n).padStart(3)}/${todo.length}  ${id.padEnd(24)} ${a.greenish ? 'keyed' : 'card '} ${String(kb).padStart(4)} KB`);
}

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({
  _note: 'Generated by tools/transcode.js. Never commit this directory — see .gitignore.',
  clips: clips
}, null, 2));

const total = Object.values(clips).reduce((t, c) => t + fs.statSync(path.join(outDir, c.file)).size, 0);
console.log(`\n${n} clips, ${(total / 1048576).toFixed(1)} MB total -> ${outDir}`);
console.log(`${EX.length - n} exercises keep the drawn figure.`);
