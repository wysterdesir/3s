/* 3S — generate js/exercises.js from the ExerciseAnimatic catalogue.
 *
 *   node tools/build-library.js [--dry-run] [--target N]
 *
 * We used to hand-author exercises and then hunt the vendor catalogue for a clip
 * to match each one. That stalled at 53% coverage and, worse, produced confident
 * wrong matches. This inverts it: the catalogue defines the library, so every
 * exercise is backed by a real clip by construction and there is no matching step
 * left to get wrong.
 *
 * Three things this must get right, because the app leans on them:
 *
 *   1. `pool` and `groups` — the session templates resolve slots through these,
 *      and a thin group means a session repeats moves. The vendor's folder tree
 *      is the classification (100% reliable); names and muscles refine it.
 *   2. `equip` — the Gym / Home / Travel picker is only as honest as this field.
 *      Two independent signals are cross-checked and disagreements are reported.
 *   3. `frames` — clips are the primary representation, but the drawn figure is
 *      still the fallback whenever a clip is missing, still downloading, or fails
 *      to decode. Generated exercises have no bespoke poses, so each one adopts
 *      the closest of the hand-authored loops (see ARCHETYPES). Those 117 loops
 *      are the surviving value of the old library and are carried over verbatim.
 *
 * Outputs:
 *   js/exercises.js                 the library
 *   tools/catalogues/clips.json     exercise id -> exact source file, for transcode.js
 *   tools/download-list.txt         the precise files to pull from the bundle
 *   tools/catalogues/coverage.md    the review report
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');

/* Which cast to build from. The vendor shot many exercises twice and the app must
 * not swap model mid-session, so one is picked for the whole library:
 *
 *   male     1,798 clips, deep supply, but only 34% have a green-screen version
 *   female     771 clips, thinner supply, but 97% green-screen
 *   mixed    female first (for the keying), male only where she has no clip
 *   by-pool  one cast per pool — see CAST_BY_POOL
 *
 * Green-screen matters because a keyed clip drops straight onto the dark theme;
 * the rest need a light card panel behind them.
 *
 * `by-pool` is the useful compromise. A workout is three separate 20-minute
 * sessions, so the model only has to hold still within a pool, not across the
 * whole library. The female cast is almost entirely green-screen and covers
 * Stretch and Strength comfortably; her Calisthenics folder is too thin to fill
 * Sweat, which therefore comes from the male cast. */
/* Stretch is female: her mobility and yoga clips are almost all green-screen.
 * Sweat is male: her Calisthenics folder is too thin to fill it. Strength is
 * mixed because she has no plain push-up — no bodyweight upper-body work at all
 * — so the male cast fills the staples Home and Travel depend on. */
const CAST_BY_POOL = { stretch: 'female', strength: 'mixed', sweat: 'male' };
/* Override per pool: --pools strength=male,sweat=male */
(() => {
  const i = args.indexOf('--pools');
  if (i < 0 || !args[i + 1]) return;
  for (const pair of args[i + 1].split(',')) {
    const [p, c] = pair.split('=');
    if (CAST_BY_POOL[p] && ['male', 'female', 'mixed'].includes(c)) CAST_BY_POOL[p] = c;
  }
})();
const CAST = (() => {
  const i = args.indexOf('--cast');
  const v = i >= 0 && args[i + 1] ? args[i + 1] : 'by-pool';
  if (!['male', 'female', 'mixed', 'by-pool'].includes(v)) {
    console.error('--cast must be male, female, mixed, or by-pool');
    process.exit(2);
  }
  return v;
})();

const catalogue = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalogues', 'catalogue.json'), 'utf8'));

/* The hand-authored library, kept as the pose source. Reading js/exercises.js
 * here instead would make the generator eat its own output on the second run —
 * the file it reads is the file it overwrites. This snapshot is the last
 * hand-authored version and only changes when someone tunes a pose by hand. */
const POSE_SRC = fs.readFileSync(path.join(__dirname, 'catalogues', 'pose-loops.js'), 'utf8');

/* Which loops are stretches. A biceps *stretch* must not borrow the dumbbell-curl
 * animation, so stretch entries only ever match stretch loops. */
