/* Capture the player showing a licensed clip, for visual review as clips arrive.
 *   node tools/shot-clip.js http://localhost:8131/ 90-90-switch alpha
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const URL_ARG = process.argv[2] || 'http://localhost:8131/';
const EX = process.argv[3] || '90-90-switch';
const LABEL = process.argv[4] || 'clip';
const PORT = 9336;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SHOTS = path.join(__dirname, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = path.join(os.tmpdir(), 'cdp-clip');
  fs.rmSync(profile, { recursive: true, force: true });
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required', '--no-first-run',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

  let ws;
  for (let i = 0; i < 60 && !ws; i++) {
    try {
      const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      ws = t.find((x) => x.type === 'page')?.webSocketDebuggerUrl;
    } catch (e) {}
    if (!ws) await sleep(250);
  }

  const sock = new WebSocket(ws);
  let id = 0; const pending = new Map();
  sock.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  await new Promise((r) => sock.addEventListener('open', r));
  const send = (method, params) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    sock.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const js = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result?.value;
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: URL_ARG });
  await sleep(2600);

  const info = await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    await new Promise(r => S3.media.onReady(r));
    document.getElementById('btn-start').click(); await wait(250);
    document.querySelector('[data-loc="gym"]').click(); await wait(200);
    document.getElementById('btn-begin').click(); await wait(1400);
    const ex = S3.exercises.byId[${JSON.stringify(EX)}];
    S3.app.show(${JSON.stringify(EX)});
    document.getElementById('ex-name').textContent = ex.name;
    document.getElementById('ex-cue').textContent = ex.cue;
    document.getElementById('stage-badge').classList.remove('is-on');
    await wait(1600);
    const st = S3.app.stage;
    return { usingClip: st.usingClip, playing: !st.video.paused, rs: st.video.readyState,
             dims: st.video.videoWidth + 'x' + st.video.videoHeight,
             fit: st.video.className, name: ex.name };
  })()`);
  console.log(JSON.stringify(info));

  const r = await send('Page.captureScreenshot', { format: 'png' });
  const out = path.join(SHOTS, `clip-${LABEL}.png`);
  fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
  console.log('wrote ' + out);

  sock.close(); proc.kill();
})().catch((e) => { console.error(e.message); process.exit(1); });
