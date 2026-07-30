/* 3S — turn purchased exercise clips into app-ready assets.
 *
 * For each source clip: find the figure, crop tightly to it, key out the
 * background if it is on green, scale down, and encode as VP9 WebM (with an
 * alpha channel when keyed). A 4K/60 source lands around 100-140 KB, which is
 * what makes a 100+ exercise library viable offline.
 *
 *   node tools/transcode.js <sourceDir> <outDir>
 *
 * Source filenames map to exercise ids via tools/catalogues/mapping.json when it
 * exists, otherwise by slug match against the exercise library. Writes
 * <outDir>/manifest.json for js/media.js to read.
 *
 * Green-background sources are detected automatically and keyed; anything else
 * is emitted as fit:"card" and shown on a light panel.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const SRC = process.argv[2];
const OUT = process.argv[3] || 'media';
if (!SRC) {
  console.error('usage: node tools/transcode.js <sourceDir> [outDir]');
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

const outDir = path.isAbsolute(OUT) ? OUT : path.join(root, OUT);
fs.mkdirSync(outDir, { recursive: true });

function ff(args) { return execFileSync('ffmpeg', args, { encoding: 'buffer' }); }
function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const [w, h] = out.trim().split(',').map(Number);
  return { w, h };
}

const TMP = path.join(require('os').tmpdir(), '3s-transcode');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

/* Sample frames and, in pure JS, find both the dominant background colour and the
 * union bounding box of everything that isn't it. The union across frames matters:
 * cropping to a single frame clips a limb mid-movement. */
function analyse(file) {
  const dir = path.join(TMP, 'fr');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  ff(['-v', 'error', '-y', '-i', file, '-vf', 'fps=4,scale=240:-1', '-frames:v', '20',
      path.join(dir, 'f%02d.ppm')]);

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ppm')).sort();
  let bg = null, W = 0, H = 0;
  const box = [1e9, 1e9, -1, -1];

  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f));
    /* Minimal binary PPM (P6) reader: magic, width, height, maxval, then RGB. */
    let p = 0, tok = [];
    while (tok.length < 4) {
      while (buf[p] === 32 || buf[p] === 10 || buf[p] === 13 || buf[p] === 9) p++;
      if (buf[p] === 35) { while (buf[p] !== 10) p++; continue; }
      let s = p; while (p < buf.length && buf[p] > 32) p++;
      tok.push(buf.slice(s, p).toString());
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
  return { bg, greenish, box, sampleW: W, sampleH: H };
}

function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
const bySlug = {};
EX.forEach((e) => { bySlug[slug(e.name)] = e.id; bySlug[e.id] = e.id; });

function resolveId(file) {
  const base = slug(path.basename(file).replace(/\.[^.]+$/, ''));
  if (mapping[base]) return mapping[base];
  if (bySlug[base]) return bySlug[base];
  return null;
}

const sources = fs.readdirSync(SRC).filter((f) => /\.(mp4|mov|webm|m4v)$/i.test(f));
const clips = {};
let done = 0, skipped = [];

for (const f of sources) {
  const file = path.join(SRC, f);
  const exId = resolveId(f);
  if (!exId) { skipped.push(f + ' (no exercise id — add it to tools/catalogues/mapping.json)'); continue; }

  const { w, h } = probe(file);
  const a = analyse(file);
  const sx = w / a.sampleW;
  const cx = ((a.box[0] + a.box[2]) / 2) * sx;
  const cy = ((a.box[1] + a.box[3]) / 2) * sx;
  let side = Math.max((a.box[2] - a.box[0]) * sx, (a.box[3] - a.box[1]) * sx) * 1.1;
  side = Math.min(side, w, h);
  const x = Math.max(0, Math.min(w - side, cx - side / 2));
  const y = Math.max(0, Math.min(h - side, cy - side / 2));
  const crop = `crop=${Math.round(side)}:${Math.round(side)}:${Math.round(x)}:${Math.round(y)}`;

  const name = exId + '.webm';
  const dest = path.join(outDir, name);
  const hex = '0x' + a.bg.map((v) => v.toString(16).padStart(2, '0')).join('');

  const vf = a.greenish
    ? `${crop},chromakey=${hex}:0.16:0.04,despill,scale=480:480:flags=lanczos,format=yuva420p`
    : `${crop},scale=480:480:flags=lanczos`;

  const args = ['-v', 'error', '-y', '-i', file, '-vf', vf,
    '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-auto-alt-ref', '0', '-row-mt', '1', '-an'];
  if (a.greenish) args.push('-pix_fmt', 'yuva420p');
  args.push(dest);
  ff(args);

  const kb = Math.round(fs.statSync(dest).size / 1024);
  clips[exId] = { file: name, fit: a.greenish ? 'alpha' : 'card' };
  done++;
  console.log(`${exId.padEnd(24)} ${a.greenish ? 'keyed' : 'card '}  ${String(kb).padStart(4)} KB  (bg ${hex})`);
}

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({
  _note: 'Generated by tools/transcode.js. Never commit this directory — see .gitignore.',
  clips: clips
}, null, 2));

const total = Object.values(clips).reduce((t, c) =>
  t + fs.statSync(path.join(outDir, c.file)).size, 0);
console.log(`\n${done} clips -> ${outDir}  (${(total / 1048576).toFixed(1)} MB total)`);
console.log(`covering ${done} of ${EX.length} exercises; the rest fall back to the drawn figure.`);
if (skipped.length) {
  console.log('\nskipped:');
  skipped.forEach((s) => console.log('  ' + s));
}