const STRETCH_LOOPS = new Set(
  [...POSE_SRC.matchAll(/\{\s*id:\s*'([^']+)',\s*name:[^}]*?pool:\s*'stretch'/g)].map((m) => m[1])
);

/* ---------- vocabulary ---------- */

/* The app knows seven implements. Anything else in the catalogue — cables,
 * machines, kettlebells, ergometers — has no place in a Gym / Home / Travel
 * model, so those exercises are dropped rather than mislabelled. */
const EQUIP_TOKENS = ['dumbbell', 'barbell', 'bar', 'bench', 'band', 'wall', 'chair'];

/* Sheet `Equipment` value (lowercased) -> our tokens, or null to drop. */
const EQUIP_SHEET = [
  [/^none|^bodyweight|yoga mat|^n\/?a$/, []],
  [/loop resistance band|resistance band|^band/, ['band']],
  [/pull ?up bar|chin ?up bar/, ['bar']],
  [/dumbbell/, ['dumbbell']],
  [/ez ?bar/, null],
  [/barbell/, ['barbell']],
  [/^bench|flat bench|incline bench|decline bench/, ['bench']],
  [/^box$/, ['bench']],
  [/^chair/, ['chair']],
  [/^wall/, ['wall']],
];

/* Filename keywords. The first list resolves to a token; the second means the
 * clip shows kit we do not model, so the exercise is dropped. 951 of 2,571
 * filenames contain no keyword at all, which is a strong bodyweight signal. */
const EQUIP_NAME = [
  [/\bdumbbells?\b|\bdb\b/, 'dumbbell'],
  [/\bbarbells?\b/, 'barbell'],
  /* A bare "bar" is nearly always a barbell's bar ("low bar squat"), not a
   * pull-up bar, so only the hanging movements claim the `bar` token. */
  [/\bpull ?ups?\b|\bchin ?ups?\b|\bhanging\b|\bhang\b/, 'bar'],
  /* "on step" is a platform; "step out" and "side step" are movements. */
  [/\bbench\b|\bbox\b|\bon (?:a )?step\b|step platform|aerobic step/, 'bench'],
  [/\bresistance bands?\b|\bbands?\b|\bbanded\b|\blooped?\b/, 'band'],
  [/\bwall\b/, 'wall'],
  [/\bchair\b/, 'chair'],
];
const EQUIP_DROP = /\bkettlebell|\bcable|\bmachine|\bsmith\b|\bexercise ball|\bsled\b|\btyre\b|\btire\b|\bbattle rope|\bjump rope|\bskipping rope|\bez ?bar|\bplate\b|\bmed(icine)? ball|\bbosu\b|\btrx\b|\bsuspension|\blandmine|\brebounder|\bairbike|\belliptical|\bergometer|\btreadmill|\bab ?wheel|\bab ?roller|\brower\b|\browing\b|\bski erg|\bhyperextension bench|\bpreacher\b|\bpec ?deck|\bhack squat|\bleg press|\bleg extension|\bleg curl machine|\bassisted\b|\blat pull ?down|\bpulley\b|\bparallette|\bdip bars?\b|\brings?\b|\bfoam roller|\bblocks?\b|\bbolster|\bstrap\b|\btowel\b|\bslider|\bhandle|\bball\b|\bstick\b|\bpole\b|\bcushion|\bpillow|\bstep ?mill|\bvest\b|\bchain\b|\bladder\b|\bhurdle\b|\bcone\b|\bparachute|\btrampoline|\btrap bar|\bhex bar|\bmonkey bar|\bswiss bar|\bsafety bar/;

/* Findings from the verification contact sheet (tools/contact-sheet.py). Both
 * equipment signals read the name, so a prop that appears only in the video is
 * invisible to them — the picture is the only place these show up. Re-review the
 * sheets after any change here and extend the lists rather than loosening them.
 *
 * Dropped: props we do not model, exercises needing a second person, and
 * sport-skill or ambulatory clips that are not a follow-along workout move. */
const EXCLUDE = [
  [/\bair swing\b/, 'swings a wooden training apparatus'],
  [/\bsandbag\b/, 'sandbag'],
  [/\brack pull\b/, 'power rack'],
  [/with partner\b|\bpartner\b/, 'needs a second person'],
  [/\bmulti.?hip\b/, 'multi-hip machine'],
  [/\bkipping\b/, 'kipping needs a bar and is a competition skill'],
  [/\bchest dip\b/, 'dip station, mislabelled as a chair'],
  [/\bl.?sit hold\b/, 'parallettes, mislabelled as bodyweight'],
  [/\btennis\b|\bbasketball\b|\bgolf\b|\bbaseball\b|\bboxing bag\b/, 'sport skill, not a workout move'],
  [/^walking$|^jogging$|\bgorilla walk\b|\bbriskly walking\b/, 'ambulatory, not an interval'],
  [/\blying neck (curl|extension)\b/, 'neck training is out of scope'],
  [/\bcelebratory\b/, 'not an exercise'],
];

/* Equipment the clip shows but neither signal names. Keeps a good exercise
 * instead of dropping it — but it must stop claiming to be bodyweight, or the
 * location picker offers it to someone in a hotel room. */
const EQUIP_FIX = [
  [/\bplank iytw\b/, ['dumbbell']],
  [/\bbent over twist\b/, ['barbell']],
  [/\bcopenhagen plank\b/, ['bench']],
  [/\blow box quick feet\b|\bincline push.?up \(?on box\)?/, ['bench']],
];

const FOLDER_POOL = {
  'Stretching - Mobility': 'stretch',
  'Yoga': 'stretch',
  'Calisthenics-Cardio-Plyo-Functional': 'sweat',
  'Chest': 'strength',
  'Back': 'strength',
  'Shoulders': 'strength',
  'Biceps': 'strength',
  'Triceps': 'strength',
  'Forearms': 'strength',
  'Legs': 'strength',
  'Abdominals': 'strength',
  'Powerlifting': 'strength',
};

/* Stretch groups, most specific first — a "standing calf stretch" is ankles, not
 * legs-by-way-of-hips. */
const STRETCH_GROUPS = [
  ['ankles', /\bcalf|\bcalves|\bankle|gastrocnemius|soleus|achilles|\btoes?\b|\bfoot\b|\bfeet\b/],
  ['hams', /hamstring|forward fold|toe touch|\bpike\b|seated fold|straight leg|\bfold\b|\bmonkey\b|hanuman|\bsplits\b|pyramid|head to knee|\bjanu\b|paschimo|down(ward)? dog|hurdler|sprinter|\brunner|straddle|\bstork\b|leg extended on wall|stepback/],
  ['hips', /\bhips?\b|glute|pigeon|groin|adductor|abductor|piriformis|butterfly|\bfrog\b|\blunge|90.?90|figure.?4|psoas|hip flexor|quadricep|\bquad\b|\bsplit\b|pyramid pose|warrior|\bsquat\b|happy baby|\bknee to chest|\bcross.?legged/],
  ['spine', /\bspine|\bspinal|\bback\b|twist|rotation|\bcat\b|\bcow\b|cobra|child|thoracic|lumbar|side bend|\btorso\b|oblique|\bsphinx|\bbridge\b|\bcamel\b|\bbow\b|\bplough|\bplow\b|\bseal\b|\bsuperman|\bfish\b|\bwheel\b/],
  ['shoulders', /shoulder|\bchest\b|\bpec\b|\blats?\b|latissimus|tricep|bicep|\bneck\b|\barms?\b|\bwrist|forearm|deltoid|\beagle\b|thread the needle|\bdoorway\b|\bplank\b/],
];

/* Strength: the folder already names the group for most of the tree. Legs and
 * Powerlifting are the two that need the name read. */
const HINGE = /deadlift|\brdl\b|romanian|good ?morning|hip thrust|glute bridge|\bswing\b|hyperextension|back extension|\bhinge\b|kickback|\bpull ?through|donkey kick|\bhip raise/;
const FOLDER_GROUP = {
  'Chest': 'push',
  'Back': 'pull',
  'Shoulders': 'shoulders',
  'Biceps': 'arms',
  'Triceps': 'arms',
  'Forearms': 'arms',
  'Abdominals': 'core',
};
const CARRY = /\bcarry|farmer|suitcase|waiter|\bhold\b|isometric|\bplank\b|wall sit|\bhang\b|\bstatic\b/;

/* Sweat, in priority order; an exercise can carry several. */
const SWEAT_GROUPS = [
  ['impact', /\bjump|\bhop\b|\bhops\b|\bjacks?\b|\bskip|burpee|\brun\b|running|sprint|high knee|butt kick|skater|\bbound|plyo|\btuck\b|\bstar\b|\bpogo|\bleap|\bsquat thrust|\bmountain\b.*\bjump|\bbroad\b|\bsplit jump|\bscissor/],
  ['floor', /\bplank|climber|\bcrawl|burpee|\bthrust\b|get ?up|\bfloor\b|\bprone\b|push ?up|sprawl|sit ?through|spiderman|\bbear\b|\bcommando|\bdolphin|\binchworm|\bworm\b/],
  ['core', /crunch|sit ?up|\btwist|oblique|hollow|\bv.?up|russian|leg raise|bicycle|\bcore\b|\btoe touch|\bflutter|\bscissor|\bknee raise|\bknee drive|\bknee strike|climber|jack ?knife|\bsit ?through|\btuck\b|\bplank\b|\bcrawl|\bbear\b|\bdead ?bug/],
  ['low', /\bsquat|\blunge|\bstep\b|shuffle|fast feet|side step|curtsy|\bkick\b|\bsit\b|\bcalf|\bskater|\bmarch/],
  ['upper', /punch|\bjab\b|\bcross\b|\bhook\b|uppercut|\barms?\b|\bpress\b|shoulder|\bpush\b|\braise\b|\bcircle|\bbox\b|boxing|boxer|\bswim|\bfly\b|\bflye/],
];

/* `Calisthenics-Cardio-Plyo-Functional` is four things in one folder, and the
 * calisthenics half is bodyweight STRENGTH — push-ups, dips, planks, pistols.
 * Sending the whole folder to Sweat is what leaves Home and Travel without a
 * bodyweight push or shoulder move. Anything explosive or locomotive stays in
 * Sweat; the rest is read as strength. Cardio is tested first so a jumping squat
 * is not mistaken for a squat. */
const CALI_CARDIO = /\bjump|\bhop\b|\bjacks?\b|\bskip|burpee|\brun\b|running|sprint|high knee|butt kick|skater|\bbound|plyo|\bpogo|\bleap|climber|shuffle|fast feet|\bpunch|\bjab\b|uppercut|shadow|\bmarch|\bsprawl|\bthrust\b|\bdrill\b|\bshuttle|\bagility|\bladder\b|\bknee strike|\bkick\b|\bbox\b|\bcrawl|spiderman|sit ?through|commando|inchworm|\bworm\b|mountain|plank.*(jack|up|down|tap|walk|reach|row|shoulder|twist|jump)|\bdrag\b/;
const CALI_STRENGTH = /push ?up|\bdips?\b|\bplank|pull ?up|chin ?up|\bhold\b|wall sit|hollow|superman|\bbridge\b|crunch|sit ?up|leg raise|dead ?bug|bird ?dog|\bl.?sit\b|handstand|muscle ?up|\brow\b|calf raise|\bglute|hip thrust|\bpistol|\bsquat\b|\blunge\b|\bstep ?up|\bcarry|\braise\b|\bextension\b|\bcurl\b/;

/* Archetype -> the hand-authored exercise whose loop it borrows. Order matters:
 * the first pattern that matches a cleaned name wins, so specific movements are
 * listed before the families that would otherwise swallow them. */
const ARCHETYPES = [
  // stretch
  /* A third element restricts an entry to one pool, for the cases where the same
   * words mean different movements — a biceps *stretch* is not a curl, and a
   * glute bridge in a mobility flow is the mobility loop, not the loaded one. */
  [/bicep.*stretch|stretch.*bicep|forearm.*stretch/, 'cross-body-shoulder', 'stretch'],
  [/glute bridge|pelvic tilt|hip thrust/, 'glute-bridge-mob', 'stretch'],
  [/sprinter|runner|low lunge|lizard|split squat stretch|couch stretch/, 'lunge-reach', 'stretch'],
  [/dead ?bug/, 'bird-dog', 'stretch'],
  [/neck/, 'neck-side'],
  [/shoulder roll|\bshrug/, 'shoulder-rolls'],
  [/arm circle|shoulder circle/, 'arm-circles'],
  [/arm swing|cross.?body|\bhug\b/, 'arm-swings'],
  [/wrist|forearm (stretch|circle)/, 'wrist-circles'],
  [/tricep.*(stretch|overhead)|overhead.*tricep.*stretch/, 'triceps-stretch'],
  [/cat|\bcow\b/, 'cat-cow'],
  [/thread.*needle/, 'thread-needle'],
  [/bird ?dog/, 'bird-dog'],
  [/cobra|sphinx|upward dog|\bseal stretch/, 'cobra-hold'],
  [/child|kneeling lat/, 'seated-fold'],
  [/supine.*twist|lying.*twist|side lying/, 'supine-twist'],
  [/open book/, 'open-book'],
  [/torso twist|standing twist|russian|rotation/, 'torso-twist'],
  [/side bend|lateral bend/, 'side-bend'],
  [/down.*dog.*pedal|calf pedal/, 'dog-calf-pedal'],
  [/down(ward)? dog|\bdolphin/, 'down-dog-cobra'],
  [/pigeon/, 'pigeon'],
  [/figure.?4|lying glute/, 'figure-4'],
  [/90.?90/, '90-90-switch'],
  [/hip flexor|kneeling.*stretch|\blow lunge/, 'hip-flexor-kneel'],
  [/frog|butterfly|adductor|groin/, 'frog-rocks'],
  [/deep squat|malasana|squat hold/, 'deep-squat-hold'],
  [/squat to stand/, 'squat-to-stand'],
  [/hip circle|fire hydrant|hip rotation/, 'hip-circles'],
  [/leg swing.*(side|lateral)/, 'leg-swings-side'],
  [/leg swing|leg kick/, 'leg-swings-fb'],
  [/knee hug|knee to chest/, 'knee-hugs'],
  [/quad (pull|stretch)|standing quad/, 'quad-pull'],
  [/hamstring sweep|toe touch walk/, 'hamstring-sweep'],
  [/standing.*hamstring|hamstring.*standing/, 'standing-ham-reach'],
  [/wide.*fold|straddle|wide legged/, 'wide-fold'],
  [/seated.*fold|forward fold|forward bend|toe touch/, 'seated-fold'],
  [/inchworm|walk ?out/, 'inchworm'],
  [/wall angel/, 'wall-angels'],
  [/scapular|scap /, 'scap-pushup'],
  [/ankle circle/, 'ankle-circles'],
  [/ankle rock|ankle mobil/, 'ankle-rocks'],
  [/calf bounce/, 'calf-bounce'],
  [/calf (stretch|raise on|lunging)|gastrocnemius|soleus stretch/, 'calf-stretch-step'],
  [/lunge.*(reach|overhead)|warrior|crescent/, 'lunge-reach'],

  // strength — upper
  [/diamond|close grip push/, 'diamond-pushup'],
  [/pike push|handstand/, 'pike-pushup'],
  [/incline push|push ?up.*bench|knee push/, 'pushup-incline'],
  [/wide push/, 'pushup-wide'],
  [/push ?up|\bchaturanga|\bpress ?up\b/, 'pushup'],
  [/\bdip\b|dips\b/, 'chair-dip'],
  [/bench press|chest press|floor press|\bfly\b|\bflye|pullover/, 'bb-bench'],
  [/renegade/, 'db-renegade-row'],
  [/\brow\b|rowing/, 'db-row'],
  [/pull ?up|\bchin ?up/, 'pull-up'],
  [/dead ?hang/, 'dead-hang'],
  [/pull ?apart|face pull|\bband.*(pull|row)/, 'band-pull-apart'],
  [/reverse (fly|flye|snow)|rear delt/, 'reverse-snow'],
  [/\by.?raise|prone.*raise|\bsuperman|swimmer/, 'prone-y-raise'],
  [/lateral raise|side raise|front raise|\bdelt raise/, 'db-lateral-raise'],
  [/shoulder press|overhead press|military|\barnold\b|\bohp\b/, 'db-shoulder-press'],
  [/upright row|\bshrug/, 'db-lateral-raise'],
  [/thruster|clean and press|push press/, 'db-thruster'],
  [/(tricep|skull|overhead).*(extension|crusher)|kick ?back/, 'db-overhead-tri'],
  [/\bcurl\b|curls\b|\bbicep/, 'db-curl'],

  // strength — lower and core
  [/goblet/, 'db-goblet-squat'],
  [/barbell.*squat|back squat|front squat/, 'bb-squat'],
  [/wall sit/, 'wall-sit'],
  [/squat pulse|pulse squat/, 'squat-pulse'],
  [/split squat|bulgarian/, 'split-squat'],
  [/step ?up|box step/, 'step-up'],
  [/reverse lunge|\blunge/, 'reverse-lunge'],
  [/calf raise|heel raise/, 'calf-raise'],
  [/\bsquat/, 'squat'],
  [/romanian|\brdl\b|stiff leg/, 'db-rdl'],
  [/deadlift/, 'bb-deadlift'],
  [/good ?morning|hip hinge|hyperextension|back extension/, 'good-morning'],
  [/single.?leg.*(bridge|thrust)|one.?leg.*bridge/, 'sl-glute-bridge'],
  [/glute bridge|hip thrust|hip raise|pelvic tilt/, 'glute-bridge'],
  [/farmer|suitcase|waiter|\bcarry\b/, 'db-carry'],
  [/side plank/, 'side-plank'],
  [/plank/, 'plank'],
  [/dead ?bug/, 'dead-bug'],
  [/hollow|\bv.?up|\bboat\b/, 'hollow-hold'],
  [/hanging.*(raise|knee|leg)|knee raise|leg raise/, 'hang-knee-raise'],
  [/crunch|sit ?up|\bcurl ?up/, 'crunch-reach'],
  [/downward|\bdd\b/, 'dd-hold'],

  // sweat
  [/burpee/, 'burpee'],
  [/mountain climber|climber/, 'mountain-climbers'],
  [/plank jack/, 'plank-jacks'],
  [/sprawl/, 'sprawl'],
  [/squat thrust/, 'squat-thrust'],
  [/bear crawl|\bcrawl/, 'bear-crawl'],
  [/cross jack|criss.?cross/, 'cross-jacks'],
  [/seal jack/, 'seal-jacks'],
  [/jumping jack|\bjack\b|\bjacks\b/, 'jumping-jacks'],
  [/high knee/, 'high-knees'],
  [/butt kick|heel.*(kick|touch)/, 'butt-kicks'],
  [/fast feet|quick feet/, 'fast-feet'],
  [/squat jump|jump squat|in and out squat/, 'squat-jump'],
  [/tuck jump/, 'tuck-jump'],
  [/split jump|jumping lunge|lunge jump|scissor/, 'split-jump'],
  [/star jump/, 'star-jump'],
  [/skater/, 'skater-hops'],
  [/shuffle|side step|lateral step/, 'lateral-shuffle'],
  [/shadow ?box|\bboxing/, 'shadow-box'],
  [/knee strike|knee drive/, 'knee-strikes'],
  [/punch|\bjab\b|uppercut|\bhook\b/, 'punch-overhead'],
  [/jump rope|skipping/, 'jump-rope'],
  [/toe tap/, 'toe-taps'],
  [/broad jump|long jump/, 'broad-jump'],
  [/sprint|running|\brun\b/, 'sprint-place'],
  [/box jump|\bjump\b|\bhop\b|\bleap/, 'squat-jump'],
];

/* Last resort when no pattern matches: a loop that at least belongs to the right
 * pool and group, so the fallback figure is never nonsense. */
const ARCH_DEFAULT = {
  'stretch:ankles': 'ankle-circles', 'stretch:hams': 'standing-ham-reach',
  'stretch:hips': 'hip-circles', 'stretch:spine': 'torso-twist',
  'stretch:shoulders': 'arm-circles',
  'strength:push': 'pushup', 'strength:pull': 'db-row', 'strength:legs': 'squat',
  'strength:hinge': 'good-morning', 'strength:core': 'crunch-reach',
  'strength:shoulders': 'db-shoulder-press', 'strength:arms': 'db-curl',
  'strength:carry': 'db-carry',
  'sweat:impact': 'jumping-jacks', 'sweat:floor': 'mountain-climbers',
  'sweat:low': 'fast-feet', 'sweat:upper': 'punch-overhead', 'sweat:core': 'mountain-climbers',
};

/* ---------- name handling ---------- */

/* `up` and `out` stay capitalised: in exercise names they are nearly always part
 * of the movement ("Step Up", "Arms Up and Down"), not prepositions. */
const SMALL = new Set(['a', 'an', 'and', 'the', 'to', 'of', 'on', 'in', 'with', 'for', 'at', 'by', 'from', 'n', 'or', 'vs']);

/* The vendor's own spelling slips. Fixed on the display name only. */
const TYPOS = [
  [/\bdumb ?ell?s?\b/gi, 'Dumbbell'],
  [/\bbarbel\b/gi, 'Barbell'],
  [/\bcalve\b/gi, 'Calf'],
  [/\bcalves stretch\b/gi, 'Calf Stretch'],
  [/\binclined\b/gi, 'Incline'],
  [/\bsitup\b/gi, 'Sit-Up'],
  [/\bpushup\b/gi, 'Push-Up'],
  [/\bpullup\b/gi, 'Pull-Up'],
  [/\bchatarunga\b/gi, 'Chaturanga'],
  [/\bexcercise\b/gi, 'Exercise'],
  [/\bstreching\b/gi, 'Stretching'],
  [/\babdominal\b/gi, 'Ab'],
];
const KEEP_CASE = { ez: 'EZ', trx: 'TRX', rdl: 'RDL', db: 'DB', bb: 'BB', ohp: 'OHP', v: 'V', t: 'T', y: 'Y', w: 'W', ttt: 'TTT', mtn: 'Mtn' };

/* Their names carry delivery metadata that should never reach the screen. */
const NOISE = [
  /_(male|female)\b/gi,
  /\b(front|side|back|rear|top)[- ]?(view|pov)\b/gi,
  /\bpov\b/gi,
  /\b(camera|angle)\s*\d*\b/gi,
  /\bversion\s*\d*\b/gi,
  /\bvariation\s*\d*\b/gi,
  /\bfinal\b/gi,
  /\bnew\b(?=\s*$)/gi,
  /\(\s*\)/g,
];

function cleanName(file) {
  let s = file.replace(/\.mp4$/i, '');
  NOISE.forEach((re) => { s = s.replace(re, ' '); });
  s = s.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\s*\bn\b\s*/gi, ' and ');            // "left n right"
  s = titleCase(s);
  TYPOS.forEach(([re, to]) => { s = s.replace(re, to); });
  return s.replace(/\s+/g, ' ').trim();
}

