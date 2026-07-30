/* For every 3S exercise with no automatic catalogue match, propose the closest
 * vendor names so mapping.json can be filled in by judgement rather than by
 * scrolling 2,500 rows.
 *
 *   node tools/suggest-mapping.js [namesFile]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = { window: {}, Math, JSON, console };
vm.createContext(sandbox);
for (const f of ['js/rig.js', 'js/exercises.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const EX = sandbox.window.S3.exercises.all;

const namesFile = process.argv[2] || path.join(__dirname, 'catalogues', 'exerciseanimatic-names.txt');
const names = fs.readFileSync(namesFile, 'utf8').split(/\r?\n/)
  .map((l) => l.trim().replace(/\.(mp4|mov)$/i, '')).filter(Boolean);

const mapPath = path.join(__dirname, 'catalogues', 'mapping.json');
const mapping = fs.existsSync(mapPath) ? JSON.parse(fs.readFileSync(mapPath, 'utf8')) : {};

const NOISE = /\b(4k|2k|1080p?|720p?|hd|uhd|60fps|30fps|vertical|green|screen|chroma|background|with|without|logo|male|female|slow|fast)\b/g;
function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function sing(w) {
  if (w.length <= 3) return w;
  if (/(ch|sh|ss|x|z)es$/.test(w)) return w.slice(0, -2);
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
  if (/(ss|us|is)$/.test(w)) return w;
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}
function toks(s) {
  return slug(s).replace(/-/g, ' ').replace(NOISE, ' ')
    .split(/\s+/).filter(Boolean).map(sing);
}

/* Take the matched set from transcode.js rather than reimplementing its matcher.
 * A second, simpler copy here disagreed with it — reporting 42 matches where the
 * real matcher found 68 — which meant suggesting replacements for exercises that
 * were already covered. One matcher, one verdict. */
const matchedFile = path.join(__dirname, 'matched-ids.txt');
if (!fs.existsSync(matchedFile)) {
  console.error('Run this first, so we agree on what is already matched:\n' +
    '  node tools/transcode.js --list tools/catalogues/exerciseanimatic-names.txt');
  process.exit(2);
}
const matched = new Set(fs.readFileSync(matchedFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean));

const missing = EX.filter((e) => !matched.has(e.id));
console.log(`${matched.size} of ${EX.length} matched; suggesting for the other ${missing.length}\n`);

/* Score a candidate by how much of OUR name it covers, with a bonus for sharing
 * the distinctive (longest) token — that is what separates "Cat Stretch" from
 * fifty other stretches. */
const cand = names.map((n) => ({ name: n, t: new Set(toks(n)) }));

for (const e of missing) {
  const t = toks(e.name);
  const key = t.slice().sort((a, b) => b.length - a.length)[0] || '';
  const scored = cand.map((c) => {
    let hit = 0;
    for (const w of t) if (c.t.has(w)) hit++;
    let s = hit / t.length;
    if (key && c.t.has(key)) s += 0.35;
    s -= Math.max(0, c.t.size - t.length) * 0.02;   // prefer concise names
    return { name: c.name, s: s };
  }).sort((a, b) => b.s - a.s).slice(0, 3).filter((x) => x.s > 0.25);

  console.log(`${e.pool.padEnd(8)} ${e.name}`);
  if (!scored.length) console.log('           (no plausible candidate)');
  scored.forEach((x) => console.log(`           ${x.s.toFixed(2)}  ${x.name}`));
  console.log('');
}
