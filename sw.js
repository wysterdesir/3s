/* 3S service worker — cache the shell so a workout survives a dead signal.
 *
 * Bump CACHE whenever the shell changes. Not to make clients pick up the new
 * build — networkFirst below already does that on the next online load — but so
 * the OFFLINE copy is replaced promptly rather than lingering a release behind. */
var CACHE = '3s-v15';
var SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/rig.js',
  './js/exercises.js',
  './js/media.js',
  './js/stage.js',
  './js/workouts.js',
  './js/player.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

/* Network-first for anything that carries app logic — the HTML, CSS, and JS all
 * live at stable filenames, so cache-first would pin an installed app to an old
 * build and make every future fix silently invisible. Cache is the offline
 * fallback, not the default. Icons and the manifest are effectively immutable,
 * so those stay cache-first for instant startup. */
var IMMUTABLE = /\.(png|jpg|svg|webmanifest|woff2?)$/i;

function networkFirst(req) {
  return fetch(req).then(function (res) {
    if (res && res.status === 200 && res.type === 'basic') {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (r) {
      return r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined);
    });
  });
}

function cacheFirst(req) {
  return caches.match(req).then(function (hit) {
    if (hit) return hit;
    return fetch(req).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(IMMUTABLE.test(new URL(req.url).pathname) ? cacheFirst(req) : networkFirst(req));
});