function titleCase(s) {
  const words = s.split(/\s+/).filter(Boolean);
  return words.map((w, i) => {
    const bare = w.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (KEEP_CASE[bare] && bare.length <= 3) return w.replace(new RegExp(bare, 'i'), KEEP_CASE[bare]);
    if (/^\d/.test(w)) return w.toLowerCase();
    if (i > 0 && SMALL.has(bare)) return w.toLowerCase();
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/* The identity used for de-duplication. Strips the axes along which the vendor
 * shot the SAME movement more than once — camera side, which limb leads, tempo
 * notes — while keeping the axes that make two clips genuinely different
 * exercises, above all the implement. */
function coreKey(name) {
  let s = ' ' + name.toLowerCase() + ' ';
  s = s.replace(/\b(left|right|l|r)\b/g, ' ');
  s = s.replace(/\b(single|one|1) (arm|leg|side|handed|hand)\b/g, ' unilateral ');
  s = s.replace(/\balternat(e|ing|ed)\b/g, ' ');
  s = s.replace(/\b\d+\s*(sec|second|seconds|count)\b/g, ' ');
  s = s.replace(/\b(slow|fast|tempo|hold|pause|paused|static|isometric)\b/g, ' ');
  s = s.replace(/\b(and|with|to|the|a|an|on|in|of|n|for|from|at|by)\b/g, ' ');
  s = s.replace(/\bups?\b/g, ' up ');
  s = s.replace(/\bdowns?\b/g, ' down ');
  s = s.replace(/(\w+)s\b/g, '$1');                    // crude singularise
  return s.replace(/[^a-z0-9]+/g, ' ').trim();
}

/* ---------- classification ---------- */

function equipFor(item) {
  /* Match against the CLEANED name, not the raw filename. `_` is a word
   * character, so in "pistol squat to box_female" the pattern \bbox\b never
   * fires — every equipment keyword that happened to sit last in a filename was
   * being missed. */
  const name = ' ' + cleanName(item.file).toLowerCase() + ' ';
  const sheetRaw = (item.equipment || '').toLowerCase().trim();

  if (EQUIP_DROP.test(name)) return { drop: 'kit-in-name' };
  for (const [re, why] of EXCLUDE) if (re.test(name.trim())) return { drop: 'review: ' + why };
  for (const [re, equip] of EQUIP_FIX) {
    if (re.test(name)) return { equip: equip, source: 'contact-sheet', conflict: null };
  }

  /* Filename first — it describes the clip that will actually be on screen. */
  const fromName = [];
  for (const [re, tok] of EQUIP_NAME) if (re.test(name)) fromName.push(tok);
  const nameHasKit = fromName.length > 0;

  let fromSheet = null;
  if (sheetRaw) {
    let matched = false;
    for (const [re, tok] of EQUIP_SHEET) {
      if (re.test(sheetRaw)) { fromSheet = tok; matched = true; break; }
    }
    /* A sheet value we do not recognise names kit we do not model. Trust it only
     * when the filename does not already say otherwise — some clips are labelled
     * with the machine an alternative version uses. */
    if (!matched) {
      if (!nameHasKit) return { drop: 'kit-in-sheet' };
      fromSheet = null;
    }
  }

  if (nameHasKit) {
    const equip = dedupe(fromName);
    const conflict = fromSheet && fromSheet.length && fromSheet.join() !== equip.join();
    return { equip, source: 'filename', conflict: conflict ? `sheet said ${fromSheet.join('+') || 'none'}` : null };
  }
  if (fromSheet && fromSheet.length) {
    /* Sheet names kit the filename omits. Believe it — "Chest Press" with
     * `Dumbbells` is a dumbbell move — but record it as the weaker signal. */
    return { equip: fromSheet, source: 'sheet', conflict: null };
  }
  return { equip: [], source: sheetRaw ? 'both' : 'filename-empty', conflict: null };
}

function dedupe(a) { return a.filter((v, i) => a.indexOf(v) === i).sort(); }

function muscleTokens(item) {
  /* Their muscle strings nest commas inside parentheses — "Glutes (gluteus
   * maximus, gluteus medius)" — so split on commas at depth 0 only. */
  const out = [];
  let depth = 0, cur = '';
  for (const ch of (item.primary || '') + ',' + (item.secondary || '')) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.replace(/\(.*/, '').trim().toLowerCase()).filter(Boolean);
}

/* Unloaded joint work — arm circles, leg swings, ankle dorsiflexion — is filed
 * under the muscle it serves, so it arrives labelled as Strength. It is warm-up,
 * not a working set, and belongs in the Stretch flow. */
const MOBILITY = /\bcircles?\b|\bswings?\b|dorsal flexion|plantar flexion|\brotations?\b|mobility|warm ?up|\brolls?\b|pendulum|\bsweeps?\b|\bopener|dislocat|\bwindmill/;
const LOADED = EQUIP_NAME.filter(([, t]) => t !== 'wall' && t !== 'chair');

function poolFor(item) {
  const base = FOLDER_POOL[item.folder];
  const low = ' ' + cleanName(item.file).toLowerCase() + ' ';
  if (base === 'strength') {
    return !LOADED.some(([re]) => re.test(low)) && MOBILITY.test(low) ? 'stretch' : 'strength';
  }
  if (base !== 'sweat') return base;
  if (CALI_CARDIO.test(low)) return 'sweat';
  return CALI_STRENGTH.test(low) ? 'strength' : 'sweat';
}

/* Bodyweight strength pulled out of the Calisthenics folder still needs a group,
 * and the folder name cannot supply one. */
const CALI_GROUP = [
  ['push', /push ?up|\bdips?\b|\bpress\b|chaturanga/],
  ['pull', /pull ?up|chin ?up|\brow\b|\bsuperman|\bswimmer/],
  ['shoulders', /handstand|\bpike\b|\braise\b|\bwall walk/],
  ['core', /\bplank|crunch|sit ?up|leg raise|hollow|dead ?bug|bird ?dog|\bl.?sit\b|\bcrawl|\btwist|oblique|\bv.?up/],
  ['hinge', /\bbridge\b|hip thrust|\bglute|good ?morning|\bextension\b|hamstring curl|nordic|leg curl/],
  ['legs', /\bsquat\b|\blunge\b|\bstep ?up|\bpistol|calf raise|\bwall sit/],
  /* "Curl" only means arms when it is qualified as an arm curl — a hamstring
   * curl is a hinge, and tagging it `arms` puts a leg move in the arm slot. */
  ['arms', /\b(?:bicep|hammer|concentration|preacher|zottman|reverse|drag|spider)s? ?curls?\b|tricep|bicep/],
];

function classify(item) {
  const pool = poolFor(item);
  const name = cleanName(item.file);
  const low = ' ' + name.toLowerCase() + ' ';
  const muscles = muscleTokens(item).join(' ');
  const hay = low + ' ' + muscles;
  const groups = [];

  if (pool === 'stretch') {
    for (const [g, re] of STRETCH_GROUPS) if (re.test(hay)) groups.push(g);
    if (!groups.length) groups.push('spine');
  } else if (pool === 'sweat') {
    for (const [g, re] of SWEAT_GROUPS) if (re.test(low)) groups.push(g);
    if (!groups.length) groups.push(/\bhold|\bstatic/.test(low) ? 'floor' : 'low');
  } else {
    const fixed = FOLDER_GROUP[item.folder];
    if (fixed) groups.push(fixed);
    else if (item.folder === 'Legs') groups.push(HINGE.test(low) ? 'hinge' : 'legs');
    else if (item.folder === 'Calisthenics-Cardio-Plyo-Functional') {
      for (const [g, re] of CALI_GROUP) if (re.test(low)) groups.push(g);
      if (!groups.length) groups.push('core');
    } else {                                                     // Powerlifting
      if (HINGE.test(low)) groups.push('hinge');
      else if (/squat|lunge|leg/.test(low)) groups.push('legs');
      else if (/bench|press.*chest|\bpush/.test(low)) groups.push('push');
      else if (/row|pull|chin/.test(low)) groups.push('pull');
      else if (/press|jerk|snatch/.test(low)) groups.push('shoulders');
      else groups.push('legs');
    }
    /* Secondary tags widen thin groups without diluting the primary one. */
    if (item.folder === 'Chest' && /\bpress\b/.test(low) && /shoulder|deltoid/.test(muscles)) groups.push('shoulders');
    if (item.folder === 'Back' && /shrug|upright/.test(low)) groups.push('shoulders');
    if (item.folder === 'Abdominals' && CARRY.test(low)) groups.push('carry');
    if (CARRY.test(low) && !groups.includes('carry')) groups.push('carry');
    /* Triceps-dominant pushes fill the `arms` slot too, which is otherwise almost
     * entirely loaded work and leaves Home and Travel with nothing. */
    if (/\bdips?\b|diamond|close grip|sphinx|\btricep/.test(low) && !groups.includes('arms')) groups.push('arms');
  }
  return { pool, name, groups: dedupe(groups) };
}

function archetypeFor(name, pool, groups) {
  const low = name.toLowerCase();
  for (const [re, id, only] of ARCHETYPES) {
    if (only && only !== pool) continue;
    if (pool === 'stretch' && !STRETCH_LOOPS.has(id)) continue;
    if (re.test(low)) return { id, exact: true };
  }
  for (const g of groups) {
    const d = ARCH_DEFAULT[pool + ':' + g];
    if (d) return { id: d, exact: false };
  }
  return { id: 'squat', exact: false };
}

/* Stretch dose follows the research the app already runs on: ballistic moves are
 * short, flows sit in the middle, passive holds are long. */
function doseFor(name) {
  const low = name.toLowerCase();
  if (/\b(swing|circle|roll|bounce|pulse|dynamic|kick|rock|sweep|march|scissor|windmill)\b/.test(low)) return 40;
  if (/\b(hold|static|pose|passive|seated|lying|supine|prone|kneeling|sit)\b/.test(low)) return 56;
  return 48;
}

/* Tier 3 is gated behind level 2, so it holds the genuinely hard work: skill
 * moves, true plyometrics, and anything unilateral under load. */
const TIER3 = /\bclap\b|one arm|single arm push|planche|\blever\b|\bflag\b|pistol|muscle ?up|hand ?stand|\bl.?sit\b|archer|\bdragon|\bshrimp\b|depth jump|box jump|tuck jump|\bplyo|explosive|\bsnatch|\bjerk\b|\bclean\b|burpee|\bsprint|\bcopenhagen/;

/* Beginner cardio staples. Without this, matching `\bjump` alone pushed jumping
 * jacks, high knees and skipping to tier 3 and locked the most basic moves in
 * the app behind level 2 — a level-1 Sweat session was left with the leftovers. */
const TIER1_BASIC = /jumping jack|criss ?cross jack|\bjacks?\b|high knee|butt kick|\brunning\b|\bskipping\b|\bmarch|toe tap|fast feet|\bwalking\b|step touch|\bshuffle/;

const TIER2_MOVE = /\bjump|\bhop\b|\bbound|skater|\bleap|squat thrust|thruster|\bsquat\b|deadlift|press|\brow\b|pull ?up|chin ?up|\blunge|\bdips?\b/;

function tierFor(name, equip, pool) {
  const low = name.toLowerCase();
  if (pool === 'stretch') return 1;
  if (TIER3.test(low)) return 3;
  if (TIER1_BASIC.test(low)) return 1;
  if (equip.length && !equip.every((e) => e === 'wall' || e === 'chair')) return 2;
  return TIER2_MOVE.test(low) ? 2 : 1;
}

/* One short coaching line. Their tips are numbered prose; take the first
 * sentence, drop the numbering, and keep it short enough for the player. */
function cueFor(item, name, groups, arch) {
  const raw = (item.tips || item.steps || '').replace(/\s+/g, ' ').trim();
  let s = raw.replace(/^\s*\d+[.)]\s*/, '');
  s = s.split(/(?<=[a-z0-9)])\.\s+(?=[A-Z0-9])/)[0] || '';
  s = s.replace(/^\s*\d+[.)]\s*/, '').replace(/\.\s*$/, '').trim();
  if (s.length > 78) {
    const cut = s.slice(0, 78);
    s = cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[,;:]$/, '');
  }
  if (s.length >= 12) return s.charAt(0).toUpperCase() + s.slice(1);
  /* Most green-screen clips are undocumented, so this fallback runs often. Reach
   * for the archetype's hand-written line before the group-level generic — it
   * describes the actual movement rather than the slot it fills. */
  const fromArch = (loops.get(arch) || {}).cue;
  if (fromArch) return fromArch;
  const g = groups[0];
  return {
    ankles: 'Ease into it, keep the heel down', hams: 'Long spine, soften the knees',
    hips: 'Sink into the stretch and breathe', spine: 'Move slowly through the range',
    shoulders: 'Relax the neck, keep it gentle',
    push: 'Brace the core, control the descent', pull: 'Lead with the elbows, squeeze at the top',
    legs: 'Weight through the heels, chest tall', hinge: 'Hinge from the hips, flat back',
    core: 'Ribs down, breathe out on the effort', arms: 'No swinging — the arms do the work',
    carry: 'Squeeze everything and hold the line',
    impact: 'Land soft, stay light on the feet', floor: 'Hips level, core switched on',
    low: 'Stay low and keep the feet quick', upper: 'Fast hands, shoulders loose',
  }[g] || 'Controlled reps, steady breathing';
}

