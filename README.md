# 3S — Stretch · Strength · Sweat

A follow-along, 60-minute workout for a phone, split into three 20-minute
sessions. Prop the phone up, tap Start, and follow it. No reading, no counting,
no deciding what comes next.

**Live:** https://wysterdesir.github.io/3s

Add it to your home screen (iOS: Share → Add to Home Screen) and it runs
full-screen and offline like a native app.

---

## How it works

| Session | 20 min | Per move | Focus |
|---|---|---|---|
| **Stretch** | 24 moves, continuous flow with 5s gaps | 37–55s by exercise | Mobility, flexibility, range of motion |
| **Strength** | 15–16 moves in circuits | 40s work / 30s rest | Muscle, resistance, structure |
| **Sweat** | 18–32 intervals, full impact | 20–50s work / 15–20s rest | Cardio, endurance, conditioning |

### Where the timings come from

Strength and Sweat use conventional protocols: 40s work with 20s rest is a
standard circuit interval, the 20/10 blocks are the published Tabata structure,
and the ladders and pyramids are ordinary conditioning practice.

Stretch is dosed per exercise rather than one-size-fits-all, because a ballistic
move and a held position don't want the same time. Each exercise declares a
`dose` and the generator honours it:

| `dose` | Lands at | Kind of move |
|---|---|---|
| 40 | ~37–39s | Ballistic and rhythmic — leg swings, arm circles, calf bounces |
| 48 | ~45–47s | Flows — cat-cow, down dog to cobra, inchworm, 90-90 switch |
| 56 | ~53–55s | Held positions — deep squat, pigeon, seated fold, child's pose |

Those land where the literature does: dynamic-stretching studies typically use
around 30s per exercise, ACSM prescribes 10–30s for static holds, and holds
beyond 60s per muscle-tendon unit can blunt the performance that follows — so
nothing is allowed past 60s. Side-switching exercises halve again, putting each
side in the 18–28s range. `tools/test-generator.js` enforces the 30–60s band, so
a new exercise can't quietly reintroduce a 90-second hold.

The exact numbers shift a few seconds per session because the generator
normalises every timeline to land on exactly 20:00.

At the start of every workout it asks **where you are** — Gym, Home, or Travel —
and builds the Strength session around what you can actually reach for. Gym gets
barbell, dumbbell, bench, and pull-up bar work; Travel is bodyweight only. Home
sits in between, with toggles for whatever you own.

**During a session:** an animated figure demonstrates the move, a ring around it
drains as the current exercise runs out, and the big number counts the session
down to zero. Names are spoken aloud and three ticks sound before every change,
so you never have to look at the screen. During rest it previews the *next* move
so you learn it before you do it.

**Pausing:** tap anywhere on the screen, or the pause button in the corner. The
overlay gives you Resume, Skip move, Previous, sound toggle, and End workout. The
clock stops dead until you resume.

**Levels:** work intervals start at 40 seconds and stretch to 45 then 50 as you
log Strength sessions (6 to reach level 2, 12 for level 3). Level 2 also unlocks
the harder variations — burpees, pull-ups, tuck jumps, thrusters.

---

## Never the same workout twice

Variety is stacked three deep, so consecutive workouts don't repeat:

1. **Templates rotate.** Each session type has 6–7 structures (Push · Pull ·
   Legs, Tabata Blocks, Descending Ladder, Ground Flow, …) that advance with your
   workout count and never fire back to back.
2. **Exercises are least-recently-used first.** The app tracks how often you've
   done each move and reaches for the freshest ones.
3. **A seeded shuffle** picks among the freshest candidates, so it isn't a rigid
   cycle either.

In testing, six consecutive workouts touch 184 of the 213 exercises available on
the road and 223 of 300 at a gym.

---

## The animation engine

Each exercise shows a licensed video clip where one is available and a drawn
figure otherwise — `js/stage.js` picks per exercise, so the two coexist while
clips are still being added, and a clip that fails to decode falls back rather
than leaving a blank box.

The drawn figure is keyframed body poses interpolated by `js/rig.js`, with
inverse kinematics keeping hands and feet planted where they belong. That means:

- The app works offline and stays small when no clips are hosted.
- A pose loop is roughly six lines of data, not a video shoot.

The library itself is now generated from the ExerciseAnimatic catalogue — see
[docs/LIBRARY-REBUILD.md](docs/LIBRARY-REBUILD.md). The 117 hand-authored pose
loops survive as the `ARCH` table in `js/exercises.js`: every generated exercise
adopts the closest one for its fallback.

A pose sets where the hips are, the torso and head angle, and IK targets for the
hands and feet. Angles are degrees with `90` = straight up, and the ground line
sits at `y=178`. Author in those coordinates; `rig.js` crops to a square viewBox
centred on the circle that encloses every pose, so the figure fills the ring.

### Adding an exercise

`js/exercises.js` is generated — edits to it are lost on the next
`node tools/build-library.js`. To add an exercise, adjust the generator's
classification and rerun it. Entries look like this:

```js
{ id: 'bodyweight-squat', name: 'Bodyweight Squat', pool: 'strength',
  groups: ['legs'], equip: [], tier: 1, arch: 'squat',
  cue: 'Chest up, sit back, knees track out' }
```

`arch` names the pose loop the fallback figure animates, drawn from the `ARCH`
table at the top of the file; `cycle`, `alt`, and `props` are inherited from it
unless the entry sets them. To tune a loop by hand, edit
`tools/catalogues/pose-loops.js` — the generator reads its poses from there, not
from its own output.

A loop's `frames` is **closed** — the last frame interpolates back to the first,
so `[stand, bottom]` gives a full rep down and up for free. `dose` (stretch only)
sets how long the move should run. `equip: []` means it
works anywhere; anything listed (`dumbbell`, `barbell`, `bar`, `bench`, `band`,
`wall`, `chair`) restricts it to locations that have it. `groups` are the slots a
template can drop it into:

- **stretch** — `spine`, `shoulders`, `hips`, `hams`, `ankles`
  (keep an eye on supply: a template asking for more slots of a group than the
  pool can fill forces a repeat, which `test-generator.js` fails on)
- **strength** — `push`, `pull`, `legs`, `hinge`, `core`, `shoulders`, `arms`, `carry`
- **sweat** — `impact`, `floor`, `low`, `upper`, `core`, `full`

Then check it in the browser — **Exercise library** on the home screen renders
every move animated in a grid, which is the fastest way to eyeball a new pose.

### Adding a workout structure

Append a template to `TEMPLATES` in `js/workouts.js`. `build()` returns ordered
slot specs; the generator resolves the groups and normalises the timeline to
exactly 20:00, so you don't need the durations to add up:

```js
{ name: 'Hinge & Press', build: function (c) {
    return rep(4, function () {
      return circuit(['hinge', 'shoulders', 'legs', 'pull'], c.work, c.rest, c.rest + 20);
    });
  } }
```

---

## Development

```bash
py -m http.server 8131 --directory 3s
```

Four checks, all runnable without opening a browser by hand. Run the first two
after any change to the exercise or template data:

```bash
node tools/test-generator.js
```

Covers every template at every location and level (3,267 sessions): each must
sum to exactly 20:00, never call for equipment you don't have, never exceed your
level, and the variety engine must still spread across the library.

```bash
node tools/test-wiring.js
```

Confirms every element id `app.js` reaches for exists in `index.html`, then runs
a full 20-minute session through the real player with a stubbed clock, checking
the cue counts, that pause actually freezes time, and that skip can't overshoot
the end.

```bash
node tools/shoot.js https://wysterdesir.github.io/3s/
```

Drives headless Chrome over the DevTools Protocol at real phone dimensions
(390×844): clicks through every screen, screenshots each into `tools/shots/`,
reports console errors, checks for horizontal overflow, verifies the figure is
actually animating, and runs the **ring-fit check** — it maps every joint of
every keyframe of all 300 exercises through the live screen transform and
confirms none escapes the progress ring. Run this after changing the figure
viewBox, `.figwrap`/`.ring` sizing, or adding poses that reach further than the
existing ones.

```bash
node tools/dump-poses.js && py tools/pose_sheet.py strength
```

Renders every pose in a pool to a contact-sheet PNG (first keyframe dim, last
bright, so one image shows the whole movement). This is the fastest way to spot
a pose authored wrong — it caught squats whose hips dropped without traveling
back, a wall on the wrong side of the figure, and limbs sagging through the
floor. Pass `stretch`, `strength`, or `sweat`; omit for the whole library.

Note `pose_sheet.py` hard-codes the viewBox to match `rig.js` — keep the two in
sync or the sheet lies about framing.

Regenerate the app icons after a branding change:

```bash
py tools/make_icons.py
```

### Files

| | |
|---|---|
| `js/rig.js` | Figure rig, inverse kinematics, SVG renderer, props |
| `js/exercises.js` | The exercise library — pure data |
| `js/workouts.js` | Session templates, variety engine, timeline solver |
| `js/player.js` | Timeline clock, audio cues, animation loop, wake lock |
| `js/app.js` | Screens, state, localStorage, progression |
| `sw.js` | Offline cache — **bump `CACHE` on every release** |

### Deploying

Pushing to `main` publishes. GitHub Pages serves the repo root directly, so
there's no build step and no Actions workflow to fail.

```bash
git add -A && git commit -m "Add new Sweat templates" && git push
```

Bump `CACHE` in `sw.js` when you change any shipped file, or returning visitors
keep the old cached copy.

---

## Notes

Everything is stored locally on the device — progress, level, streak, and
settings live in `localStorage`. There is no account, no server, and no
analytics. Clearing site data resets progress.

Screen wake-lock keeps the display on mid-workout where the browser supports it.
Switching apps or locking the phone auto-pauses the session, since the audio cues
can't reach you in the background.
