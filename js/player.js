/* 3S — session player: drift-free timeline, audio cues, animation loop.
 *
 * Time is derived from performance.now() against an accumulator rather than
 * counted per frame, so a throttled background tab or a dropped frame never
 * makes the session drift.
 */
(function (global) {
  'use strict';

  /* ---------- audio ---------- */

  function Audio2() { this.ctx = null; this.on = true; this.voice = true; }

  Audio2.prototype.unlock = function () {
    if (!this.ctx) {
      var C = global.AudioContext || global.webkitAudioContext;
      if (C) this.ctx = new C();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    // iOS also gates speech behind a gesture; a silent utterance unlocks it.
    if (this.voice && global.speechSynthesis) {
      try {
        var u = new SpeechSynthesisUtterance('');
        u.volume = 0;
        global.speechSynthesis.speak(u);
      } catch (e) { /* not fatal */ }
    }
  };

  Audio2.prototype.tone = function (freq, dur, vol, type) {
    if (!this.on || !this.ctx) return;
    var t = this.ctx.currentTime;
    var osc = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol === undefined ? 0.22 : vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.ctx.destination);
    osc.start(t); osc.stop(t + dur + 0.02);
  };

  Audio2.prototype.tick = function () { this.tone(760, 0.09, 0.16); };
  Audio2.prototype.go = function () { this.tone(1180, 0.2, 0.24); };
  Audio2.prototype.rest = function () { this.tone(430, 0.24, 0.2); };
  Audio2.prototype.switchSide = function () {
    this.tone(980, 0.08, 0.2);
    var self = this;
    setTimeout(function () { self.tone(980, 0.08, 0.2); }, 130);
  };
  Audio2.prototype.fanfare = function () {
    var self = this, notes = [660, 880, 1180];
    notes.forEach(function (f, i) { setTimeout(function () { self.tone(f, 0.26, 0.24); }, i * 150); });
  };

  Audio2.prototype.say = function (text) {
    if (!this.voice || !global.speechSynthesis) return;
    try {
      global.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0; u.pitch = 1.0; u.volume = 1.0;
      global.speechSynthesis.speak(u);
    } catch (e) { /* not fatal */ }
  };

  /* ---------- player ---------- */

  function Player(opts) {
    this.stage = opts.stage;
    this.audio = opts.audio || new Audio2();
    this.onTick = opts.onTick || function () {};
    this.onItem = opts.onItem || function () {};
    this.onDone = opts.onDone || function () {};

    this.plan = null;
    this.acc = 0;
    this.t0 = 0;
    this.running = false;
    this.finished = false;
    this.index = -1;
    this._raf = null;
    this._cued = {};
    this._wake = null;
  }

  Player.prototype.load = function (plan) {
    this.plan = plan;
    this.acc = 0; this.t0 = 0;
    this.running = false; this.finished = false;
    this.index = -1; this._cued = {};

    var t = 0;
    plan.items.forEach(function (it) { it.start = t; t += it.dur; });
    this.total = plan.length;
  };

  Player.prototype.elapsed = function () {
    var e = this.acc;
    if (this.running) e += (performance.now() - this.t0) / 1000;
    return Math.min(e, this.total);
  };

  Player.prototype.itemAt = function (sec) {
    var items = this.plan.items;
    for (var i = items.length - 1; i >= 0; i--) if (sec >= items[i].start) return i;
    return 0;
  };

  Player.prototype.start = function () {
    this.audio.unlock();
    if (this.stage.unlock) this.stage.unlock();
    this.acquireWake();
    this.resume();
  };

  Player.prototype.resume = function () {
    if (this.running || this.finished) return;
    this.t0 = performance.now();
    this.running = true;
    this.acquireWake();
    this._loop();
  };

  Player.prototype.pause = function () {
    if (!this.running) return;
    this.acc = this.elapsed();
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    if (global.speechSynthesis) { try { global.speechSynthesis.cancel(); } catch (e) {} }
  };

  /* Jump to the start of the next work item, keeping the session clock honest
   * by shortening the remaining timeline rather than granting free time. */
  Player.prototype.skip = function () {
    var i = this.itemAt(this.elapsed());
    var items = this.plan.items;
    for (var k = i + 1; k < items.length; k++) {
      if (items[k].kind === 'work') {
        this.acc = items[k].start;
        this.t0 = performance.now();
        this._cued = {};
        return;
      }
    }
    this.acc = this.total;
    this.t0 = performance.now();
  };

  Player.prototype.back = function () {
    var i = this.itemAt(this.elapsed());
    var items = this.plan.items;
    for (var k = i - 1; k >= 0; k--) {
      if (items[k].kind === 'work') {
        this.acc = items[k].start;
        this.t0 = performance.now();
        this._cued = {};
        return;
      }
    }
    this.acc = 0; this.t0 = performance.now(); this._cued = {};
  };

  Player.prototype.stop = function () {
    this.pause();
    this.finished = true;
    this.releaseWake();
  };

  Player.prototype.acquireWake = function () {
    var self = this;
    if (!navigator.wakeLock || this._wake) return;
    navigator.wakeLock.request('screen').then(function (s) {
      self._wake = s;
      s.addEventListener('release', function () { self._wake = null; });
    }).catch(function () { /* unsupported or denied — not fatal */ });
  };

  Player.prototype.releaseWake = function () {
    if (this._wake) { try { this._wake.release(); } catch (e) {} this._wake = null; }
  };

  Player.prototype._cue = function (key, fn) {
    if (this._cued[key]) return;
    this._cued[key] = true;
    fn();
  };

  Player.prototype._loop = function () {
    var self = this;
    function frame() {
      if (!self.running) return;
      self._frame();
      self._raf = requestAnimationFrame(frame);
    }
    this._raf = requestAnimationFrame(frame);
  };

  /* Render one frame: figure pose, cues, and the UI callback. */
  Player.prototype._frame = function () {
    var sec = this.elapsed();
    var items = this.plan.items;
    var i = this.itemAt(sec);
    var item = items[i];
    var into = sec - item.start;
    var left = item.dur - into;

    if (i !== this.index) {
      this.index = i;
      this._cued = {};
      this.stage.setExercise(this._exerciseFor(item, i), this._propsFor(item, i));
      this.onItem(item, i);
      if (item.kind === 'work') {
        this.audio.go();
        this.audio.say(item.name);
      } else if (item.kind === 'rest') {
        this.audio.rest();
        if (item.next) this.audio.say('Rest. Next, ' + item.next);
      } else if (item.kind === 'transition') {
        /* Only a few seconds long, so no tone here — the 3-2-1 ticks and the
         * next move's start tone are already enough sound for the gap. */
        if (item.next) this.audio.say(item.next);
      } else if (item.kind === 'ready') {
        this.audio.say('Get ready. ' + (item.next || ''));
      }
    }

    /* halfway side switch */
    if (item.alt && into >= item.dur / 2) {
      var self = this;
      this._cue('switch', function () {
        self.audio.switchSide();
        self.audio.say('Switch sides');
      });
    }

    /* final three seconds of every item */
    var s3 = this;
    if (left <= 3.0) this._cue('t3', function () { s3.audio.tick(); });
    if (left <= 2.0) this._cue('t2', function () { s3.audio.tick(); });
    if (left <= 1.0) this._cue('t1', function () { s3.audio.tick(); });

    /* Work items show themselves; rest previews the next move at reduced speed. */
    var showEx = this._exerciseFor(item, i);
    var speed = item.kind === 'work' ? 1 : 0.55;
    this.stage.frame(into, speed);

    this.onTick({
      elapsed: sec, remaining: Math.max(0, this.total - sec),
      item: item, index: i, into: into, left: Math.max(0, left),
      itemFrac: Math.min(1, into / item.dur),
      sessionFrac: Math.min(1, sec / this.total),
      showing: showEx
    });

    if (sec >= this.total - 0.001) {
      this.running = false;
      this.finished = true;
      this.audio.fanfare();
      this.releaseWake();
      this.onDone();
    }
  };

  Player.prototype._nextWork = function (from) {
    var items = this.plan.items;
    for (var k = from + 1; k < items.length; k++) if (items[k].kind === 'work') return items[k];
    return null;
  };

  Player.prototype._nextProps = function (from) {
    var n = this._nextWork(from);
    return n ? n.props : [];
  };

  /* Which exercise the stage should be showing for this item: itself during work,
   * the upcoming move during rest and transitions so it can be learned first. */
  Player.prototype._exerciseFor = function (item, i) {
    if (item.kind === 'work') return global.S3.exercises.byId[item.exId] || null;
    var n = this._nextWork(i);
    return n ? (global.S3.exercises.byId[n.exId] || null) : null;
  };

  Player.prototype._propsFor = function (item, i) {
    return item.kind === 'work' ? item.props : this._nextProps(i);
  };

  /* How full the interval meter should be, 0..1, given the kind of interval and
   * how far through it we are.
   *
   * Work DRAINS and everything else FILLS. The bar answers a different question
   * in each state — "how long must I keep going" versus "how long until I start"
   * — and drawing both the same way meant a change-position gap, with the next
   * exercise previewing behind it, read as the exercise already running.
   *
   * It lives here rather than in app.js so the rule can be tested without a DOM;
   * app.js only turns the result into a transform. */
  function meterScale(kind, frac) {
    var f = Math.max(0, Math.min(1, frac || 0));
    return kind === 'work' ? 1 - f : f;
  }

  global.S3 = global.S3 || {};
  global.S3.player = { Player: Player, Audio: Audio2, meterScale: meterScale };
})(window);