/* ---------- the hand-authored pose loops ---------- */

function extractLoops(src) {
  const loops = new Map();
  const re = /\{\s*id:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(src))) {
    const id = m[1];
    const fi = src.indexOf('frames:', m.index);
    if (fi === -1) continue;
    let i = src.indexOf('[', fi), depth = 0, j = i;
    for (; j < src.length; j++) {
      if (src[j] === '[') depth++;
      else if (src[j] === ']') { depth--; if (!depth) break; }
    }
    const seg = src.slice(m.index, j);
    const cyc = /cycle:\s*([0-9.]+)/.exec(seg);
    const props = /props:\s*(\[[^\]]*\])/.exec(seg);
    const cue = /cue:\s*'((?:[^'\\]|\\.)*)'/.exec(seg);
    loops.set(id, {
      frames: src.slice(i, j + 1).replace(/\s+/g, ' ').trim(),
      cycle: cyc ? parseFloat(cyc[1]) : 3,
      alt: /alt:\s*true/.test(seg),
      props: props ? props[1].replace(/\s+/g, ' ') : null,
      cue: cue ? cue[1] : '',
    });
  }
  return loops;
}

const loops = extractLoops(POSE_SRC);

/* ---------- build candidates ---------- */

const dropped = { gender: 0, equip: 0, folder: 0, review: 0 };
const conflicts = [];
let candidates = [];

