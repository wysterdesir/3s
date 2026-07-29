/* 3S — session templates and the workout generator.
 *
 * A template is a build() that returns ordered slot specs. Each spec names an
 * exercise group plus work/rest seconds; the generator resolves groups into
 * actual exercises, filtered by what equipment is on hand and by the user's
 * level, then normalises the timeline to land exactly on the session length.
 *
 * Variety comes from three stacked mechanisms: templates rotate by workout
 * count, exercises are picked least-recently-used first, and a seeded RNG
 * shuffles among the freshest candidates. Two consecutive workouts never look
 * the same.
 */
(function (global) {
  'use strict';

  var SESSION_LEN = 20 * 60;
  var READY = 10;

  var SESSIONS = {
    stretch: { key: 'stretch', name: 'Stretch', tag: 'Mobility & flexibility', order: 1 },
    strength: { key: 'strength', name: 'Strength', tag: 'Build & maintain muscle', order: 2 },
    sweat: { key: 'sweat', name: 'Sweat', tag: 'Cardio & conditioning', order: 3 }
  };

  var LOCATIONS = {
    gym: { key: 'gym', name: 'Gym', tag: 'Full equipment', equip: ['dumbbell', 'barbell', 'bar', 'bench', 'band', 'wall', 'chair'] },
    home: { key: 'home', name: 'Home', tag: 'Bodyweight + what you own', equip: ['wall', 'chair'] },
    travel: { key: 'travel', name: 'Travel', tag: 'Hotel room, no equipment', equip: ['wall', 'chair'] }
  };

  /* Optional add-ons the user can toggle for Home. */
  var ADDONS = [
    { key: 'dumbbell', name: 'Dumbbells' },
    { key: 'band', name: 'Bands' },
    { key: 'bar', name: 'Pull-up bar' },
    { key: 'bench', name: 'Bench' }
  ];

  /* ---------- templates ---------- */

  var TRANSITION = 5;

  function rep(n, fn) { var a = [], i; for (i = 0; i < n; i++) a = a.concat(fn(i)); return a; }

  /* Stretch runs as a continuous flow: no rest, but a short gap after each move
   * to change position. Duration is left unset so each exercise contributes its
   * own dose — ballistic moves are shorter than held ones. */
  function flow(groups) {
    var out = [];
    groups.forEach(function (g) {
      out.push({ group: g, kind: 'work' });
      out.push({ kind: 'transition', work: TRANSITION });
    });
    return out;
  }
  function circuit(groups, work, rest, roundRest) {
    var out = [];
    groups.forEach(function (g, i) {
      out.push({ group: g, work: work, kind: 'work' });
      out.push({ kind: 'rest', work: (i === groups.length - 1 && roundRest) ? roundRest : rest });
    });
    return out;
  }

  var TEMPLATES = {
    /* 24 moves per session, each drawing its own duration from the exercise.
     * Slot counts stay inside what each group can supply (hips 16, spine 14,
     * shoulders 14, hams 9, ankles 5) so a session never has to repeat a move. */
    stretch: [
      { name: 'Full-Body Flow', build: function () {
        return flow(['shoulders', 'spine', 'shoulders', 'hips', 'hams', 'ankles',
                     'spine', 'shoulders', 'hips', 'hams', 'hips', 'ankles',
                     'spine', 'spine', 'hips', 'hams', 'shoulders', 'hips',
                     'spine', 'hips', 'hams', 'ankles', 'spine', 'shoulders']);
      } },
      { name: 'Hips & Hamstrings', build: function () {
        return flow(['hips', 'hams', 'hips', 'ankles', 'hams', 'hips',
                     'spine', 'hips', 'hams', 'hips', 'ankles', 'hams',
                     'hips', 'hips', 'hams', 'spine', 'hips', 'hams',
                     'hips', 'ankles', 'hams', 'hips', 'spine', 'hips']);
      } },
      { name: 'Spine & Shoulders', build: function () {
        return flow(['shoulders', 'spine', 'shoulders', 'spine', 'hips', 'shoulders',
                     'spine', 'shoulders', 'spine', 'hams', 'shoulders', 'spine',
                     'shoulders', 'spine', 'hips', 'shoulders', 'spine', 'shoulders',
                     'spine', 'hams', 'shoulders', 'spine', 'hips', 'shoulders']);
      } },
      { name: 'Ground Flow', build: function () {
        return flow(['spine', 'spine', 'spine', 'hips', 'shoulders', 'hams',
                     'spine', 'hips', 'hips', 'spine', 'shoulders', 'hips',
                     'spine', 'hams', 'hips', 'spine', 'shoulders', 'hips',
                     'spine', 'hips', 'hams', 'spine', 'shoulders', 'hips']);
      } },
      { name: 'Long & Loose', build: function () {
        return flow(['shoulders', 'spine', 'hips', 'hams', 'ankles', 'spine',
                     'hips', 'shoulders', 'hams', 'hips', 'spine', 'shoulders',
                     'hips', 'ankles', 'hams', 'spine', 'shoulders', 'hips',
                     'hams', 'spine', 'shoulders', 'hips', 'spine', 'hips']);
      } },
      { name: 'Joints & Ranges', build: function () {
        return flow(['ankles', 'shoulders', 'hips', 'spine', 'shoulders', 'ankles',
                     'hips', 'shoulders', 'spine', 'hams', 'ankles', 'shoulders',
                     'hips', 'spine', 'shoulders', 'hams', 'hips', 'hams',
                     'shoulders', 'spine', 'shoulders', 'hips', 'spine', 'hips']);
      } }
    ],

    strength: [
      { name: 'Push · Pull · Legs', build: function (c) {
        return rep(4, function () { return circuit(['push', 'pull', 'legs', 'core'], c.work, c.rest, c.rest + 20); });
      } },
      { name: 'Lower Body Build', build: function (c) {
        return rep(4, function () { return circuit(['legs', 'hinge', 'legs', 'core'], c.work, c.rest, c.rest + 20); });
      } },
      { name: 'Upper Body Build', build: function (c) {
        return rep(4, function () { return circuit(['push', 'pull', 'shoulders', 'arms'], c.work, c.rest, c.rest + 20); });
      } },
      { name: 'Full-Body Circuit', build: function (c) {
        return rep(3, function () { return circuit(['legs', 'push', 'pull', 'hinge', 'core'], c.work, c.rest, c.rest + 20); });
      } },
      { name: 'Core & Carry', build: function (c) {
        return rep(4, function () { return circuit(['core', 'carry', 'core', 'hinge'], c.work, c.rest, c.rest + 20); });
      } },
      { name: 'Heavy Three', build: function (c) {
        return rep(5, function () { return circuit(['legs', 'push', 'pull'], c.work + 5, c.rest, c.rest + 15); });
      } },
      { name: 'Hinge & Press', build: function (c) {
        return rep(4, function () { return circuit(['hinge', 'shoulders', 'legs', 'pull'], c.work, c.rest, c.rest + 20); });
      } }
    ],

    sweat: [
      { name: 'Classic HIIT', build: function () {
        return rep(4, function () { return circuit(['impact', 'floor', 'impact', 'low', 'upper'], 40, 20, 40); });
      } },
      { name: 'Tabata Blocks', build: function () {
        return rep(4, function (b) {
          var g = ['impact', 'floor', 'impact', 'low'][b];
          return rep(8, function () { return [{ group: g, work: 20, kind: 'work', lock: true }, { kind: 'rest', work: 10 }]; })
            .concat([{ kind: 'rest', work: 40 }]);
        });
      } },
      { name: 'Descending Ladder', build: function () {
        var steps = [50, 45, 40, 35, 30, 25], out = [];
        steps.forEach(function (w) {
          out = out.concat(circuit(['impact', 'floor', 'low'], w, 18, 35));
        });
        return out;
      } },
      { name: 'Boxer Rounds', build: function () {
        return rep(5, function () {
          return circuit(['upper', 'low', 'impact', 'core'], 42, 15, 45);
        });
      } },
      { name: 'Pyramid', build: function () {
        var steps = [30, 40, 50, 50, 40, 30], out = [];
        steps.forEach(function (w) {
          out = out.concat(circuit(['impact', 'floor', 'impact'], w, 18, 32));
        });
        return out;
      } },
      { name: 'Floor & Feet', build: function () {
        return rep(4, function () { return circuit(['floor', 'impact', 'core', 'low', 'impact'], 40, 20, 40); });
      } }
    ]
  };

  /* ---------- seeded RNG ---------- */

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = a + 0x6D2B79F5 >>> 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function hash(str) {
    var h = 2166136261, i;
    for (i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* ---------- generator ---------- */

  function maxTier(level) { return level >= 2 ? 3 : 2; }

  function available(session, equip, level) {
    var all = global.S3.exercises.all, out = [], i, j, ok;
    for (i = 0; i < all.length; i++) {
      var ex = all[i];
      if (ex.pool !== session) continue;
      if (session !== 'stretch' && ex.tier > maxTier(level)) continue;
      ok = true;
      for (j = 0; j < (ex.equip || []).length; j++) {
        if (equip.indexOf(ex.equip[j]) === -1) { ok = false; break; }
      }
      if (ok) out.push(ex);
    }
    return out;
  }

  /* Pick from candidates, freshest first, with a seeded shuffle among the top
   * tier so the same "least used" exercise doesn't always win.
   *
   * Thin groups (only a couple of exercises tagged `carry`, or `arms` with no
   * equipment on hand) exhaust before a circuit's slots are filled, so there is
   * a fallback. It must still refuse the exercise that just ran: repeating a
   * move across a single rest reads as a bug, where repeating it later in the
   * session is simply another round. */
  function choose(cands, allCands, usage, used, rand, lastId) {
    var fresh = function (e) { return used.indexOf(e.id) === -1; };
    var notLast = function (e) { return e.id !== lastId; };

    var pool = cands.filter(function (e) { return fresh(e) && notLast(e); });
    if (!pool.length) pool = cands.filter(notLast);
    /* A group can be down to a single candidate — at level 1 with no equipment,
     * only one bodyweight move carries the `shoulders` tag. Rather than run it
     * twice in a row, step outside the group; a slightly off-target exercise
     * beats a visible repeat. */
    if (!pool.length) pool = allCands.filter(function (e) { return fresh(e) && notLast(e); });
    if (!pool.length) pool = allCands.filter(notLast);
    if (!pool.length) pool = cands.slice();
    if (!pool.length) return null;

    pool.sort(function (a, b) {
      var ua = usage[a.id] || 0, ub = usage[b.id] || 0;
      if (ua !== ub) return ua - ub;
      return a.id < b.id ? -1 : 1;
    });

    var window_ = Math.max(1, Math.ceil(pool.length / 2));
    return pool[Math.floor(rand() * window_)];
  }

  /* Scale rest, then work, so the timeline hits `target` exactly. */
  function fit(items, target) {
    function sum() { return items.reduce(function (t, it) { return t + it.dur; }, 0); }

    function spread(pred, min, max) {
      var idx = [], i;
      for (i = 0; i < items.length; i++) if (pred(items[i])) idx.push(i);
      if (!idx.length) return;
      var guard = 0;
      while (target - sum() !== 0 && guard < 4000) {
        var diff = target - sum();
        var step = diff > 0 ? 1 : -1;
        var moved = false;
        for (i = 0; i < idx.length && target - sum() !== 0; i++) {
          var it = items[idx[i]];
          var next = it.dur + step;
          if (next >= min && next <= max) { it.dur = next; moved = true; }
        }
        if (!moved) break;
        guard++;
      }
    }

    /* Rest is the most elastic, then work. Transitions are adjusted last so the
     * change-position gap stays the length it was designed to be. */
    spread(function (it) { return it.kind === 'rest'; }, 8, 60);
    spread(function (it) { return it.kind === 'work' && !it.lock; }, 18, 95);
    spread(function (it) { return it.kind === 'transition'; }, 4, 9);

    var left = target - sum();
    if (left > 0) items.push({ kind: 'rest', dur: left, name: 'Breathe', cue: 'Session done in a moment — shake it out' });
    while (left < 0 && items.length > 1) {
      var last = items[items.length - 1];
      if (last.dur + left >= 8) { last.dur += left; left = 0; }
      else { left += last.dur; items.pop(); }
    }
    return items;
  }

  function buildSession(session, opts) {
    var equip = opts.equip || [];
    var level = opts.level || 1;
    var count = opts.count || 0;
    var usage = opts.usage || {};

    var list = TEMPLATES[session];
    var tIdx = (count * 3 + SESSIONS[session].order + (opts.templateShift || 0)) % list.length;
    if (list.length > 1 && opts.lastTemplate === list[tIdx].name) tIdx = (tIdx + 1) % list.length;
    var template = list[tIdx];

    var work = level >= 3 ? 50 : level === 2 ? 45 : 40;
    var rest = level >= 3 ? 20 : level === 2 ? 22 : 25;
    var specs = template.build({ work: work, rest: rest, level: level });

    var cands = available(session, equip, level);
    var rand = mulberry32(hash(session + '|' + template.name + '|' + count + '|' + equip.join(',')));
    var used = [], items = [], lastPick = null, lastId = null;

    items.push({ kind: 'ready', dur: READY, name: 'Get Ready', cue: 'First move coming up' });

    for (var i = 0; i < specs.length; i++) {
      var s = specs[i];
      if (s.kind === 'rest') {
        items.push({ kind: 'rest', dur: s.work, name: 'Rest', cue: 'Breathe — next one is coming' });
        continue;
      }
      if (s.kind === 'transition') {
        items.push({ kind: 'transition', dur: s.work, name: 'Change Position' });
        continue;
      }
      var pick;
      if (s.lock && lastPick && lastPick.group === s.group) {
        pick = lastPick.ex;                       // tabata: same move all 8 intervals
      } else {
        var groupCands = cands.filter(function (e) { return e.groups.indexOf(s.group) !== -1; });
        if (!groupCands.length) groupCands = cands;
        pick = choose(groupCands, cands, usage, used, rand, lastId);
        if (!pick) continue;
        used.push(pick.id);
        if (used.length > Math.max(4, cands.length - 2)) used.shift();
        lastPick = { group: s.group, ex: pick };
      }
      lastId = pick.id;
      items.push({
        kind: 'work', dur: s.work || pick.dose || 45, exId: pick.id, name: pick.name,
        cue: pick.cue, alt: !!pick.alt, props: pick.props || [], lock: !!s.lock
      });
    }

    /* A flow ends on a move, not on a gap. */
    while (items.length && items[items.length - 1].kind === 'transition') items.pop();

    fit(items, SESSION_LEN);

    /* Attach a "next up" label to every item so transitions are never a surprise. */
    for (var j = 0; j < items.length; j++) {
      for (var k = j + 1; k < items.length; k++) {
        if (items[k].kind === 'work') { items[j].next = items[k].name; break; }
      }
    }

    return {
      session: session, template: template.name,
      items: items, length: SESSION_LEN,
      moves: items.filter(function (it) { return it.kind === 'work'; }).length
    };
  }

  function buildWorkout(opts) {
    var order = ['stretch', 'strength', 'sweat'];
    if (opts.only) order = [opts.only];
    return {
      location: opts.location,
      sessions: order.map(function (s) { return buildSession(s, opts); })
    };
  }

  global.S3 = global.S3 || {};
  global.S3.workouts = {
    SESSIONS: SESSIONS, LOCATIONS: LOCATIONS, ADDONS: ADDONS,
    SESSION_LEN: SESSION_LEN, TEMPLATES: TEMPLATES,
    buildSession: buildSession, buildWorkout: buildWorkout, available: available
  };
})(window);
