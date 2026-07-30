/* 3S — screens, state, and wiring. */
(function (global) {
  'use strict';

  var W = global.S3.workouts;
  var EXS = global.S3.exercises;
  var KEY = 's3.v1';

  /* Shown in Settings. Bump with sw.js CACHE on every release so "which build am
   * I actually running?" is answerable from the phone instead of by guessing. */
  var BUILD = '2026-07-30 · v5';

  /* ---------- state ---------- */

  var DEFAULTS = {
    location: 'home',
    addons: [],
    sound: true,
    voice: true,
    usage: {},
    lastTemplate: {},
    counts: { stretch: 0, strength: 0, sweat: 0 },
    hours: 0,
    minutes: 0,
    days: [],          // 'YYYY-MM-DD' of every day with at least one session
    shift: 0           // nudges template rotation so it never locks into a cycle
  };

  var S = load();

  function load() {
    var out = {}, k;
    for (k in DEFAULTS) out[k] = DEFAULTS[k];
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var got = JSON.parse(raw);
        for (k in DEFAULTS) if (got[k] !== undefined && got[k] !== null) out[k] = got[k];
      }
    } catch (e) { /* corrupt or unavailable storage — fall back to defaults */ }
    if (!out.counts || typeof out.counts !== 'object') out.counts = { stretch: 0, strength: 0, sweat: 0 };
    if (!Array.isArray(out.days)) out.days = [];
    if (!Array.isArray(out.addons)) out.addons = [];
    return out;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* private mode */ }
  }

  function level() {
    var n = S.counts.strength || 0;
    return n >= 12 ? 3 : n >= 6 ? 2 : 1;
  }

  function totalSessions() {
    return (S.counts.stretch || 0) + (S.counts.strength || 0) + (S.counts.sweat || 0);
  }

  function today() {
    var d = new Date(), m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  function streak() {
    if (!S.days.length) return 0;
    var set = {}, i;
    for (i = 0; i < S.days.length; i++) set[S.days[i]] = true;
    var d = new Date(), n = 0;
    if (!set[today()]) d.setDate(d.getDate() - 1);   // yesterday still counts
    for (i = 0; i < 400; i++) {
      var m = d.getMonth() + 1, day = d.getDate();
      var k = d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
      if (!set[k]) break;
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  function equipFor(loc) {
    var base = W.LOCATIONS[loc].equip.slice();
    if (loc === 'gym') return base;
    S.addons.forEach(function (a) { if (base.indexOf(a) === -1) base.push(a); });
    return base;
  }

  /* ---------- dom helpers ---------- */

  function $(id) { return document.getElementById(id); }
  function on(node, ev, fn) { if (node) node.addEventListener(ev, fn); }
  function mmss(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  var screens = {}, current = 'home';
  ['home', 'pick', 'where', 'play', 'bridge', 'done', 'settings', 'browse'].forEach(function (id) {
    screens[id] = $(id);
  });

  function go(id) {
    if (screens[current]) screens[current].classList.remove('is-active');
    current = id;
    screens[id].classList.add('is-active');
    screens[id].scrollTop = 0;
  }

  /* ---------- player setup ---------- */

  var stage = new global.S3.stage.Stage($('figwrap'));
  var figure = stage.figure;      // the library screen still draws poses directly
  global.S3.media.load();
  var audio = new global.S3.player.Audio();
  audio.on = S.sound;
  audio.voice = S.voice;

  /* Inline style, not setAttribute: presentation attributes lose to any CSS rule
   * that names the same property, which would freeze the ring silently. */
  var RING_C = 2 * Math.PI * 139;
  var ringFg = $('ring-fg');
  ringFg.style.strokeDasharray = RING_C.toFixed(1);

  function setRing(frac) {
    ringFg.style.strokeDashoffset = (RING_C * Math.max(0, Math.min(1, frac))).toFixed(1);
  }

  var run = null;    // { plan, sessions, idx, single }
  var player = new global.S3.player.Player({
    stage: stage,
    audio: audio,
    onItem: onItem,
    onTick: onTick,
    onDone: onSessionDone
  });

  function onItem(item) {
    $('ex-name').textContent = item.name;

    if (item.kind === 'work') {
      $('ex-cue').textContent = item.cue || '';
      $('nextup').innerHTML = item.next ? 'Next <i>·</i> <b>' + esc(item.next) + '</b>' : 'Last move of the session';
      $('stage-badge').classList.remove('is-on');
    } else {
      var nx = nextWorkFrom(item);
      $('ex-cue').textContent = nx ? 'Next: ' + nx.name : 'Session complete';
      $('nextup').textContent = nx ? nx.cue : '';
      $('stage-badge').classList.toggle('is-on', !!nx);
      $('stage-badge').textContent = item.kind === 'transition' ? 'Get set' : 'Next up';
    }
  }

  function nextWorkFrom(item) {
    var items = player.plan.items, seen = false;
    for (var i = 0; i < items.length; i++) {
      if (items[i] === item) { seen = true; continue; }
      if (seen && items[i].kind === 'work') return items[i];
    }
    return null;
  }

  function onTick(t) {
    $('clock').textContent = mmss(t.remaining);
    setRing(t.itemFrac);
    $('sessbar-fill').style.width = (t.sessionFrac * 100).toFixed(2) + '%';
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- build + run ---------- */

  var pendingOnly = null;   // set when the user picked a single session

  function startWorkout() {
    var loc = S.location;
    var opts = {
      equip: equipFor(loc),
      level: level(),
      count: totalSessions(),
      usage: S.usage,
      templateShift: S.shift,
      location: loc,
      only: pendingOnly
    };
    var wk = W.buildWorkout(opts);

    run = { sessions: wk.sessions, idx: 0, single: !!pendingOnly, location: loc, started: Date.now(), done: 0 };
    S.shift = (S.shift + 1) % 7;
    save();
    playSession(0);
  }

  function playSession(i) {
    run.idx = i;
    var plan = run.sessions[i];
    var meta = W.SESSIONS[plan.session];

    document.body.setAttribute('data-session', plan.session);
    $('sess-pill').textContent = meta.name;
    $('sess-idx').textContent = run.single ? meta.tag : (i + 1) + ' of ' + run.sessions.length;
    $('sess-tmpl').textContent = plan.template;
    $('clock').textContent = mmss(plan.length);
    $('sessbar-fill').style.width = '0%';
    setRing(0);

    player.load(plan);
    go('play');
    hideOverlay();
    player.start();
  }

  function onSessionDone() {
    var plan = run.sessions[run.idx];

    /* record */
    S.counts[plan.session] = (S.counts[plan.session] || 0) + 1;
    S.minutes += Math.round(plan.length / 60);
    S.lastTemplate[plan.session] = plan.template;
    plan.items.forEach(function (it) {
      if (it.kind === 'work' && it.exId) S.usage[it.exId] = (S.usage[it.exId] || 0) + 1;
    });
    var d = today();
    if (S.days.indexOf(d) === -1) S.days.push(d);
    if (S.days.length > 400) S.days = S.days.slice(-400);
    run.done++;
    save();

    if (run.idx + 1 < run.sessions.length) showBridge();
    else finishWorkout();
  }

  function finishWorkout() {
    if (!run.single && run.done === run.sessions.length) { S.hours += 1; save(); }
    player.stop();
    document.body.removeAttribute('data-session');

    var mins = run.done * 20;
    $('done-h').textContent = run.done === 3 ? 'That is the hour.' : 'Session complete.';
    $('done-p').textContent = run.done === 3
      ? 'Stretch, Strength, and Sweat — all three done.'
      : run.done + (run.done === 1 ? ' session' : ' sessions') + ' banked.';
    $('done-stats').innerHTML =
      stat(mins, 'minutes') + stat(streak(), 'day streak') + stat(totalSessions(), 'total sessions');
    go('done');
    renderHome();
  }

  function stat(v, label) {
    return '<div class="done-stat"><b>' + v + '</b><span>' + label + '</span></div>';
  }

  /* ---------- bridge between sessions ---------- */

  var bridgeTimer = null, bridgeLeft = 0;

  function showBridge() {
    player.pause();
    var doneP = run.sessions[run.idx], nextP = run.sessions[run.idx + 1];
    $('bridge-h').textContent = W.SESSIONS[doneP.session].name + ' complete';
    $('bridge-p').textContent = 'Next up: ' + W.SESSIONS[nextP.session].name +
      ' — ' + W.SESSIONS[nextP.session].tag.toLowerCase() + ', 20 minutes.';
    go('bridge');

    bridgeLeft = 20;
    $('bridge-count').textContent = 'Starting in ' + bridgeLeft;
    clearInterval(bridgeTimer);
    bridgeTimer = setInterval(function () {
      bridgeLeft--;
      if (bridgeLeft <= 0) { advance(); return; }
      $('bridge-count').textContent = 'Starting in ' + bridgeLeft;
    }, 1000);
  }

  function advance() {
    clearInterval(bridgeTimer);
    bridgeTimer = null;
    playSession(run.idx + 1);
  }

  on($('btn-next-now'), 'click', advance);
  on($('btn-hold'), 'click', function () {
    clearInterval(bridgeTimer); bridgeTimer = null;
    $('bridge-count').textContent = 'Paused — start when you are ready';
  });
  on($('btn-bail'), 'click', function () {
    clearInterval(bridgeTimer); bridgeTimer = null;
    finishWorkout();
  });

  /* ---------- pause overlay ---------- */

  function showOverlay() {
    player.pause();
    $('paused-t').textContent = mmss(player.total - player.elapsed()) + ' left';
    $('btn-mute').textContent = 'Sound: ' + (S.sound ? 'on' : 'off');
    $('overlay').classList.add('is-on');
  }
  function hideOverlay() { $('overlay').classList.remove('is-on'); }

  on($('tapzone'), 'click', showOverlay);
  on($('pause-fab'), 'click', function (e) { e.stopPropagation(); showOverlay(); });
  on($('btn-resume'), 'click', function () { hideOverlay(); player.resume(); });
  on($('btn-skip'), 'click', function () { player.skip(); player.resume(); hideOverlay(); });
  on($('btn-prev'), 'click', function () { player.back(); player.resume(); hideOverlay(); });
  on($('btn-mute'), 'click', function () {
    S.sound = !S.sound; S.voice = S.sound;
    audio.on = S.sound; audio.voice = S.voice;
    save();
    $('btn-mute').textContent = 'Sound: ' + (S.sound ? 'on' : 'off');
  });
  on($('btn-quit'), 'click', function () { hideOverlay(); finishWorkout(); });

  /* A phone that locks or an app switch would silently eat the audio cues, so
   * stop the clock rather than let the session drift on without the user. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && current === 'play' && player.running) showOverlay();
  });

  document.addEventListener('keydown', function (e) {
    if (current !== 'play') return;
    if (e.code === 'Space') {
      e.preventDefault();
      if ($('overlay').classList.contains('is-on')) { hideOverlay(); player.resume(); }
      else showOverlay();
    }
    if (e.code === 'ArrowRight') { e.preventDefault(); player.skip(); }
    if (e.code === 'ArrowLeft') { e.preventDefault(); player.back(); }
  });

  /* ---------- home ---------- */

  function renderHome() {
    var n = totalSessions(), st = streak(), lv = level();
    var bits = [];
    if (n) bits.push('<b>' + n + '</b> session' + (n === 1 ? '' : 's'));
    if (S.hours) bits.push('<b>' + S.hours + '</b> full hour' + (S.hours === 1 ? '' : 's'));
    if (st > 1) bits.push('<b>' + st + '</b> day streak');
    bits.push('Level <b>' + lv + '</b>');
    $('stats').innerHTML = n ? bits.join('<i>·</i>') : 'First workout — welcome.';
  }

  on($('btn-start'), 'click', function () { pendingOnly = null; go('where'); renderWhere(); });
  on($('btn-single'), 'click', function () { go('pick'); });
  on($('btn-settings'), 'click', function () { renderSettings(); go('settings'); });
  on($('btn-browse'), 'click', function () { renderBrowse(); go('browse'); });

  document.querySelectorAll('[data-back]').forEach(function (b) {
    on(b, 'click', function () { go(b.getAttribute('data-back')); });
  });

  /* ---------- single-session picker ---------- */

  (function () {
    var host = $('pick-cards'), html = '';
    ['stretch', 'strength', 'sweat'].forEach(function (k) {
      var m = W.SESSIONS[k];
      html += '<button class="card" data-sess="' + k + '">' +
        '<div class="card-t"><i class="card-dot" style="background:var(--' + k + ')"></i>' + m.name + '</div>' +
        '<div class="card-p">' + m.tag + ' · 20 minutes</div></button>';
    });
    host.innerHTML = html;
    host.querySelectorAll('[data-sess]').forEach(function (b) {
      on(b, 'click', function () {
        pendingOnly = b.getAttribute('data-sess');
        go('where'); renderWhere();
      });
    });
  })();

  /* ---------- where ---------- */

  function renderWhere() {
    var host = $('loc-cards'), html = '';
    ['gym', 'home', 'travel'].forEach(function (k) {
      var L = W.LOCATIONS[k];
      html += '<button class="card' + (S.location === k ? ' is-on' : '') + '" data-loc="' + k + '">' +
        '<div class="card-t">' + L.name + '</div><div class="card-p">' + L.tag + '</div></button>';
    });
    host.innerHTML = html;
    host.querySelectorAll('[data-loc]').forEach(function (b) {
      on(b, 'click', function () {
        S.location = b.getAttribute('data-loc'); save(); renderWhere();
      });
    });

    var chips = '';
    W.ADDONS.forEach(function (a) {
      chips += '<button class="chip' + (S.addons.indexOf(a.key) !== -1 ? ' is-on' : '') +
        '" data-add="' + a.key + '">' + a.name + '</button>';
    });
    $('addon-chips').innerHTML = chips;
    $('addon-chips').querySelectorAll('[data-add]').forEach(function (b) {
      on(b, 'click', function () {
        var k = b.getAttribute('data-add'), i = S.addons.indexOf(k);
        if (i === -1) S.addons.push(k); else S.addons.splice(i, 1);
        save(); renderWhere();
      });
    });
    $('addons').classList.toggle('is-hidden', S.location === 'gym');
  }

  on($('btn-begin'), 'click', function () { audio.unlock(); startWorkout(); });

  /* ---------- settings ---------- */

  function renderSettings() {
    var host = $('setting-rows');
    host.innerHTML =
      row('sound', 'Beeps &amp; countdown tones', 'Three ticks before every change', S.sound ? 'On' : 'Off') +
      row('voice', 'Spoken exercise names', 'Called out so you can look away', S.voice ? 'On' : 'Off');

    host.querySelectorAll('[data-set]').forEach(function (b) {
      on(b, 'click', function () {
        var k = b.getAttribute('data-set');
        S[k] = !S[k];
        if (k === 'sound') audio.on = S.sound;
        if (k === 'voice') audio.voice = S.voice;
        save(); renderSettings();
      });
    });

    var lv = level(), need = lv === 1 ? 6 - (S.counts.strength || 0) : lv === 2 ? 12 - (S.counts.strength || 0) : 0;
    $('level-note').innerHTML = 'You are at <b>level ' + lv + '</b> — ' +
      (lv === 1 ? '40 second work intervals.' : lv === 2 ? '45 second intervals, harder variations unlocked.' : '50 second intervals, full exercise library.') +
      (need > 0 ? ' ' + need + ' more Strength session' + (need === 1 ? '' : 's') + ' to level up.' : '') +
      '<br><br>Build <b>' + BUILD + '</b> · ' + EXS.all.length + ' exercises · ' +
      (global.S3.media.count() || 'no') + ' video clip' + (global.S3.media.count() === 1 ? '' : 's');
  }

  function row(key, title, sub, val) {
    return '<button class="row" data-set="' + key + '"><div><div class="row-t">' + title +
      '</div><div class="row-p">' + sub + '</div></div><div class="row-v">' + val + '</div></button>';
  }

  on($('btn-reset'), 'click', function () {
    if (!confirm('Reset all progress, level, and history?')) return;
    try { localStorage.removeItem(KEY); } catch (e) {}
    S = load();
    audio.on = S.sound; audio.voice = S.voice;
    renderSettings(); renderHome();
  });

  /* ---------- exercise library ---------- */

  var libFigs = [], libTab = 'stretch', libRaf = null, libLast = 0;

  function renderBrowse() {
    var tabs = '';
    ['stretch', 'strength', 'sweat'].forEach(function (k) {
      tabs += '<button class="lib-tab' + (libTab === k ? ' is-on' : '') + '" data-tab="' + k + '">' +
        W.SESSIONS[k].name + '</button>';
    });
    $('lib-tabs').innerHTML = tabs;
    $('lib-tabs').querySelectorAll('[data-tab]').forEach(function (b) {
      on(b, 'click', function () { libTab = b.getAttribute('data-tab'); renderBrowse(); });
    });

    document.body.setAttribute('data-session', libTab);

    var list = EXS.all.filter(function (e) { return e.pool === libTab; });
    $('browse-count').textContent = list.length + ' moves in this pool · ' + EXS.all.length + ' total. New ones arrive with app updates.';

    var grid = $('lib-grid');
    grid.innerHTML = '';
    libFigs = [];

    list.forEach(function (ex) {
      var cell = document.createElement('div');
      cell.className = 'lib-cell';
      var holder = document.createElement('div');
      cell.appendChild(holder);
      var label = document.createElement('div');
      label.className = 'lib-n';
      label.textContent = ex.name;
      cell.appendChild(label);
      var eq = document.createElement('div');
      eq.className = 'lib-e';
      eq.textContent = (ex.equip && ex.equip.length) ? ex.equip.join(' · ') : 'no equipment';
      cell.appendChild(eq);
      grid.appendChild(cell);

      var fig = new global.S3.rig.Figure(holder);
      fig.setProps(ex.props || []);
      libFigs.push({ fig: fig, ex: ex, cell: cell, vis: true });
    });

    if (!libRaf) libRaf = requestAnimationFrame(libLoop);
  }

  /* Throttled to ~20fps and skipped for off-screen cells — 68 live figures
   * would otherwise fight the main thread on a phone. */
  function libLoop(ts) {
    libRaf = requestAnimationFrame(libLoop);
    if (current !== 'browse') return;
    if (ts - libLast < 50) return;
    libLast = ts;
    var vh = global.innerHeight;
    for (var i = 0; i < libFigs.length; i++) {
      var f = libFigs[i];
      var r = f.cell.getBoundingClientRect();
      if (r.bottom < -40 || r.top > vh + 40) continue;
      f.fig.draw(global.S3.rig.sampleLoop(f.ex.frames, (ts / 1000) / (f.ex.cycle || 3)));
    }
  }

  /* ---------- boot ---------- */

  /* Verification seam. Clips arrive incrementally, so tools/shoot.js needs a way
   * to put a specific exercise on the stage rather than waiting for the generator
   * to happen to pick one that has a clip. Read-only handles, no behaviour. */
  global.S3.app = {
    stage: stage, player: player,
    show: function (exId) { stage.setExercise(EXS.byId[exId] || null); stage.frame(0.4, 1); },
    state: function () { return S; }
  };

  renderHome();
  figure.draw(EXS.byId['squat'].frames[0]);

  /* Service worker updates used to need a second manual reload to take effect,
   * which in an installed PWA meant shipped fixes stayed invisible. The worker
   * calls skipWaiting/clients.claim, so it takes control as soon as it installs;
   * reloading once on that handover puts the fresh CSS and JS on screen without
   * the user knowing anything happened. The guard stops a reload loop. */
  if ('serviceWorker' in navigator) {
    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloading || current === 'play') return;   // never yank a running workout
      reloading = true;
      global.location.reload();
    });

    global.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        reg.update().catch(function () {});
      }).catch(function () { /* offline support is a bonus */ });
    });
  }
})(window);