/* In `mixed`, the male clip is only reachable where the female cast has none, so
 * index which exercises she covers before filtering. */
const femaleKeys = new Set(catalogue.items.filter((i) => i.gender === 'female').map((i) => i.key));

function inCast(item) {
  /* Use the refined pool, not the raw folder: the calisthenics-as-strength items
   * belong to the Strength cast even though they ship in the Sweat folder. */
  const want = CAST === 'by-pool' ? CAST_BY_POOL[poolFor(item)] : CAST;
  if (want === 'male') return item.gender === '';
  if (want === 'female') return item.gender === 'female';
  return item.gender === 'female' || !femaleKeys.has(item.key);   // mixed
}

for (const item of catalogue.items) {
  if (!inCast(item)) { dropped.gender++; continue; }
  if (!FOLDER_POOL[item.folder]) { dropped.folder++; continue; }

  const eq = equipFor(item);
  if (eq.drop) { (eq.drop.startsWith('review:') ? dropped.review++ : dropped.equip++); continue; }

  const { pool, name, groups } = classify(item);
  if (eq.conflict) conflicts.push(`${item.folder}/${item.file} — filename says ${eq.equip.join('+') || 'bodyweight'}, ${eq.conflict}`);

  const arch = archetypeFor(name, pool, groups);
  candidates.push({
    key: coreKey(name),
    name, pool, groups,
    equip: eq.equip,
    equipSource: eq.source,
    tier: tierFor(name, eq.equip, pool),
    arch: arch.id,
    archExact: arch.exact,
    cue: cueFor(item, name, groups, arch.id),
    dose: pool === 'stretch' ? doseFor(name) : null,
    green: !!item.green,
    src: item.green
      ? { tree: 'green', folder: item.green.folder, file: item.green.file }
      : { tree: 'sd', folder: item.folder, file: item.file },
    hasTips: !!item.tips,
    hasMuscles: !!item.primary,
    folder: item.folder,
    cast: item.gender || 'male',
    travel: eq.equip.every((e) => e === 'wall' || e === 'chair'),
  });
}

