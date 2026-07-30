/* 3S — the stage: shows an exercise as either a licensed video clip or the drawn
 * figure, and hides which one from the player entirely.
 *
 * Per-exercise fallback is deliberate. Clips arrive incrementally, so at any
 * moment some exercises have one and some don't; the player asks the stage to
 * show an exercise and the stage picks the best available representation. A clip
 * that 404s or fails to decode falls back to the figure rather than showing a
 * blank box.
 */
(function (global) {
  'use strict';

  function Stage(mount) {
    this.figure = new global.S3.rig.Figure(mount);

    this.video = document.createElement('video');
    this.video.className = 'clip';
    this.video.muted = true;
    this.video.loop = true;
    this.video.playsInline = true;
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('muted', '');
    this.video.preload = 'auto';
    this.video.setAttribute('aria-hidden', 'true');
    mount.appendChild(this.video);

    this.ex = null;
    this.usingClip = false;
    this._failed = {};          // exercise ids whose clip could not be played

    var self = this;
    this.video.addEventListener('error', function () { self._fail(); });
    this.video.addEventListener('stalled', function () { self._fail(); });
  }

  Stage.prototype._fail = function () {
    if (!this.ex) return;
    this._failed[this.ex.id] = true;
    this._useFigure();
  };

  Stage.prototype._useFigure = function () {
    this.usingClip = false;
    this.video.classList.remove('is-on');
    this.figure.svg.style.display = '';
    try { this.video.pause(); } catch (e) {}
  };

  Stage.prototype._useClip = function (url, fit) {
    this.usingClip = true;
    this.figure.svg.style.display = 'none';
    this.video.classList.add('is-on');
    this.video.classList.toggle('is-card', fit === 'card');
    if (this.video.getAttribute('src') !== url) {
      this.video.setAttribute('src', url);
      this.video.load();
    }
    var p = this.video.play();
    if (p && p.catch) p.catch(function () { /* autoplay blocked until a gesture */ });
  };

  /* Called when the current exercise changes. `ex` may be null. */
  Stage.prototype.setExercise = function (ex, props) {
    this.ex = ex || null;
    this.figure.setProps(props || (ex && ex.props) || []);

    if (!ex) { this._useFigure(); return; }

    var media = global.S3.media;
    var url = (media && !this._failed[ex.id]) ? media.mediaUrl(ex.id) : null;
    if (url) this._useClip(url, media.fit(ex.id));
    else this._useFigure();
  };

  /* Called every animation frame. `into` is seconds into the current interval. */
  Stage.prototype.frame = function (into, speed) {
    if (!this.ex) return;
    if (this.usingClip) {
      var want = speed || 1;
      if (Math.abs(this.video.playbackRate - want) > 0.01) {
        try { this.video.playbackRate = want; } catch (e) {}
      }
      if (this.video.paused) {
        var p = this.video.play();
        if (p && p.catch) p.catch(function () {});
      }
      return;
    }
    var phase = (into * (speed || 1)) / (this.ex.cycle || 3);
    this.figure.draw(global.S3.rig.sampleLoop(this.ex.frames, phase));
  };

  /* A first user gesture unblocks autoplay on mobile; call it from Start. */
  Stage.prototype.unlock = function () {
    var p = this.video.play();
    if (p && p.catch) p.catch(function () {});
    if (!this.usingClip) { try { this.video.pause(); } catch (e) {} }
  };

  global.S3 = global.S3 || {};
  global.S3.stage = { Stage: Stage };
})(window);
