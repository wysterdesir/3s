/* 3S — media resolution and access entitlement.
 *
 * Two seams live here on purpose, both of which are cheap now and expensive to
 * retrofit once the app is commercial:
 *
 *   1. mediaUrl() is the ONLY place a clip URL is constructed. Moving from public
 *      static files to short-lived signed URLs from a Worker is a change to this
 *      one function, not to every call site.
 *   2. hasAccess() is the entitlement gate. It returns true today. When there is
 *      a paywall it consults a licence key; the call sites already exist.
 *
 * Clips are optional. If media/manifest.json is absent — which is the case on the
 * public GitHub Pages build, since licensed media never enters the repo — every
 * exercise falls back to the drawn figure and nothing breaks.
 */
(function (global) {
  'use strict';

  var CONFIG = {
    /* Flip to true on a deployment that actually serves clips. Left false so the
     * public build does not fetch a manifest it knowingly does not have — the
     * request would 404 into the console on every load and bury real errors. */
    enabled: false,

    /* Static path today. Later: an endpoint that returns a signed URL, e.g.
     * 'https://api.3smethod.com/clip'. Keep it relative so the app is portable
     * between hosts without a code change. */
    base: 'media',
    manifest: 'media/manifest.json'
  };

  var manifest = null;      // exerciseId -> { file, fit? }
  var ready = false;
  var listeners = [];

  function load() {
    if (!CONFIG.enabled || !global.fetch) { finish({}); return; }
    global.fetch(CONFIG.manifest, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(finish)
      .catch(function () { finish({}); });
  }

  function finish(data) {
    manifest = (data && typeof data === 'object') ? (data.clips || data) : {};
    ready = true;
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
    listeners = [];
  }

  /* Entitlement. Always true while the app is free. A paid build replaces the
   * body with a licence-key check and everything else keeps working. */
  function hasAccess() {
    return true;
  }

  /* Does this exercise have a usable clip right now? */
  function hasClip(exId) {
    return !!(ready && manifest && manifest[exId] && hasAccess());
  }

  /* The single place a clip URL is built. */
  function mediaUrl(exId) {
    if (!hasClip(exId)) return null;
    var entry = manifest[exId];
    var file = typeof entry === 'string' ? entry : entry.file;
    if (!file) return null;
    if (/^https?:\/\//.test(file)) return file;
    return CONFIG.base.replace(/\/$/, '') + '/' + file;
  }

  /* How the clip should sit in the stage: 'alpha' clips are keyed and drop onto
   * the dark background; 'card' clips keep their own light background and get a
   * rounded panel behind them. */
  function fit(exId) {
    var entry = manifest && manifest[exId];
    return (entry && entry.fit) || 'alpha';
  }

  function onReady(fn) {
    if (ready) fn(); else listeners.push(fn);
  }

  function count() { return manifest ? Object.keys(manifest).length : 0; }

  global.S3 = global.S3 || {};
  global.S3.media = {
    CONFIG: CONFIG, load: load, onReady: onReady,
    hasAccess: hasAccess, hasClip: hasClip, mediaUrl: mediaUrl, fit: fit,
    count: count, isReady: function () { return ready; }
  };
})(window);
