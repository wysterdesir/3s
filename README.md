# 3S — Stretch · Strength · Sweat

A follow-along, 60-minute workout for a phone, split into three 20-minute
sessions. Prop the phone up, tap Start, and follow it. No reading, no counting,
no deciding what comes next.

**Live:** https://wysterdesir.github.io/3s

Add it to your home screen (iOS: Share → Add to Home Screen) and it runs
full-screen and offline like a native app.

---

## How it works

| Session | 20 min | Focus |
|---|---|---|
| **Stretch** | Continuous flow, no rest | Mobility, flexibility, range of motion |
| **Strength** | Circuits, work/rest intervals | Muscle, resistance, structure |
| **Sweat** | Intervals, full impact | Cardio, endurance, conditioning |

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

In testing, six consecutive workouts touch 93 of the 93 exercises available at
Home, and 97 of 98 at a gym.

---

## The animation engine

There are no GIFs or videos. Every exercise is a handful of keyframed body poses
in `js/exercises.js`, and `js/rig.js` interpolates between them with inverse
kinematics keeping hands and feet planted where they belong. That means:

- The whole app is about 100 KB and works offline.
- A new exercise is roughly six lines of data, not a video shoot.

A pose sets where the hips are, the torso and head angle, and IK targets for the
hands and feet. Angles are degrees with `90` = straight up; the coordinate space
is a 240×200 box with the ground at `y=178`.

### Adding an exercise

Append to the `EX` array in `js/exercises.js`:

```js
{ id: 'squat', name: 'Bodyweight Squat', pool: 'strength', groups: ['legs'],
  equip: [], tier: 1, cue: 'Chest up, sit back, knees track out', cycle: 3,
  frames: [P(STAND, HANDS_CLASP), SQUAT_LOW] }
```

`frames` is a **closed loop** — the last frame interpolates back to the first, so
`[stand, bottom]` gives you a full rep down and up for free. `equip: []` means it
works anywhere; anything listed (`dumbbell`, `barbell`, `bar`, `bench`, `band`,
`wall`, `chair`) restricts it to locations that have it. `groups` are the slots a
template can drop it into:

- **stretch** — `spine`, `shoulders`, `hips`, `hams`, `ankles`, `core`, `full`
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

Verify the generator after any change to the exercise or template data — it
checks that every template at every location and level produces a timeline
summing to exactly 20:00, that no session hands you equipment you don't have,
and that the variety engine still spreads across the library:

```bash
node tools/test-generator.js
```

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