/* ---------- dedupe near-identical variants ---------- */

/* Green-screen has to outweigh everything else combined. The vendor documented
 * the two batches unevenly — clips with a green-screen version carry tips and
 * muscles only 31% of the time, against 96% for the rest — so a modest bonus
 * loses every tie and the library fills up with clips that need a light card
 * panel. A missing cue has a good hand-written fallback; a card panel on a dark
 * screen is visible for the whole interval. */
function score(c) {
  let s = 0;
  if (c.green) s += 8;
  if (c.hasTips) s += 2;                     // a cue in the vendor's own words
  if (c.hasMuscles) s += 2;
  if (c.archExact) s += 2;                   // the figure fallback will be right
  if (c.travel) s += 1;                      // Home and Travel are supply-bound
  if (c.equipSource === 'filename') s += 1;
  s -= Math.floor(c.name.length / 22);       // prefer the plainly-named variant
  if (/\b(unilateral|left|right)\b/i.test(c.name)) s -= 1;
  return s;
}

const byKey = new Map();
for (const c of candidates) {
  const prev = byKey.get(c.key);
  if (!prev || score(c) > score(prev) || (score(c) === score(prev) && c.name < prev.name)) byKey.set(c.key, c);
}
const deduped = [...byKey.values()];

/* ---------- curate ---------- */

/* Slot counts the templates demand, per group, in the heaviest single session.
 * Stretch caps an exercise at one use per session, so its groups need real depth;
 * strength and sweat may reuse a move up to six times. */
/* Sized from what the templates actually demand, with headroom. The binding
 * number per group is the most slots any single session asks of it — Stretch
 * caps a move at one use per session so its groups need real depth, while
 * Strength and Sweat may reuse a move up to six times. */
