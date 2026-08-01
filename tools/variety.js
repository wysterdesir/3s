/* 3S — how much variety does the generator actually deliver?
 *
 *   node tools/variety.js [--workouts 12]
 *
 * Answers three questions the test suite does not:
 *
 *   1. How many exercises can each session×location even reach? A pool of eight
 *      cannot feel varied no matter how well it is shuffled.
 *   2. Which groups are under pressure — asked for more slots per session than
 *      they have exercises to fill? Those are the moves you see over and over.
 *   3. Does completing a session matter? The app records usage only when a
 *      session FINISHES, and the picker orders candidates by usage. Abandoning
 *      sessions could leave that ordering frozen, so this simulates both.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = { window: {}, Math, JSON, console };
vm.createContext(sandbox);
for (const f of ['js/rig.js', 'js/exercises.js', 'js/workouts.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const S3 = sandbox.window.S3;
const W = S3.workouts;

const args = process.argv.slice(2);
const N = (() => {
  const i = args.indexOf('--workouts');
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : 12;
})();

/* What the app actually passes for each location. Home is shown with the addons
 * most people would own; without them it behaves like Travel. */
const LOCS = {
  gym: [],
  home: ['dumbbell', 'band'],
  travel: []
};
const SESSIONS = ['stretch', 'strength', 'sweat'];

function equipFor(loc) {
  return W.LOCATIONS[loc].equip.concat(LOCS[loc]);
}

/* Slots each template asks of each group, at its heaviest. */
function demand(session) {
  const out = {};
  for (const t of W.TEMPLATES[session]) {
    const specs = t.build({ work: 40, rest: 25, level: 2 });
    const tally = {};
    specs.forEach((s) => { if (s.group) tally[s.group] = (tally[s.group] || 0) + 1; });
    for (const g in tally) out[g] = Math.max(out[g] || 0, tally[g]);
  }
  return out;
}

/* Run N consecutive workouts the way the app does. `carryUsage` mirrors whether
 * sessions are completed: the app writes usage in onSessionDone only. */
function simulate(session, loc, level, carryUsage) {
  const equip = equipFor(loc);
  const usage = {};
  const seen = new Map();
  let shift = 0, count = 0;
  for (let w = 0; w < N; w++) {
    const plan = W.buildSession(session, {
      equip, level, count, usage, templateShift: shift
    });
    shift = (shift + 1) % 7;
    for (const it of plan.items) {
      if (it.kind !== 'work') continue;
      seen.set(it.exId, (seen.get(it.exId) || 0) + 1);
      if (carryUsage) usage[it.exId] = (usage[it.exId] || 0) + 1;
    }
    if (carryUsage) count += 1;
  }
  return seen;
}

function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }

console.log(`Variety across ${N} consecutive workouts per session x location.\n`);

/* ---- 1. reachable pool ---- */

console.log('POOL SIZE — how many exercises each combination can even reach');
console.log('(level 2; level 1 excludes tier-3 moves, level 3 is the same as 2)\n');
console.log('              ' + SESSIONS.map((s) => s.padEnd(10)).join(''));
for (const loc of Object.keys(LOCS)) {
  const row = SESSIONS.map((s) => String(W.available(s, equipFor(loc), 2).length).padEnd(10));
  console.log('  ' + loc.padEnd(12) + row.join(''));
}

/* ---- 2. group pressure ---- */

console.log('\n\nGROUP PRESSURE — slots the heaviest template asks for, vs exercises available');
console.log('A ratio near or above 1 means the same moves must repeat inside one session.\n');

const tight = [];
for (const session of SESSIONS) {
  const need = demand(session);
  for (const loc of Object.keys(LOCS)) {
    const avail = W.available(session, equipFor(loc), 2);
    for (const g of Object.keys(need)) {
      const have = avail.filter((e) => e.groups.indexOf(g) !== -1).length;
      const ratio = have ? need[g] / have : Infinity;
      if (ratio >= 0.5) tight.push({ session, loc, g, need: need[g], have, ratio });
    }
  }
}
tight.sort((a, b) => b.ratio - a.ratio);
if (!tight.length) console.log('  nothing above 0.5 — every group has at least twice the moves it needs');
tight.slice(0, 14).forEach((t) => {
  console.log(`  ${(t.session + ' · ' + t.loc).padEnd(20)} ${t.g.padEnd(10)} ` +
    `${String(t.need).padStart(2)} slots / ${String(t.have).padStart(2)} moves  = ${t.ratio.toFixed(2)}`);
});

/* ---- 3. does finishing matter? ---- */

console.log('\n\nCOVERAGE — distinct exercises seen across ' + N + ' workouts');
console.log('"finished" records usage as the app does; "abandoned" never does.\n');
console.log('                        finished          abandoned');
for (const session of SESSIONS) {
  for (const loc of Object.keys(LOCS)) {
    const pool = W.available(session, equipFor(loc), 2).length;
    const fin = simulate(session, loc, 2, true);
    const aba = simulate(session, loc, 2, false);
    const label = (session + ' · ' + loc).padEnd(22);
    console.log(`  ${label}${String(fin.size).padStart(3)}/${String(pool).padEnd(4)}(${pct(fin.size, pool)}%)` +
      `      ${String(aba.size).padStart(3)}/${String(pool).padEnd(4)}(${pct(aba.size, pool)}%)`);
  }
}

/* ---- 4. the moves you would actually notice ---- */

console.log('\n\nMOST REPEATED — top 5 per session at each location, finished sessions\n');
for (const session of SESSIONS) {
  for (const loc of Object.keys(LOCS)) {
    const seen = [...simulate(session, loc, 2, true).entries()].sort((a, b) => b[1] - a[1]);
    const top = seen.slice(0, 5)
      .map(([id, n]) => `${S3.exercises.byId[id].name} x${n}`)
      .join(', ');
    console.log(`  ${(session + ' · ' + loc).padEnd(20)} ${top}`);
  }
}
