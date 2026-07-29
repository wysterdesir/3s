/* Headless check of the workout generator: every template at every location and
 * level must produce a timeline that sums to exactly 20:00, resolve every slot to
 * a real exercise, and never use an exercise the location cannot supply.
 *
 *   node tools/test-generator.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = { window: {}, Math, JSON, console };
sandbox.window.Math = Math;
vm.createContext(sandbox);

for (const f of ['js/rig.js', 'js/exercises.js', 'js/workouts.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}

const S3 = sandbox.window.S3;
const W = S3.workouts;
const EX = S3.exercises;

let fails = 0;
const note = (msg) => { console.log('  FAIL ' + msg); fails++; };

/* every exercise must animate and carry the fields the player reads */
for (const ex of EX.all) {
  if (!ex.frames || ex.frames.length < 1) note(`${ex.id}: no frames`);
  if (!ex.cycle) note(`${ex.id}: no cycle`);
  if (!ex.cue) note(`${ex.id}: no cue`);
  if (!['stretch', 'strength', 'sweat'].includes(ex.pool)) note(`${ex.id}: bad pool`);
  if (!ex.groups || !ex.groups.length) note(`${ex.id}: no groups`);
  for (const fr of ex.frames) {
    const p = S3.rig.solve(fr);
    for (const k of ['hip', 'shoulder', 'head', 'kneeL', 'kneeR', 'elbowL', 'elbowR']) {
      if (!isFinite(p[k][0]) || !isFinite(p[k][1])) note(`${ex.id}: non-finite ${k}`);
    }
  }
}
console.log(`checked ${EX.all.length} exercises`);

/* ids must be unique */
const seen = new Set();
for (const ex of EX.all) {
  if (seen.has(ex.id)) note(`duplicate id ${ex.id}`);
  seen.add(ex.id);
}

/* every template, location, and level */
const locations = ['gym', 'home', 'travel'];
const addonSets = { gym: [], home: ['dumbbell', 'band', 'bar'], travel: [] };
let combos = 0;

for (const loc of locations) {
  const equip = W.LOCATIONS[loc].equip.concat(addonSets[loc]);
  for (const level of [1, 2, 3]) {
    for (const session of ['stretch', 'strength', 'sweat']) {
      const templates = W.TEMPLATES[session];
      for (let ti = 0; ti < templates.length; ti++) {
        /* drive `count` so tIdx lands on each template in turn */
        for (let count = 0; count < templates.length * 3; count++) {
          const plan = W.buildSession(session, {
            equip, level, count, usage: {}, templateShift: ti
          });
          combos++;

          const total = plan.items.reduce((t, it) => t + it.dur, 0);
          if (total !== W.SESSION_LEN) {
            note(`${loc}/L${level}/${session}/${plan.template}: total ${total}s not ${W.SESSION_LEN}s`);
          }
          if (plan.moves < 3) note(`${loc}/L${level}/${session}/${plan.template}: only ${plan.moves} moves`);

          /* No move should run back to back, and none should dominate a session.
           * Locked intervals are exempt: Tabata is 8 rounds of the same move by
           * definition, which is the protocol rather than a repetition bug. */
          const works = plan.items.filter((i) => i.kind === 'work');
          for (let n = 1; n < works.length; n++) {
            if (works[n].exId === works[n - 1].exId && !works[n].lock) {
              note(`${plan.template}: ${works[n].exId} repeats back to back`);
            }
          }
          const tally = {}, locked = {};
          works.forEach((w) => {
            tally[w.exId] = (tally[w.exId] || 0) + 1;
            if (w.lock) locked[w.exId] = true;
          });
          for (const id in tally) {
            const cap = locked[id] ? 8 : session === 'stretch' ? 1 : 6;
            if (tally[id] > cap) note(`${loc}/${session}/${plan.template}: ${id} used ${tally[id]}x (cap ${cap})`);
          }

          /* Stretch is a continuous flow: gaps to change position, never rest.
           * Every move must also land in a defensible dose range. */
          if (session === 'stretch') {
            if (plan.items.some((i) => i.kind === 'rest')) note(`${plan.template}: stretch should not contain rest items`);
            if (!plan.items.some((i) => i.kind === 'transition')) note(`${plan.template}: stretch has no transitions`);
            for (const it of plan.items) {
              if (it.kind === 'transition' && (it.dur < 4 || it.dur > 9)) {
                note(`${plan.template}: transition of ${it.dur}s outside 4-9s`);
              }
              if (it.kind === 'work' && (it.dur < 30 || it.dur > 60)) {
                note(`${plan.template}: ${it.exId} at ${it.dur}s outside the 30-60s stretch range`);
              }
            }
          }

          for (const it of plan.items) {
            if (it.dur <= 0) note(`${plan.template}: non-positive duration`);
            if (it.kind !== 'work') continue;
            const ex = EX.byId[it.exId];
            if (!ex) { note(`${plan.template}: unknown exercise ${it.exId}`); continue; }
            for (const need of ex.equip || []) {
              if (!equip.includes(need)) note(`${loc}: ${ex.id} needs ${need}`);
            }
            if (session !== 'stretch' && level < 2 && ex.tier > 2) {
              note(`L${level}: ${ex.id} is tier ${ex.tier}`);
            }
          }
        }
      }
    }
  }
}
console.log(`checked ${combos} generated sessions`);

/* variety: 6 consecutive workouts should not repeat templates or lean on the
 * same handful of exercises */
for (const loc of locations) {
  const equip = W.LOCATIONS[loc].equip.concat(addonSets[loc]);
  const usage = {};
  const seenTemplates = { stretch: [], strength: [], sweat: [] };
  const seenEx = new Set();
  let totalWork = 0;

  for (let w = 0; w < 6; w++) {
    for (const session of ['stretch', 'strength', 'sweat']) {
      const plan = W.buildSession(session, {
        equip, level: 2, count: w * 3, usage, templateShift: w
      });
      seenTemplates[session].push(plan.template);
      for (const it of plan.items) {
        if (it.kind === 'work') { usage[it.exId] = (usage[it.exId] || 0) + 1; seenEx.add(it.exId); totalWork++; }
      }
    }
  }

  for (const session of ['stretch', 'strength', 'sweat']) {
    const list = seenTemplates[session];
    for (let i = 1; i < list.length; i++) {
      if (list[i] === list[i - 1]) note(`${loc}/${session}: template "${list[i]}" repeated back to back`);
    }
    const distinct = new Set(list).size;
    if (distinct < 3) note(`${loc}/${session}: only ${distinct} distinct templates over 6 workouts`);
  }

  const pool = W.available('stretch', equip, 2).length + W.available('strength', equip, 2).length + W.available('sweat', equip, 2).length;
  console.log(`${loc}: ${seenEx.size}/${pool} distinct exercises across 6 workouts (${totalWork} work intervals)`);
  if (seenEx.size < pool * 0.7) note(`${loc}: variety engine only reached ${seenEx.size} of ${pool} available exercises`);
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