const QUOTA = {
  stretch: { hips: 24, spine: 20, shoulders: 20, hams: 16, ankles: 10 },
  strength: { legs: 22, core: 20, push: 18, pull: 18, shoulders: 18, arms: 16, hinge: 14, carry: 12 },
  /* Sweat's heaviest single session asks for 12 impact slots and 6 floor, and a
   * move may repeat up to six times, so these sit well clear of demand. Setting
   * them to whatever supply happens to be makes the shortfall check circular —
   * it would then only ever report "supply equals supply". */
  sweat: { impact: 18, floor: 8, low: 12, upper: 12, core: 8 },
};
/* Travel is the binding case: wall and chair only. Every group must still fill a
 * session without repeating, so hold a floor of bodyweight options in each. */
const TRAVEL_MIN = {
  stretch: { hips: 14, spine: 13, shoulders: 13, hams: 9, ankles: 5 },
  strength: { legs: 8, core: 8, push: 6, pull: 6, shoulders: 6, arms: 6, hinge: 6, carry: 6 },
  sweat: { impact: 16, floor: 8, low: 8, upper: 6, core: 6 },
};

/* Stretch exercises usually earn two or three group tags, so hitting the group
 * quotas leaves the pool itself thin. Top the pools up afterwards to these sizes.
 * Home and Travel run on bodyweight alone, so hold a share of each pool there. */
const POOL_TARGET = { stretch: 90, strength: 140, sweat: 70 };
const POOL_TRAVEL_SHARE = { stretch: 0.9, strength: 0.5, sweat: 0.9 };

const chosen = new Map();                    // name -> candidate
const counts = {};                           // pool:group -> { total, travel }
const poolCount = { stretch: { total: 0, travel: 0 }, strength: { total: 0, travel: 0 }, sweat: { total: 0, travel: 0 } };

function pick(c) {
  if (chosen.has(c.name)) return false;
  chosen.set(c.name, c);
  for (const g of c.groups) {
    const k = c.pool + ':' + g;
    counts[k] = counts[k] || { total: 0, travel: 0 };
    counts[k].total++;
    if (c.travel) counts[k].travel++;
  }
  poolCount[c.pool].total++;
  if (c.travel) poolCount[c.pool].travel++;
  return true;
}

const rank = (a, b) => score(b) - score(a) || (a.name < b.name ? -1 : 1);

/* Pass 1 — per group, seat the bodyweight floor, then fill the quota on merit.
 * Doing merit first would spend a whole quota on loaded gym variants and leave
 * Travel unable to build a session at all. */
for (const pool of ['stretch', 'strength', 'sweat']) {
  for (const g of Object.keys(QUOTA[pool])) {
    const supply = deduped.filter((c) => c.pool === pool && c.groups.includes(g)).sort(rank);
    const k = pool + ':' + g;
    for (const c of supply) {
      if ((counts[k] || { travel: 0 }).travel >= TRAVEL_MIN[pool][g]) break;
      if (c.travel) pick(c);
    }
    for (const c of supply) {
      if ((counts[k] || { total: 0 }).total >= QUOTA[pool][g]) break;
      pick(c);
    }
  }
}

/* Pass 2 — top each pool up to its target, holding the bodyweight share while
 * there is still bodyweight supply to hold it with. */
for (const pool of ['stretch', 'strength', 'sweat']) {
  const supply = deduped.filter((c) => c.pool === pool && !chosen.has(c.name)).sort(rank);
  for (const guard of [true, false]) {
    for (const c of supply) {
      if (poolCount[pool].total >= POOL_TARGET[pool]) break;
      if (guard && !c.travel && poolCount[pool].travel / poolCount[pool].total < POOL_TRAVEL_SHARE[pool]) continue;
      pick(c);
    }
  }
}

const shortfall = [];
for (const pool of ['stretch', 'strength', 'sweat']) {
  for (const g of Object.keys(QUOTA[pool])) {
    const k = pool + ':' + g;
    const have = counts[k] || { total: 0, travel: 0 };
    const supply = deduped.filter((c) => c.pool === pool && c.groups.includes(g));
    if (have.total < QUOTA[pool][g] || have.travel < TRAVEL_MIN[pool][g]) {
      shortfall.push(`${k}: ${have.total}/${QUOTA[pool][g]} total, ${have.travel}/${TRAVEL_MIN[pool][g]} travel (supply ${supply.length}, ${supply.filter((c) => c.travel).length} travel)`);
    }
  }
  if (poolCount[pool].total < POOL_TARGET[pool]) {
    shortfall.push(`${pool} pool: ${poolCount[pool].total}/${POOL_TARGET[pool]} exercises (supply ${deduped.filter((c) => c.pool === pool).length})`);
  }
}

let library = [...chosen.values()];

/* Stable, readable order: pool, then group, then name. */
const POOL_ORDER = { stretch: 0, strength: 1, sweat: 2 };
library.sort((a, b) => POOL_ORDER[a.pool] - POOL_ORDER[b.pool] || (a.groups[0] < b.groups[0] ? -1 : a.groups[0] > b.groups[0] ? 1 : 0) || (a.name < b.name ? -1 : 1));

/* ids */
const seenId = new Set();
for (const c of library) {
  let id = slug(c.name).slice(0, 44).replace(/-$/, '');
  if (!id) id = 'ex';
  let n = 2, base = id;
  while (seenId.has(id)) id = `${base}-${n++}`;
  seenId.add(id);
  c.id = id;
}

/* ---------- carry the hand-authored pose loops across ---------- */

const preamble = POSE_SRC.slice(0, POSE_SRC.indexOf('  /* ---------- library ---------- */'));

const usedArch = [...new Set(library.map((c) => c.arch))].sort();
const missingArch = usedArch.filter((a) => !loops.has(a));
if (missingArch.length) {
  console.error('archetypes with no source loop: ' + missingArch.join(', '));
  process.exit(1);
}

/* ---------- emit ---------- */

function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

const header = `/* 3S — exercise library.
 *
 * GENERATED by tools/build-library.js from the ExerciseAnimatic catalogue. Do not
 * hand-edit: rerun the generator instead, or the next run will overwrite the edit.
 *
 * Every entry is backed by a purchased clip, which is the primary representation.
 * The drawn figure remains the fallback for any exercise whose clip is missing,
 * still loading, or fails to decode — so each entry adopts the closest of the
 * hand-authored pose loops in ARCH below. Those loops are the old library's
 * surviving work and are still tuned by hand.
 *
 *   id      unique slug
 *   name    display name, cleaned of the vendor's delivery tags
 *   pool    'stretch' | 'strength' | 'sweat'   (their folder tree)
 *   groups  slots it can fill in a workout template
 *   equip   [] means anywhere; otherwise every token must be available
 *   tier    1 easiest .. 3 hardest (used for gradual progression)
 *   cue     one short coaching line shown under the name
 *   arch    which pose loop the fallback figure animates
 *   cycle   seconds for one full rep loop (from the archetype unless overridden)
 *   dose    stretch only: target seconds (40 ballistic, 48 flow, 56 held)
 *   frames  resolved from \`arch\`; the player and the tests read this
 */
`;

const archLines = usedArch.map((a) => {
  const l = loops.get(a);
  const extra = (l.alt ? ', alt: true' : '') + (l.props ? `, props: ${l.props}` : '');
  return `    '${a}': { cycle: ${l.cycle}${extra}, frames: ${l.frames} }`;
});

const exLines = library.map((c) => {
  const parts = [
    `id: '${esc(c.id)}'`,
    `name: '${esc(c.name)}'`,
    `pool: '${c.pool}'`,
    `groups: [${c.groups.map((g) => `'${g}'`).join(', ')}]`,
    `equip: [${c.equip.map((e) => `'${e}'`).join(', ')}]`,
    `tier: ${c.tier}`,
    `arch: '${c.arch}'`,
    `cue: '${esc(c.cue)}'`,
  ];
  if (c.dose) parts.push(`dose: ${c.dose}`);
  return `    { ${parts.join(', ')} }`;
});

