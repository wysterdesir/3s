/* Two checks that don't need a browser:
 *   1. Every element id app.js reaches for actually exists in index.html.
 *   2. A full 20-minute session driven through the real Player advances through
 *      every item, fires the audio cues, and lands exactly on zero.
 *
 *   node tools/test-wiring.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');

let fails = 0;
const note = (m) => { console.log('  FAIL ' + m); fails++; };

/* ---- 1. id wiring ---- */

const ids = new Set();
for (const m of html.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);

const wanted = new Set();
for (const m of appSrc.matchAll(/\$\('([^']+)'\)/g)) wanted.add(m[1]);
for (const id of wanted) if (!ids.has(id)) note(`app.js reads #${id}, absent from index.html`);
console.log(`checked ${wanted.size} element references against ${ids.size} ids`);

/* screens app.js registers must all exist */
for (const id of ['home', 'pick', 'where', 'play', 'bridge', 'done', 'settings', 'browse']) {
  if (!ids.has(id)) note(`screen #${id} missing`);
}

/* every script index.html loads must exist on disk */
for (const m of html.matchAll(/<script src="([^"]+)"/g)) {
  if (!fs.existsSync(path.join(root, m[1]))) note(`missing script ${m[1]}`);
}
for (const m of html.matchAll(/<link[^>]+href="([^"]+)"/g)) {
  const href = m[1];
  if (href.startsWith('http')) continue;
  if (!fs.existsSync(path.join(root, href))) note(`missing asset ${href}`);
}

/* CSS custom properties referenced by session theming must be defined */
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
for (const v of ['--stretch', '--strength', '--sweat', '--accent', '--ink', '--muted']) {
  if (!css.includes(v + ':')) note(`css var ${v} never defined`);
}

/* ---- 2. simulated session ---- */

