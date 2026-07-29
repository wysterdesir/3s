/* Resolve every exercise's keyframes through the real rig and dump the joint
 * positions as JSON, so tools/pose_sheet.py can draw a contact sheet without a
 * browser. Pair with: node tools/dump-poses.js && py tools/pose_sheet.py
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = { window: {}, Math, JSON, console };
vm.createContext(sandbox);
for (const f of ['js/rig.js', 'js/exercises.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}

const { rig, exercises } = sandbox.window.S3;

const out = exercises.all.map((ex) => {
  /* frame 0 is the start of the rep; the "extreme" is the frame furthest into
   * the loop, which is the one most likely to be authored wrong */
  const phases = ex.frames.length === 1 ? [0] : [0, 1 / ex.frames.length];
  return {
    id: ex.id,
    name: ex.name,
    pool: ex.pool,
    equip: ex.equip || [],
    props: ex.props || [],
    frames: ex.frames.map((f) => rig.solve(f)),
    phases
  };
});

fs.writeFileSync(path.join(__dirname, 'poses.json'), JSON.stringify(out));
console.log(`dumped ${out.length} exercises`);
