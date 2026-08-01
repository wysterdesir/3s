/* Focused probe: is the player's figure actually redrawing? Samples the full
 * limb geometry (not just the spine — some exercises barely move the torso)
 * across several frames and reports how much each element changes.
 *
 *   node tools/check-anim.js [url]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const URL_ARG = process.argv[2] || 'https://wysterdesir.github.io/3s/';
const PORT = 9334;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = path.join(os.tmpdir(), 'cdp-anim');
  fs.rmSync(profile, { recursive: true, force: true });
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
    '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'],
    { stdio: 'ignore' });

  let wsUrl;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      wsUrl = t.find((x) => x.type === 'page')?.webSocketDebuggerUrl;
    } catch (e) { /* waiting */ }
    if (!wsUrl) await sleep(250);
  }

  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const js = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.value;

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: URL_ARG });
  await sleep(2500);

  /* straight into a Sweat session at travel — fast cycles, big movements */
  await js(`document.getElementById('btn-single').click()`);
  await sleep(200);
  await js(`document.querySelector('[data-sess="sweat"]').click()`);
  await sleep(200);
  await js(`document.querySelector('[data-loc="travel"]').click()`);
  await sleep(200);
  await js(`document.getElementById('btn-begin').click()`);
  await sleep(12000);   // clear the 10s Get Ready lead-in

  const snap = () => js(`(function(){
    var g = document.getElementById('figwrap');
    var o = { name: document.getElementById('ex-name').textContent, clock: document.getElementById('clock').textContent };
    o.spine = g.querySelector('.fx-spine').getAttribute('d');
    o.limbs = Array.prototype.map.call(g.querySelectorAll('.fx-limb'), function(n){ return n.getAttribute('points'); }).join('|');
    o.head = g.querySelector('.fx-head').getAttribute('cx') + ',' + g.querySelector('.fx-head').getAttribute('cy');
    o.meter = getComputedStyle(document.getElementById('tmeter-fill')).transform;
    return o;
  })()`);

  const frames = [];
  for (let i = 0; i < 8; i++) { frames.push(await snap()); await sleep(180); }

  const uniq = (k) => new Set(frames.map((f) => f[k])).size;
  console.log(`exercise: ${frames[0].name}`);
  console.log(`8 samples over ~1.4s produced:`);
  console.log(`  distinct limb geometries : ${uniq('limbs')} / 8`);
  console.log(`  distinct spine paths     : ${uniq('spine')} / 8`);
  console.log(`  distinct head positions  : ${uniq('head')} / 8`);
  console.log(`  distinct meter transforms: ${uniq('meter')} / 8`);
  console.log(`  clock: ${frames[0].clock} -> ${frames[frames.length - 1].clock}`);

  const ok = uniq('limbs') >= 5 && uniq('meter') >= 5;
  console.log(ok ? '\nfigure and interval meter are animating' : '\nFAIL: figure is static');

  ws.close(); proc.kill();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e.message); process.exit(2); });