const sandbox = {
  window: {}, Math, JSON, console,
  requestAnimationFrame: null, cancelAnimationFrame: () => {},
  performance: { now: () => clock },
  navigator: {},
  document: { addEventListener: () => {} },
  setTimeout: () => {}
};
sandbox.AudioContext = undefined;
vm.createContext(sandbox);
for (const f of ['js/rig.js', 'js/exercises.js', 'js/media.js', 'js/workouts.js', 'js/player.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}

const S3 = sandbox.window.S3;
let clock = 0;

/* A stage stub standing in for the video-or-figure stage. It records what it was
 * asked to show so we can assert the player drives it once per interval. */
const drawn = [];
const shown = [];
const stage = {
  props: [],
  unlock() {},
  setExercise(ex, props) { shown.push(ex ? ex.id : null); this.props = props || []; this.ex = ex; },
  frame(into, speed) {
    if (!this.ex) return;
    const phase = (into * (speed || 1)) / (this.ex.cycle || 3);
    drawn.push(S3.rig.sampleLoop(this.ex.frames, phase));
  }
};

/* an audio stub that counts cues */
const cues = { go: 0, rest: 0, tick: 0, said: [], switchSide: 0, fanfare: 0 };
const audio = {
  on: true, voice: true, unlock() {},
  go() { cues.go++; }, rest() { cues.rest++; }, tick() { cues.tick++; },
  switchSide() { cues.switchSide++; }, fanfare() { cues.fanfare++; },
  say(t) { cues.said.push(t); }
};

const plan = S3.workouts.buildSession('strength', {
  equip: S3.workouts.LOCATIONS.gym.equip, level: 2, count: 0, usage: {}
});

let done = false;
const seenItems = new Set();
let lastRemaining = Infinity;

const player = new S3.player.Player({
  stage, audio,
  onItem: (item, i) => seenItems.add(i),
  onTick: (t) => {
    if (t.remaining > lastRemaining + 0.001) note(`clock went backwards: ${lastRemaining} -> ${t.remaining}`);
    lastRemaining = t.remaining;
    if (t.itemFrac < 0 || t.itemFrac > 1) note(`itemFrac out of range: ${t.itemFrac}`);
    if (t.sessionFrac < 0 || t.sessionFrac > 1) note(`sessionFrac out of range: ${t.sessionFrac}`);
  },
  onDone: () => { done = true; }
});

/* drive the loop by hand: rAF becomes a no-op and we step the clock ourselves */
sandbox.requestAnimationFrame = () => 1;
player.load(plan);
player.start();

const STEP = 250;   // ms per simulated frame
for (let t = 0; t <= (S3.workouts.SESSION_LEN + 1) * 1000 && !done; t += STEP) {
  clock = t;
  player._frame();
}

if (!done) note('session never completed');
if (seenItems.size !== plan.items.length) {
  note(`visited ${seenItems.size} of ${plan.items.length} items`);
}
if (!drawn.length) note('stage was never asked to render');
if (shown.length !== plan.items.length) {
  note(`stage.setExercise called ${shown.length}x for ${plan.items.length} items`);
}
/* Rest and transition items must preview the UPCOMING move, not nothing. */
plan.items.forEach((it, n) => {
  if (it.kind === 'work' && shown[n] !== it.exId) {
    note(`item ${n} is work ${it.exId} but stage was shown ${shown[n]}`);
  }
});
if (cues.fanfare !== 1) note(`expected 1 finish fanfare, got ${cues.fanfare}`);

const works = plan.items.filter((i) => i.kind === 'work').length;
const rests = plan.items.filter((i) => i.kind === 'rest').length;
if (cues.go !== works) note(`expected ${works} go cues, got ${cues.go}`);
if (cues.rest !== rests) note(`expected ${rests} rest cues, got ${cues.rest}`);
if (cues.tick !== plan.items.length * 3) note(`expected ${plan.items.length * 3} countdown ticks, got ${cues.tick}`);

const alts = plan.items.filter((i) => i.alt).length;
if (cues.switchSide !== alts) note(`expected ${alts} side-switch cues, got ${cues.switchSide}`);

console.log(`ran a full ${plan.template} session: ${plan.items.length} items, ${works} work / ${rests} rest`);
console.log(`cues — ${cues.go} go, ${cues.rest} rest, ${cues.tick} ticks, ${cues.switchSide} switches, ${cues.said.length} spoken`);

/* pause must freeze the clock */
const p2 = new S3.player.Player({ stage, audio, onDone: () => {} });
p2.load(plan);
clock = 0; p2.start();
clock = 5000; p2._frame();
const atPause = p2.elapsed();
p2.pause();
clock = 60000;
if (Math.abs(p2.elapsed() - atPause) > 0.01) {
  note(`pause leaked time: ${atPause} -> ${p2.elapsed()}`);
}
p2.resume();
clock = 61000;
if (Math.abs(p2.elapsed() - (atPause + 1)) > 0.02) {
  note(`resume mis-tracked: expected ${atPause + 1}, got ${p2.elapsed()}`);
}
console.log(`pause held at ${atPause.toFixed(2)}s across 55s of wall clock, resumed cleanly`);

/* skip must jump to the next work item, not grant free time */
const p3 = new S3.player.Player({ stage, audio, onDone: () => {} });
p3.load(plan);
clock = 0; p3.start(); p3._frame();
const before = p3.itemAt(p3.elapsed());
const expected = plan.items.findIndex((it, n) => n > before && it.kind === 'work');
p3.skip();
const after = p3.itemAt(p3.elapsed());
if (after !== expected) note(`skip landed on item ${after}, expected ${expected}`);
if (plan.items[after].kind !== 'work') note('skip did not land on a work item');
if (p3.elapsed() >= p3.total) note('skip ran past the end of the session');
console.log(`skip moved from item ${before} (${plan.items[before].name}) to ${after} (${plan.items[after].name})`);

/* skipping from the last work item must clamp to the end, not overshoot */
const lastWork = plan.items.reduce((acc, it, n) => (it.kind === 'work' ? n : acc), 0);
p3.acc = plan.items[lastWork].start; p3.t0 = clock;
p3.skip();
if (p3.elapsed() > p3.total) note(`skip past the last move overshot: ${p3.elapsed()} > ${p3.total}`);
console.log(`skip from the final move clamped to ${p3.elapsed().toFixed(0)}s of ${p3.total}s`);

/* ---- 3. the interval meter must not read the same in work and rest ---- */

/* Work drains, everything else fills. Drawn identically, a change-position gap —
 * which previews the next exercise behind it — reads as the exercise already
 * running, and you start the move early. */
const ms = S3.player.meterScale;
if (ms('work', 0) !== 1 || ms('work', 1) !== 0) note('work interval should drain from full to empty');
for (const kind of ['rest', 'transition', 'ready']) {
  if (ms(kind, 0) !== 0 || ms(kind, 1) !== 1) note(`${kind} interval should fill from empty to full`);
  /* Not at 0.5 — a linear flip crosses there by definition, and the two are
   * momentarily the same height while moving in opposite directions. Anywhere
   * else they must part company. */
  for (const f of [0.25, 0.75]) {
    if (ms(kind, f) === ms('work', f)) note(`${kind} matches work at ${f} through the interval`);
  }
}
if (ms('work', -5) !== 1 || ms('work', 99) !== 0) note('meterScale did not clamp out-of-range fractions');

/* Every kind a real session emits must have somewhere to say "not the exercise".
 * A new kind slipping in would otherwise silently drain in the session accent,
 * which is exactly the signal that caused the problem. */
const kinds = new Set(plan.items.map((it) => it.kind));
const stretchKinds = new Set(
  S3.workouts.buildSession('stretch', { equip: [], level: 1, count: 0, usage: {} })
    .items.map((it) => it.kind));
stretchKinds.forEach((k) => kinds.add(k));
for (const kind of kinds) {
  if (kind === 'work') continue;
  if (!css.includes(`body[data-kind="${kind}"] .tmeter-fill`)) {
    note(`interval kind "${kind}" has no styles.css rule — it would drain in the session accent like work`);
  }
}
console.log(`interval meter: work drains, ${[...kinds].filter((k) => k !== 'work').join('/')} fill`);

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
