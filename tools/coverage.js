/* Map the 3S exercise library against a licensed animation catalogue and report
 * the hit rate per session pool, so we know what a purchase would actually buy
 * before spending anything.
 *
 *   node tools/coverage.js tools/catalogues/movekit.txt
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

const file = process.argv[2] || 'tools/catalogues/movekit.txt';
const cat = fs.readFileSync(path.join(root, file), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

/* Words that carry no matching signal, and equivalences between our naming and
 * catalogue naming. Without these, "Push-Up" misses "bodyweight-knee-push-ups". */
const STOP = new Set(['the', 'a', 'to', 'with', 'on', 'in', 'and', 'of', 'variation',
  'bodyweight', 'view', 'side', 'left', 'right', 'alternating', 'alternate', 'single',
  'arm', 'leg', 'normal', 'grip', 'slow', 'weighted', 'standing', 'seated', 'machine']);

const SYN = {
  pushup: 'push up', pushups: 'push up', ups: 'up', dips: 'dip',
  db: 'dumbbell', bb: 'barbell', kb: 'kettlebell',
  hams: 'hamstring', hamstrings: 'hamstring', quad: 'quadriceps',
  bridge: 'thrust', hip: 'hip', glute: 'glute',
  abs: 'abdominal', abdominals: 'abdominal', core: 'abdominal',
  rdl: 'romanian deadlift', ohp: 'overhead press',
  jacks: 'jack', kicks: 'kick', knees: 'knee', circles: 'circle',
  swings: 'swing', raises: 'raise', rolls: 'roll', twists: 'twist',
  hops: 'hop', taps: 'tap', pulses: 'pulse', lunges: 'lunge',
  squats: 'squat', crunches: 'crunch', stretches: 'stretch',
  climbers: 'climber', bends: 'bend', rocks: 'rock', bounces: 'bounce',
  fold: 'stretch', hold: 'hold', dog: 'dog',
};

function tokens(s) {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .flatMap((w) => (SYN[w] || w).split(' '))
    .filter((w) => w && w.length > 1 && !STOP.has(w));
}

const catTokens = cat.map((c) => ({ slug: c, t: new Set(tokens(c)) }));

function score(a, b) {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  /* Weighted toward covering OUR tokens: a catalogue entry with extra qualifiers
   * ("dumbbell goblet reverse lunge") still matches our "Reverse Lunges". */
  return (hit / a.size) * 0.75 + (hit / b.size) * 0.25;
}

const rows = EX.map((ex) => {
  const t = new Set(tokens(ex.name));
  let best = { slug: '—', s: 0 };
  for (const c of catTokens) {
    const s = score(t, c.t);
    if (s > best.s) best = { slug: c.slug, s };
  }
  return { id: ex.id, name: ex.name, pool: ex.pool, best: best.slug, s: best.s };
});

const STRONG = 0.62, WEAK = 0.42;
const band = (r) => (r.s >= STRONG ? 'strong' : r.s >= WEAK ? 'weak' : 'none');

console.log(`catalogue: ${file}  (${cat.length} entries)`);
console.log(`3S library: ${EX.length} exercises\n`);

for (const pool of ['stretch', 'strength', 'sweat']) {
  const set = rows.filter((r) => r.pool === pool);
  const s = set.filter((r) => band(r) === 'strong').length;
  const w = set.filter((r) => band(r) === 'weak').length;
  const n = set.filter((r) => band(r) === 'none').length;
  const pct = (x) => Math.round((x / set.length) * 100);
  console.log(`${pool.toUpperCase().padEnd(9)} ${String(set.length).padStart(3)} exercises   ` +
    `covered ${String(s).padStart(2)} (${pct(s)}%)   partial ${String(w).padStart(2)} (${pct(w)}%)   ` +
    `missing ${String(n).padStart(2)} (${pct(n)}%)`);
}

const total = rows.length;
const cov = rows.filter((r) => band(r) === 'strong').length;
const par = rows.filter((r) => band(r) === 'weak').length;
console.log(`\nOVERALL   ${total} exercises   covered ${cov} (${Math.round(cov / total * 100)}%)` +
  `   +partial ${par} (${Math.round((cov + par) / total * 100)}% if partials count)\n`);

for (const pool of ['stretch', 'strength', 'sweat']) {
  const miss = rows.filter((r) => r.pool === pool && band(r) === 'none');
  if (!miss.length) continue;
  console.log(`missing from ${pool} (${miss.length}):`);
  console.log('  ' + miss.map((r) => r.name).join(', ') + '\n');
}

/* What the catalogue has that we do not — the expansion opportunity. */
const claimed = new Set(rows.filter((r) => r.s >= WEAK).map((r) => r.best));
const spare = cat.filter((c) => !claimed.has(c));
console.log(`catalogue entries we do not currently use: ${spare.length} of ${cat.length}`);
const buckets = {};
for (const c of spare) {
  const k = /^(barbell|dumbbell|kettlebell|cable|machine|band|smith|ez-bar|landmine|plate)/.exec(c);
  const key = k ? k[1] : /stretch/.test(c) ? 'stretch' : 'bodyweight/other';
  (buckets[key] = buckets[key] || []).push(c);
}
Object.entries(buckets).sort((a, b) => b[1].length - a[1].length)
  .forEach(([k, v]) => console.log(`  ${k.padEnd(18)} ${String(v.length).padStart(3)}`));
