/* Drive headless Chrome over the DevTools Protocol to verify the app at real
 * phone dimensions: emulate a device, click through the screens, capture a
 * screenshot of each, and report any console error or uncaught exception.
 *
 * Chrome's --window-size flag is ignored in new headless mode, so device
 * emulation has to come from Emulation.setDeviceMetricsOverride instead.
 *
 *   node tools/shoot.js [url]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const URL_ARG = process.argv[2] || 'http://localhost:8131/';
const SHOTS = path.join(__dirname, 'shots');
const PORT = 9333;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find((p) => fs.existsSync(p));

fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const profile = path.join(os.tmpdir(), 'cdp-3s-' + PORT);
  fs.rmSync(profile, { recursive: true, force: true });
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--mute-audio', '--no-first-run', '--disable-extensions',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    'about:blank'
  ], { stdio: 'ignore' });

  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return { proc, ws: page.webSocketDebuggerUrl };
    } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome never exposed a debugging target');
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const listeners = [];

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      listeners.forEach((fn) => fn(msg));
    }
  });

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  return {
    ready,
    on: (fn) => listeners.push(fn),
    send(method, params) {
      const mid = ++id;
      return new Promise((resolve, reject) => {
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
      });
    },
    close: () => ws.close()
  };
}

(async () => {
  const { proc, ws } = await launch();
  const cdp = connect(ws);
  await cdp.ready;

  const problems = [];
  cdp.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      problems.push('EXCEPTION ' + (d.exception?.description || d.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      problems.push(msg.params.type.toUpperCase() + ' ' +
        msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      problems.push('LOG ' + msg.params.entry.text);
    }
  });

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const evalJs = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result.value;
  };

  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('  shot ' + name + '.png');
  };

  const loaded = new Promise((resolve) => {
    cdp.on((m) => { if (m.method === 'Page.loadEventFired') resolve(); });
  });
  await cdp.send('Page.navigate', { url: URL_ARG });
  await loaded;
  await sleep(700);

  /* ---- overflow check at phone width ---- */
  const overflow = await evalJs(`(function(){
    var bad = [];
    document.querySelectorAll('.screen, .home-wrap, .sheet, .triad-row, .btn, .cards, .lib-grid').forEach(function(n){
      if (n.scrollWidth > n.clientWidth + 1 && n.clientWidth > 0) {
        bad.push((n.id || n.className) + ' scrollW=' + n.scrollWidth + ' clientW=' + n.clientWidth);
      }
    });
    if (document.documentElement.scrollWidth > innerWidth + 1) {
      bad.push('DOCUMENT scrollW=' + document.documentElement.scrollWidth + ' vw=' + innerWidth);
    }
    return bad;
  })()`);

  console.log('viewport: ' + await evalJs('innerWidth + "x" + innerHeight'));
  if (overflow.length) {
    console.log('  HORIZONTAL OVERFLOW:');
    overflow.forEach((o) => console.log('    ' + o));
    problems.push('horizontal overflow at 390px: ' + overflow.join('; '));
  } else {
    console.log('  no horizontal overflow at 390px');
  }

  await shot('01-home');

  /* ---- into the location picker ---- */
  await evalJs(`document.getElementById('btn-start').click()`);
  await sleep(300);
  await evalJs(`document.querySelector('[data-loc="gym"]').click()`);
  await sleep(250);
  await shot('02-where-gym');

  /* ---- start the workout ---- */
  await evalJs(`document.getElementById('btn-begin').click()`);
  await sleep(1200);
  await shot('03-play-ready');

  /* report what the player is showing, then let it reach a work interval */
  console.log('  ready screen: ' + await evalJs(
    `document.getElementById('ex-name').textContent + ' / ' + document.getElementById('clock').textContent`));

  await sleep(11000);
  await shot('04-play-exercise');
  console.log('  exercise: ' + await evalJs(
    `document.getElementById('ex-name').textContent + ' | ' + document.getElementById('ex-cue').textContent +
     ' | clock ' + document.getElementById('clock').textContent +
     ' | ring ' + getComputedStyle(document.getElementById('ring-fg')).strokeDashoffset`));

  /* Confirm the figure is redrawing. Sample the limb geometry, not the spine:
   * plenty of exercises (punches, curls, raises) hold the torso still by
   * design, so an unchanged spine proves nothing. */
  const limbs = () => evalJs(
    `Array.prototype.map.call(document.querySelectorAll('#figwrap .fx-limb'),
       function(n){ return n.getAttribute('points'); }).join('|')`);

  /* getComputedStyle, never getAttribute: reading back an attribute only proves
   * we wrote it, and any CSS rule naming the same property beats a presentation
   * attribute. That exact gap once let a frozen progress ring pass this check. */
  const ringOffset = () => evalJs(
    `getComputedStyle(document.getElementById('ring-fg')).strokeDashoffset`);

  const seenLimbs = new Set(), seenRing = new Set();
  for (let i = 0; i < 6; i++) {
    seenLimbs.add(await limbs());
    seenRing.add(await ringOffset());
    await sleep(180);
  }
  if (seenLimbs.size < 4) problems.push(`figure barely animating: ${seenLimbs.size} distinct poses in 6 samples`);
  else console.log(`  figure animating (${seenLimbs.size}/6 distinct limb poses)`);

  if (seenRing.size < 4) {
    problems.push(`progress ring not advancing: only ${seenRing.size} distinct computed ` +
      `stroke-dashoffset values in 6 samples (${[...seenRing].join(', ')})`);
  } else {
    console.log(`  ring draining (${seenRing.size}/6 distinct computed offsets)`);
  }

  /* The dash pattern must also survive to the computed style, or the ring renders
   * as a solid circle that never appears to empty. */
  const dash = await evalJs(
    `getComputedStyle(document.getElementById('ring-fg')).strokeDasharray`);
  if (!dash || dash === 'none') problems.push(`ring stroke-dasharray did not apply (got "${dash}")`);
  else console.log(`  ring dash pattern: ${dash}`);

  /* Sit through the first move to catch the change-position gap and confirm the
   * ring resets for the move that follows. */
  let sawTransition = false, firstMove = await evalJs(`document.getElementById('ex-name').textContent`);
  for (let i = 0; i < 75 && !sawTransition; i++) {
    const name = await evalJs(`document.getElementById('ex-name').textContent`);
    if (name === 'Change Position') {
      sawTransition = true;
      await shot('09-transition');
      console.log(`  transition reached after "${firstMove}" — badge: ` +
        await evalJs(`document.getElementById('stage-badge').textContent + ' / ' +
                      document.getElementById('ex-cue').textContent`));
    }
    await sleep(1000);
  }
  if (!sawTransition) problems.push('never reached a change-position gap within 75s of the first move');
  else {
    await sleep(6000);
    const after = await evalJs(
      `document.getElementById('ex-name').textContent + '|' +
       getComputedStyle(document.getElementById('ring-fg')).strokeDashoffset`);
    const [nm, off] = after.split('|');
    console.log(`  next move: ${nm}, ring reset to offset ${off}`);
    if (nm === 'Change Position') problems.push('still showing the transition 6s later');
  }

  /* ---- pause overlay ---- */
  await evalJs(`document.getElementById('tapzone').click()`);
  await sleep(400);
  await shot('05-paused');
  const pausedShown = await evalJs(`document.getElementById('overlay').classList.contains('is-on')`);
  if (!pausedShown) problems.push('tap did not open the pause overlay');

  /* Ring fit: map every joint of every keyframe of all 98 exercises through the
   * live figure's screen transform and confirm none escapes the progress ring.
   * Cheaper and far more exact than eyeballing screenshots pose by pose. */
  const ringFit = await evalJs(`(function(){
    var svg = document.querySelector('#figwrap .figure');
    var ring = document.getElementById('ring-fg');
    /* The circle element's own bounding box already reflects r=139 scaled to the
     * element, so its half-width IS the screen radius (plus half a stroke). */
    var rb = ring.getBoundingClientRect();
    var cx = rb.x + rb.width / 2, cy = rb.y + rb.height / 2;
    var stroke = parseFloat(getComputedStyle(ring).strokeWidth) || 0;
    var R = rb.width / 2 - stroke / 2;
    var m = svg.getScreenCTM();
    var pt = svg.createSVGPoint();
    var joints = ['hip','shoulder','head','kneeL','kneeR','footL','footR','elbowL','elbowR','handL','handR'];
    var worst = { d: 0 }, over = [];
    S3.exercises.all.forEach(function(ex){
      ex.frames.forEach(function(fr, fi){
        var p = S3.rig.solve(fr);
        joints.forEach(function(k){
          pt.x = p[k][0]; pt.y = p[k][1];
          var s = pt.matrixTransform(m);
          var pad = (k === 'head' ? p.headR : 0) * (m.a) + 4;   // head radius + stroke
          var d = Math.hypot(s.x - cx, s.y - cy) + pad;
          if (d > worst.d) worst = { d: d, id: ex.id, frame: fi, joint: k };
          if (d > R) over.push(ex.id + ' f' + fi + ' ' + k);
        });
      });
    });
    return { R: R, worst: worst, over: over.slice(0, 12), overCount: over.length,
             total: S3.exercises.all.length };
  })()`);

  console.log(`  ring fit: ring radius ${ringFit.R.toFixed(1)}px, furthest joint ` +
    `${ringFit.worst.d.toFixed(1)}px (${ringFit.worst.id} ${ringFit.worst.joint})`);
  if (ringFit.overCount) {
    problems.push(`${ringFit.overCount} joints escape the ring, e.g. ${ringFit.over.join(', ')}`);
  } else {
    console.log(`  all ${ringFit.total} exercises fit inside the ring`);
  }

  const t1 = await evalJs(`document.getElementById('paused-t').textContent`);
  await sleep(2500);
  const t2 = await evalJs(`document.getElementById('paused-t').textContent`);
  if (t1 !== t2) problems.push(`paused clock kept running: ${t1} -> ${t2}`);
  else console.log(`  paused clock frozen at ${t1} across 2.5s`);

  await evalJs(`document.getElementById('btn-resume').click()`);
  await sleep(800);

  /* ---- library ---- */
  await evalJs(`document.getElementById('btn-quit').click()`);
  await sleep(300);
  await evalJs(`document.querySelector('#done [data-back]').click()`);
  await sleep(300);
  await evalJs(`document.getElementById('btn-browse').click()`);
  await sleep(1200);
  await shot('06-library');
  console.log('  library: ' + await evalJs(`document.querySelectorAll('.lib-cell').length + ' cells rendered'`));

  /* ---- settings ---- */
  await evalJs(`document.querySelector('#browse [data-back]').click()`);
  await sleep(200);
  await evalJs(`document.getElementById('btn-settings').click()`);
  await sleep(300);
  await shot('07-settings');

  /* ---- a single Sweat session, to check the red theme ---- */
  await evalJs(`document.querySelector('#settings [data-back]').click()`);
  await sleep(200);
  await evalJs(`document.getElementById('btn-single').click()`);
  await sleep(200);
  await evalJs(`document.querySelector('[data-sess="sweat"]').click()`);
  await sleep(200);
  await evalJs(`document.querySelector('[data-loc="travel"]').click()`);
  await sleep(200);
  await evalJs(`document.getElementById('btn-begin').click()`);
  await sleep(12500);
  await shot('08-sweat');
  console.log('  sweat: ' + await evalJs(
    `document.getElementById('sess-pill').textContent + ' / ' + document.getElementById('ex-name').textContent +
     ' / accent ' + getComputedStyle(document.body).getPropertyValue('--accent')`));

  console.log('');
  if (problems.length) {
    console.log(problems.length + ' PROBLEM(S):');
    [...new Set(problems)].forEach((p) => console.log('  ' + p));
  } else {
    console.log('no console errors, exceptions, or overflow detected');
  }

  cdp.close();
  proc.kill();
  process.exit(problems.length ? 1 : 0);
})().catch((err) => {
  console.error('driver failed: ' + err.message);
  process.exit(2);
});
