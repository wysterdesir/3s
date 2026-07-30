# The exercise library is generated from the ExerciseAnimatic catalogue

**Status: done.** `js/exercises.js` is generated. Rerun with:

```bash
py tools/extract-catalogue.py && node tools/build-library.js
```

## Why we inverted

We were matching our 119 hand-authored exercises against their 2,536-name
catalogue and stalling at 53% coverage — while producing *wrong* matches, e.g.
"wide push ups bodyweight" pairing with our plain `pushup`. Matching is the wrong
direction. Letting the catalogue define the exercises makes coverage 100% by
construction, with no matching step to get wrong.

## What it produces

300 exercises, every one backed by a specific purchased clip.

| Pool | Exercises | Travel-capable | Green-screen clip |
|---|---|---|---|
| Stretch | 90 | 85 | 90 |
| Strength | 140 | 69 | 131 |
| Sweat | 70 | 60 | 30 |
| **Total** | **300** | **214** | **251** |

Full detail, regenerated on every run, in
[`tools/catalogues/coverage.md`](../tools/catalogues/coverage.md).

## The pipeline

1. `tools/extract-catalogue.py` joins the delivered folder tree to
   `1500+ exercise data.xlsx` into `tools/catalogues/catalogue.json`. Run it on a
   machine with the bundle mounted; nothing downstream touches Dropbox. The join
   lands 2,567 of 2,571 files, though individual columns are only 56–65% filled.
2. `tools/build-library.js` classifies, de-duplicates, curates, and emits
   `js/exercises.js`, `tools/catalogues/clips.json`, `tools/download-list.txt`,
   and `tools/catalogues/coverage.md`.

## Decisions worth remembering

**The folder tree is the classifier, with one exception.**
`Calisthenics-Cardio-Plyo-Functional` is four things in one folder, and its
calisthenics half is bodyweight *strength*. Routing the whole folder to Sweat
left Home and Travel with no bodyweight push or shoulder move, so it is split by
movement: explosive and locomotive stays in Sweat, the rest reads as Strength.
Unloaded joint work filed under a muscle — arm circles, leg swings, ankle
dorsiflexion — is warm-up, and moves the other way into Stretch.

**Cast is chosen per pool.** The vendor shot most exercises twice and their
green-screen coverage is lopsided: the female clips are 97% green-screen but her
Calisthenics folder is too thin to fill Sweat, and she has no plain push-up at
all. A workout is three separate 20-minute sessions, so the model only has to
hold still within a pool:

| Pool | Cast | Why |
|---|---|---|
| Stretch | female | Her mobility and yoga clips are almost entirely green-screen |
| Strength | mixed | Female wherever she has a clip; male for the bodyweight staples she lacks |
| Sweat | male | Her Calisthenics folder cannot fill the pool |

Change it with `--cast male|female|mixed|by-pool` or
`--pools strength=male`, then rerun. `--dry-run` prints the report without
writing anything.

**Green-screen outweighs everything in the scoring.** The two batches are
documented unevenly — clips that have a green-screen version carry coaching tips
and muscle data only 31% of the time, against 96% for the rest. A modest bonus
therefore lost every tie and filled the library with clips needing a light card
panel. A missing cue has a good hand-written fallback; a card panel on a dark
screen is visible for the whole interval.

**Equipment is cross-checked from two signals.** The filename wins over the
spreadsheet, because it describes the clip that will be on screen. Only the seven
implements the app models are kept — dumbbell, barbell, bar, bench, band, wall,
chair — and 589 clips naming anything else (cables, machines, kettlebells,
ergometers, foam rollers, yoga blocks) are dropped rather than mislabelled, since
the Gym / Home / Travel picker is only as honest as this field.

Match the *cleaned* name, not the raw filename: `_` is a word character, so in
`pistol squat to box_female` the pattern `\bbox\b` never fires, and every
equipment keyword that happened to sit last in a filename was silently missed.

**The drawn figure is still the fallback.** Generated exercises have no bespoke
poses, so each adopts the closest of the 117 hand-authored loops, carried into
`js/exercises.js` as the `ARCH` table. 223 of 300 match a loop by name; the rest
take their group's default. All 300 resolve to finite geometry and animate.

Stretch entries only ever match stretch loops — otherwise a biceps *stretch*
borrows the dumbbell-curl animation.

**The generator must not read its own output.** Pose loops come from
`tools/catalogues/pose-loops.js`, a snapshot of the last hand-authored library.
Reading `js/exercises.js` would make the second run eat the first run's output.
Tune a pose by editing the snapshot.

**`clips.json` retires name matching.** It records the exact source file behind
every exercise, and `tools/transcode.js` looks the path up instead of guessing.
Two bugs this closed: the transcoder was passed a path *including* the filename
and took its basename as the folder, so the index never matched once and
everything fell through to name matching — which is how `ab-crunches` ended up
pointed at a dumbbell clip. A name match may no longer override a recorded
source, and `mapping.json` is empty because its entries all named hand-authored
ids that no longer exist.

## What did not change

Validated in a real hour-long workout; left alone:

- The 3S structure and 20-minute sessions
- Stretch dosing (40 ballistic / 48 flow / 56 held) and the 5s change-position gaps
- Strength 40/30 circuits and the Sweat interval structures
- Session templates and the three-layer variety engine
- The Gym / Home / Travel picker
- The player: ring, countdown, voice cues, pause, transitions

## Still to do

1. Download the 300 files in `tools/download-list.txt` from the bundle.
2. `node tools/transcode.js <bundle> --dry-run` to confirm the mapping, then
   without the flag to encode.
3. Upload to R2 and flip `CONFIG.enabled` in `js/media.js`.
4. **Verification contact sheet** — the first frame of each clip beside the name
   assigned to it. Name matching produced plausible wrong answers before; only
   looking at the content catches that.

Until step 3 lands, every exercise falls back to the drawn figure, which is an
approximation of the real movement rather than the movement itself. Worth
weighing before deploying the generated library to the live site.
