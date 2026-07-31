/* 3S — the Worker in front of the app.
 *
 * Everything except /media/* is a static asset and is handled by the assets
 * binding exactly as before; this script only exists to serve exercise clips out
 * of the private R2 bucket.
 *
 * /media/ is also where the local dev server has the clips on disk, so the app
 * uses one path in every environment and nothing host-specific leaks into it.
 * Licensed media never enters the repo, so nothing is published under this path
 * as a static asset and every request falls through to the Worker.
 *
 * Clips are served from the app's own origin on purpose. The bucket stays
 * non-public — the ExerciseAnimatic licence forbids distributing raw files, and a
 * public bucket is distribution — and same-origin means there is no CORS policy
 * to get wrong. It also puts the entitlement check (Phase 1) in the one place
 * every clip request already passes through.
 */

const CLIP = /^\/media\/([A-Za-z0-9._-]+)$/;   // no slashes: keys are flat

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const match = CLIP.exec(url.pathname);
    if (!match) return env.ASSETS.fetch(request);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    }

    /* Phase 1 hooks in here: check a licence key before the object is read, and
     * return 402 when it fails. Deliberately left open while the app is free. */

    const key = match[1];

    /* Video seeking issues range requests, and answering them with a 200 and the
     * whole body makes the player download the entire clip to jump a second. */
    const range = request.headers.get('range');
    const opts = {};
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (m && (m[1] || m[2])) {
        if (m[1] && m[2]) opts.range = { offset: +m[1], length: +m[2] - +m[1] + 1 };
        else if (m[1]) opts.range = { offset: +m[1] };
        else opts.range = { suffix: +m[2] };
      }
    }
    opts.onlyIf = request.headers;               // honours If-None-Match for free

    const object = await env.MEDIA.get(key, opts);
    if (object === null) return new Response('not found', { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);           // content-type, cache-control from the object
    headers.set('etag', object.httpEtag);
    headers.set('accept-ranges', 'bytes');
    if (!headers.has('cache-control')) {
      /* Clip names are stable and their contents never change in place, so they
       * can be cached hard. A library rebuild writes new names, not new bytes
       * under an old name. */
      headers.set('cache-control', key.endsWith('.json')
        ? 'no-cache'
        : 'public, max-age=31536000, immutable');
    }

    /* R2 returns an object with no body when an If-None-Match / If-Modified-Since
     * condition says the client's copy is still good. */
    if (object.body === undefined) return new Response(null, { status: 304, headers });
    if (request.method === 'HEAD') return new Response(null, { headers });

    if (object.range && object.size !== undefined) {
      const offset = object.range.offset ?? 0;
      const length = object.range.length ?? (object.size - offset);
      const end = offset + length - 1;
      headers.set('content-range', `bytes ${offset}-${end}/${object.size}`);
      headers.set('content-length', String(length));
      return new Response(object.body, { status: 206, headers });
    }

    return new Response(object.body, { headers });
  },
};
