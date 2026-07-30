# Rebuilding the exercise library from the ExerciseAnimatic catalogue

**Status: agreed, not started.** Pick this up with "rebuild the exercise library
from the ExerciseAnimatic catalogue".

## Why we inverted

We were matching our 119 hand-authored exercises against their 2,536-name
catalogue and stalling at 53% coverage — while producing *wrong* matches, e.g.
"wide push ups bodyweight" pairing with our plain `pushup`. Matching is the wrong
direction. Let the catalogue define the exercises and coverage becomes 100% by
construction, with no matching step to get wrong.

## Target

**~300 curated exercises**, every one backed by a real clip. Not all 2,010
distinct entries: the catalogue is full of near-duplicates ("Barbell squat back
POV", "barbell squat with 2 sec hold") and machine work irrelevant to Home and
Travel. Curate for coverage of every group slot at every location.

Suggested split, to be adjusted once the generator reports real supply:

| Pool | Target | Available |
|---|---|---|
| Stretch | ~90 | 320 |
| Strength | ~140 | 1,903 |
| Sweat | ~70 | 348 |

## The classification is already done — it's their folder tree

Source of truth is `HD 720p LOWEST FILE SIZE/` (2,571 files, smallest download,
plenty since we downscale to 480x480). Prefer the green-screen version of any
exercise where one exists — it keys onto the dark theme.

| Their folder | Our pool | Our group |
|---|---|---|
| `Stretching - Mobility` (188) | stretch | by movement — see dosing below |
| `Yoga` (132) | stretch | |
| `Calisthenics-Cardio-Plyo-Functional` (348) | sweat | impact / floor / low / upper |
| `Chest` (186) | strength | push |
| `Back` (240) | strength | pull |
| `Shoulders` (314) | strength | shoulders |
| `Biceps` (156), `Triceps` (104), `Forearms` (28) | strength | arms |
| `Legs` (572) | strength | legs / hinge |
| `Abdominals` (261) | strength | core |
| `Powerlifting` (42) | strength | legs / hinge / push / pull |

## Equipment — two signals, cross-checked

The location picker (Gym / Home / Travel) depends on this, so it needs care.

1. **Spreadsheet** `1500+ exercise data.xlsx`, `Equipment` column — 63% filled.
   `None` (401) and `None (Bodyweight)` (68) mean bodyweight. Others name the kit
   directly (Dumbbells 322, Barbell 209, Resistance Band 121, Pull Up Bar 15…).
2. **Filename inference** — 951 of 2,571 filenames contain no equipment keyword
   at all, which is a strong bodyweight signal. Keywords seen: barbell, dumbbell,
   kettlebell, cable, machine, band, smith, exercise ball, sled, tyre, rope,
   bench, ez bar, plate, medicine, bosu, trx, suspension, landmine, rebounder,
   airbike, elliptical, ergometer, treadmill, wheel.

Where the two agree, take it. Where the spreadsheet is blank, use the filename.
Where they conflict, prefer the filename (it describes the actual clip) and flag
it for spot-checking.

Travel and Home must end up with enough bodyweight exercises to fill every
template slot — `tools/test-generator.js` already fails the build if a template
demands more of a group than the pool can supply, so it will catch this.

## What does NOT change

Validated in a real hour-long workout; leave it alone:

- The 3S structure and 20-minute sessions
- Stretch dosing (40 ballistic / 48 flow / 56 held, landing ~45s) and the 5s
  change-position gaps
- Strength 40/30 circuits and the Sweat interval structures
- Session templates and the three-layer variety engine
- The Gym / Home / Travel picker
- The player: ring, countdown, voice cues, pause, transitions
- The drawn figure — it stays as the per-exercise fallback

Only `js/exercises.js` changes: hand-authored becomes generated.

## Fields to generate

Their data covers most of our schema:

| Our field | Source |
|---|---|
| `id` | slug of their name, deduped |
| `name` | their name, cleaned (strip `_Male`/`_Female`, trailing spaces, "POV") |
| `pool` | folder → table above |
| `groups` | folder + `Primary Activating Muscles` (67% filled) |
| `equip` | two signals above |
| `cue` | their `Exercise Tips` / first line of `Exercise Instructions` (67%) |
| `tier` | infer: bodyweight+static = 1, loaded/compound = 2, plyometric/skill = 3 |
| `dose` | **not in their data** — assign by movement type, keep our research values |
| `frames` | none; clip-backed exercises don't need poses |

## Order of work

1. Generator: catalogue + folder tree → candidate library with all fields.
2. Dedupe near-identical variants (same core name, differing only by "POV",
   "2 sec hold", camera angle).
3. Curate to ~300, checking supply per pool × group × location.
4. Emit the new `js/exercises.js` **and** the exact download list.
5. Run `tools/test-generator.js` — it already enforces exact 20:00 timelines,
   equipment correctness, no back-to-back repeats, and stretch dose bounds.
6. **Report coverage for review BEFORE any download or transcode.**
7. Then: download → `tools/transcode.js` → upload to R2 → flip `CONFIG.enabled`.
8. Verification contact sheet — first frame of each clip beside the name we
   assigned it. Name matching produced plausible wrong answers before; only
   looking at the content catches that.

## Things to watch

- Their names are inconsistent and sometimes untidy; the display name needs a
  cleanup pass or the app will show "Barbell squat back POV".
- A few current exercises may have no equivalent and would be dropped. Ask before
  discarding; the drawn-figure version can be kept for favourites.
- `Categories` is only 59% filled — prefer the folder, which is 100% reliable.
- Male and female versions exist for many exercises; pick one consistently
  (`--female` flag exists in the transcoder) or the app will switch models
  mid-session.