const out = header + preamble + `  /* ---------- pose loops the fallback figure animates ---------- */

  var ARCH = {
${archLines.join(',\n')}
  };

  /* ---------- library ---------- */

  var RAW = [
${exLines.join(',\n')}
  ];

  /* Resolve each entry's archetype into the fields the player and tools read.
   * An entry may override cycle, alt, or props; otherwise it inherits them. */
  var EX = RAW.map(function (e) {
    var a = ARCH[e.arch] || ARCH['squat'];
    if (!e.frames) e.frames = a.frames;
    if (e.cycle == null) e.cycle = a.cycle;
    if (e.alt == null && a.alt) e.alt = true;
    if (!e.props && a.props) e.props = a.props;
    return e;
  });

  var BY_ID = {};
  for (var i = 0; i < EX.length; i++) BY_ID[EX[i].id] = EX[i];

  global.S3 = global.S3 || {};
  global.S3.exercises = { all: EX, byId: BY_ID, poses: { STAND: STAND }, arch: ARCH };
})(window);
`;

/* ---------- clip mapping and download list ---------- */

const clips = {};
for (const c of library) {
  clips[c.id] = {
    file: `${c.src.folder}/${c.src.file}`,
    tree: c.src.tree === 'green' ? '1200+ GREEN SCREEN VIDEOS' : 'HD 720p LOWEST FILE SIZE',
    fit: c.src.tree === 'green' ? 'alpha' : 'card',
  };
}

const dl = [
  '# Exact clips to pull from the ExerciseAnimatic bundle for the generated library.',
  `# ${library.length} files. Green-screen versions are preferred (they key onto the`,
  '# dark theme); the rest come from HD 720p LOWEST FILE SIZE and get a card panel.',
  `# Generated by tools/build-library.js.`,
  '',
];
for (const tree of ['1200+ GREEN SCREEN VIDEOS', 'HD 720p LOWEST FILE SIZE']) {
  const rows = library.filter((c) => clips[c.id].tree === tree);
  dl.push(`## ${tree}  (${rows.length})`);
  rows.forEach((c) => dl.push(`${clips[c.id].file}\t${c.id}`));
  dl.push('');
}

/* ---------- report ---------- */

const rep = [];
const R = (s) => rep.push(s);
R('# Exercise library rebuild — coverage report');
R('');
R(`Generated by \`tools/build-library.js --cast ${CAST}\` from ${catalogue.counts.files} catalogue clips.`);
R('');
R('## Funnel');
R('');
R('| Stage | Count |');
R('|---|---|');
R(`| Clips delivered (HD 720p tree) | ${catalogue.counts.files} |`);
R(`| Dropped — other cast (\`--cast ${CAST}\`) | ${dropped.gender} |`);
R(`| Dropped — equipment we do not model | ${dropped.equip} |`);
R(`| Dropped — contact-sheet review | ${dropped.review} |`);
R(`| Candidates | ${candidates.length} |`);
R(`| After de-duplicating variants | ${deduped.length} |`);
R(`| **Curated library** | **${library.length}** |`);
R('');
R('## Pools');
R('');
R('| Pool | Exercises | Target | Travel-capable | Green-screen clip |');
R('|---|---|---|---|---|');
for (const p of ['stretch', 'strength', 'sweat']) {
  const l = library.filter((c) => c.pool === p);
  R(`| ${p} | ${l.length} | ${POOL_TARGET[p]} | ${l.filter((c) => c.travel).length} | ${l.filter((c) => c.green).length} |`);
}
R(`| **total** | **${library.length}** | **${Object.values(POOL_TARGET).reduce((a, b) => a + b, 0)}** | **${library.filter((c) => c.travel).length}** | **${library.filter((c) => c.green).length}** |`);
R('');
if (CAST === 'mixed') {
  const m = library.filter((c) => c.cast === 'male').length;
  R(`Cast: ${library.length - m} female, ${m} male, interleaved — the model changes between exercises inside a session.`);
} else if (CAST === 'by-pool') {
  R('Cast per pool:');
  R('');
  for (const p of ['stretch', 'strength', 'sweat']) {
    const l = library.filter((c) => c.pool === p);
    const f = l.filter((c) => c.cast === 'female').length;
    if (CAST_BY_POOL[p] === 'mixed') {
      R(`- ${p}: mixed — ${f} female, ${l.length - f} male (the model can change between exercises)`);
    } else {
      const bad = l.filter((c) => c.cast !== CAST_BY_POOL[p]).length;
      R(`- ${p}: ${CAST_BY_POOL[p]}${bad ? ` — ${bad} from the other cast, investigate` : ' throughout'}`);
    }
  }
} else {
  R(`Cast: ${CAST} throughout.`);
}
R('');
R('## Groups — supply against what the templates demand');
R('');
R('| Pool · group | Exercises | Target | Travel | Travel floor | |');
R('|---|---|---|---|---|---|');
for (const pool of ['stretch', 'strength', 'sweat']) {
  for (const g of Object.keys(QUOTA[pool])) {
    const k = pool + ':' + g;
    const have = counts[k] || { total: 0, travel: 0 };
    const ok = have.total >= QUOTA[pool][g] && have.travel >= TRAVEL_MIN[pool][g];
    R(`| ${pool} · ${g} | ${have.total} | ${QUOTA[pool][g]} | ${have.travel} | ${TRAVEL_MIN[pool][g]} | ${ok ? 'ok' : '**short**'} |`);
  }
}
R('');
R('## Equipment mix');
R('');
const eqTally = {};
for (const c of library) {
  const k = c.equip.length ? c.equip.join('+') : 'bodyweight';
  eqTally[k] = (eqTally[k] || 0) + 1;
}
R('| Equipment | Exercises |');
R('|---|---|');
Object.entries(eqTally).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => R(`| ${k} | ${v} |`));
R('');
R('## Fallback figure');
R('');
const exact = library.filter((c) => c.archExact).length;
R(`${exact} of ${library.length} exercises (${Math.round(exact * 100 / library.length)}%) matched a pose loop by name;`);
R(`the remaining ${library.length - exact} fall back to their group's default loop.`);
R(`${usedArch.length} of the 117 hand-authored loops are in use.`);
R('');
if (shortfall.length) {
  R('## Shortfalls');
  R('');
  shortfall.forEach((s) => R(`- ${s}`));
  R('');
}
R('## Equipment signals that disagreed');
R('');
R(`${conflicts.length} clips had a filename that contradicted the spreadsheet. The`);
R('filename won, since it describes the clip that will be on screen. Spot-check these:');
R('');
conflicts.slice(0, 40).forEach((c) => R(`- ${c}`));
if (conflicts.length > 40) R(`- …and ${conflicts.length - 40} more`);
R('');

if (DRY) {
  console.log(rep.join('\n'));
  console.log('\n(dry run — nothing written)');
} else {
  fs.writeFileSync(path.join(root, 'js', 'exercises.js'), out);
  fs.writeFileSync(path.join(__dirname, 'catalogues', 'clips.json'), JSON.stringify(clips, null, 1));
  fs.writeFileSync(path.join(__dirname, 'download-list.txt'), dl.join('\n'));
  fs.writeFileSync(path.join(__dirname, 'catalogues', 'coverage.md'), rep.join('\n'));
  console.log(`js/exercises.js            ${library.length} exercises`);
  console.log(`tools/catalogues/clips.json ${Object.keys(clips).length} clip mappings`);
  console.log(`tools/download-list.txt     ${library.length} files to pull`);
  console.log(`tools/catalogues/coverage.md report`);
  if (shortfall.length) {
    console.log('\nSHORTFALLS:');
    shortfall.forEach((s) => console.log('  ' + s));
  }
}
