/* 3S — exercise library.
 *
 * Each exercise is data only. To add one, append an entry to EX below:
 *   id      unique slug
 *   name    display name
 *   pool    'stretch' | 'strength' | 'sweat'
 *   groups  slots it can fill in a workout template
 *   equip   [] means anywhere; otherwise every token must be available
 *   tier    1 easiest .. 3 hardest (used for gradual progression)
 *   cue     one short coaching line shown under the name
 *   cycle   seconds for one full rep loop
 *   frames  closed keyframe loop; last frame interpolates back to the first
 *   alt     true if the exercise switches sides halfway through the interval
 *   props   fixtures/implements drawn with the figure
 */
(function (global) {
  'use strict';

  function P() {
    var out = {}, i, k, o;
    for (i = 0; i < arguments.length; i++) {
      o = arguments[i];
      for (k in o) out[k] = o[k];
    }
    return out;
  }

  /* ---------- base poses ---------- */

  var STAND = { hip: [120, 118], torso: 90, footL: [112, 178], footR: [128, 178], handL: [112, 118], handR: [128, 118] };
  var NARROW = P(STAND, { hip: [120, 116], footL: [117, 178], footR: [123, 178] });
  var WIDE = P(STAND, { hip: [120, 124], footL: [96, 178], footR: [144, 178] });

  var ARMS_UP = { handL: [112, 34], handR: [128, 34] };
  var ARMS_SIDE = { handL: [86, 92], handR: [154, 92] };
  var ARMS_FWD = { handL: [156, 88], handR: [160, 92] };
  var HANDS_HIP = { handL: [107, 121], handR: [133, 121] };
  var HANDS_CLASP = { handL: [148, 128], handR: [152, 126] };

  /* Squats: the hip travels back as well as down, so the thigh reaches
   * horizontal with the shin vertical rather than the knee shooting forward. */
  var SQUAT_HALF = P(STAND, { hip: [110, 132], torso: 76, footL: [110, 178], footR: [130, 178], handL: [144, 108], handR: [148, 106] });
  var SQUAT_LOW = P(STAND, { hip: [104, 148], torso: 62, footL: [112, 178], footR: [130, 178], handL: [148, 124], handR: [152, 122] });
  var SQUAT_DEEP = P(STAND, { hip: [100, 158], torso: 56, footL: [108, 178], footR: [130, 178], handL: [140, 142], handR: [144, 140], arch: 5 });

  var HINGE_TOP = P(STAND, { hip: [118, 118], torso: 86, handL: [112, 128], handR: [128, 128] });
  var HINGE_LOW = P(STAND, {
    hip: [110, 124], torso: 16, arch: -4,
    footL: [110, 178], footR: [126, 178],
    handL: [146, 148], handR: [150, 146]
  });

  var BENT_OVER = P(STAND, {
    hip: [110, 124], torso: 20, arch: -4,
    footL: [110, 178], footR: [126, 178],
    handL: [148, 150], handR: [152, 152]
  });
  var ROW_PULL = P(BENT_OVER, { handL: [142, 128], handR: [146, 130], elbowL: 1, elbowR: 1 });

  var PLANK_HIGH = { hip: [123, 150], torso: 30, head: -18, footL: [77, 178], footR: [83, 178], handL: [158, 178], handR: [164, 178] };
  var PUSHUP_LOW = P(PLANK_HIGH, { hip: [123, 158], torso: 30 });
  var PLANK_FORE = { hip: [120, 152], torso: 24, head: -14, footL: [74, 178], footR: [80, 178], handL: [166, 178], handR: [172, 178], elbowL: 1, elbowR: 1 };
  var SIDE_PLANK = { hip: [120, 150], torso: 20, head: -12, footL: [74, 176], footR: [80, 178], handL: [148, 96], handR: [168, 178], elbowR: 1 };

  var TUCK = { hip: [116, 156], torso: 20, head: -12, footL: [106, 178], footR: [114, 178], handL: [156, 178], handR: [162, 178] };
  var JUMP_UP = { hip: [120, 102], torso: 92, footL: [113, 164], footR: [127, 162], handL: [110, 28], handR: [130, 28] };

  /* Lying on the back: shoulders and head rest on the ground, head to the right. */
  var LIE_BACK = { hip: [116, 170], torso: -6, head: 6, footL: [104, 178], footR: [110, 178], handL: [128, 176], handR: [132, 176], kneeL: -1, kneeR: -1 };
  var BRIDGE_UP = P(LIE_BACK, { hip: [122, 150], torso: -18, head: 18, footL: [84, 178], footR: [90, 178], handL: [140, 176], handR: [144, 176] });
  var BRIDGE_DOWN = P(LIE_BACK, { hip: [120, 170], torso: -6, head: 6, footL: [86, 178], footR: [92, 178], handL: [140, 176], handR: [144, 176] });

  var HANG = { hip: [120, 112], torso: 90, footL: [116, 172], footR: [124, 172], handL: [112, 26], handR: [128, 26] };
  var HANG_TOP = P(HANG, { hip: [120, 86], footL: [104, 138], footR: [110, 134], kneeL: -1, kneeR: -1 });

  var LUNGE_DOWN = { hip: [116, 142], torso: 87, footL: [84, 178], footR: [152, 178], handL: [106, 142], handR: [126, 142] };
  var LUNGE_SHALLOW = P(LUNGE_DOWN, { hip: [117, 128], footR: [148, 178], footL: [90, 178] });
  var LUNGE_BACK_DOWN = { hip: [118, 142], torso: 88, footL: [152, 178], footR: [86, 178], handL: [108, 142], handR: [128, 142] };

  var PRESS_RACK = P(STAND, { handL: [104, 86], handR: [136, 86], elbowL: -1, elbowR: -1 });
  var PRESS_TOP = P(STAND, ARMS_UP);

  var KNEE_R = P(NARROW, { footR: [138, 126], handR: [104, 104], handL: [138, 112], kneeR: 1 });
  var KNEE_L = P(NARROW, { footL: [138, 126], handL: [104, 104], handR: [138, 112], kneeL: 1 });

  var JJ_IN = P(NARROW, { handL: [108, 116], handR: [132, 116] });
  var JJ_OUT = P(STAND, { hip: [120, 126], footL: [92, 178], footR: [148, 178], handL: [92, 52], handR: [148, 52] });

  var QUAD_ALL4 = { hip: [104, 146], torso: 4, head: -4, footL: [78, 178], footR: [84, 178], handL: [150, 178], handR: [156, 178] };
  var CAT = P(QUAD_ALL4, { arch: 13, head: -32, hip: [104, 142] });
  var COW = P(QUAD_ALL4, { arch: -9, head: 20, hip: [104, 150] });

  var DOWN_DOG = { hip: [104, 118], torso: 2, head: -22, arch: -3, footL: [72, 178], footR: [78, 178], handL: [150, 178], handR: [156, 178] };
  var COBRA = { hip: [96, 172], torso: 34, head: 16, arch: -12, footL: [58, 176], footR: [64, 178], handL: [134, 178], handR: [140, 178], kneeL: -1, kneeR: -1 };
  var CHILD = { hip: [90, 164], torso: 8, head: -14, arch: 8, footL: [70, 178], footR: [76, 178], handL: [162, 178], handR: [168, 178] };

  var SEATED_FOLD = { hip: [104, 172], torso: 40, head: -18, arch: 6, footL: [162, 176], footR: [168, 178], handL: [156, 156], handR: [162, 158], kneeL: -1, kneeR: -1 };

  var BOX_GUARD = P(NARROW, { hip: [120, 122], torso: 86, footL: [104, 178], footR: [134, 178], handL: [138, 100], handR: [134, 108] });

  /* ---------- library ---------- */

  var EX = [

    /* ============ STRETCH — dynamic mobility ============ */

    { id: 'neck-rolls', name: 'Neck Rolls', pool: 'stretch', groups: ['spine', 'shoulders'], equip: [], tier: 1,
      cue: 'Slow half-circles, chin to chest', cycle: 5,
      frames: [P(STAND, HANDS_HIP, { head: -26 }), P(STAND, HANDS_HIP, { head: 4 }), P(STAND, HANDS_HIP, { head: -26, torso: 88 })] },

    { id: 'shoulder-rolls', name: 'Shoulder Rolls', pool: 'stretch', groups: ['shoulders'], equip: [], tier: 1,
      cue: 'Big circles back, chest opens', cycle: 3.4,
      frames: [P(STAND, { handL: [110, 120], handR: [130, 120] }), P(STAND, { handL: [108, 110], handR: [132, 110] }),
               P(STAND, { handL: [114, 108], handR: [126, 108], elbowL: 1, elbowR: 1 })] },

    { id: 'arm-circles', name: 'Arm Circles', pool: 'stretch', groups: ['shoulders'], equip: [], tier: 1,
      cue: 'Reach long, shoulders loose', cycle: 3.2,
      frames: [P(STAND, ARMS_SIDE), P(STAND, ARMS_UP), P(STAND, { handL: [96, 132], handR: [144, 132] })] },

    { id: 'arm-swings', name: 'Cross-Body Arm Swings', pool: 'stretch', groups: ['shoulders'], equip: [], tier: 1,
      cue: 'Wrap then open wide', cycle: 2.6,
      frames: [P(STAND, { handL: [148, 108], handR: [152, 116] }), P(STAND, { handL: [88, 100], handR: [154, 104] })] },

    { id: 'torso-twist', name: 'Standing Torso Twists', pool: 'stretch', groups: ['spine'], equip: [], tier: 1,
      cue: 'Hips stay square, let arms follow', cycle: 3,
      frames: [P(WIDE, { handL: [92, 104], handR: [146, 116] }), P(WIDE, { handL: [148, 112], handR: [154, 104] })] },

    { id: 'side-bend', name: 'Overhead Side Bends', pool: 'stretch', groups: ['spine'], equip: [], tier: 1, alt: true,
      cue: 'Reach over, feel the ribs open', cycle: 4,
      frames: [P(WIDE, { torso: 74, handL: [148, 52], handR: [154, 60], head: 8 }),
               P(WIDE, ARMS_UP), P(WIDE, { torso: 104, handL: [88, 56], handR: [96, 50], head: -8 })] },

    { id: 'cat-cow', name: 'Cat-Cow', pool: 'stretch', groups: ['spine'], equip: [], tier: 1,
      cue: 'Round up on exhale, open on inhale', cycle: 5,
      frames: [CAT, COW] },

    { id: 'thread-needle', name: 'Thread the Needle', pool: 'stretch', groups: ['spine', 'shoulders'], equip: [], tier: 1, alt: true,
      cue: 'Slide the arm through, drop the shoulder', cycle: 5,
      frames: [QUAD_ALL4, P(QUAD_ALL4, { torso: 14, handR: [104, 176], handL: [150, 178], head: -20, arch: 4 })] },

    { id: 'bird-dog', name: 'Bird Dog', pool: 'stretch', groups: ['spine', 'core'], equip: [], tier: 1, alt: true,
      cue: 'Long line, no wobble', cycle: 5,
      frames: [QUAD_ALL4, P(QUAD_ALL4, { footL: [46, 138], handR: [176, 132], arch: -4, head: 2 })] },

    { id: 'hip-circles', name: 'Standing Hip Circles', pool: 'stretch', groups: ['hips'], equip: [], tier: 1, alt: true,
      cue: 'Knee up, draw a big circle', cycle: 4.5,
      frames: [P(NARROW, HANDS_HIP, { footR: [140, 128] }), P(NARROW, HANDS_HIP, { footR: [152, 146], kneeR: 1 }),
               P(NARROW, HANDS_HIP, { footR: [126, 150] })] },

    { id: 'leg-swings-fb', name: 'Leg Swings — Front to Back', pool: 'stretch', groups: ['hips', 'hams'], equip: [], tier: 1, alt: true,
      cue: 'Relaxed pendulum, tall chest', cycle: 2.6,
      frames: [P(NARROW, HANDS_HIP, { footR: [166, 142] }), P(NARROW, HANDS_HIP, { footR: [92, 158], kneeR: -1 })] },

    { id: 'leg-swings-side', name: 'Leg Swings — Side to Side', pool: 'stretch', groups: ['hips'], equip: [], tier: 1, alt: true,
      cue: 'Sweep across the body and out', cycle: 2.8,
      frames: [P(NARROW, ARMS_SIDE, { footR: [96, 160] }), P(NARROW, ARMS_SIDE, { footR: [162, 156] })] },

    { id: 'knee-hugs', name: 'Walking Knee Hugs', pool: 'stretch', groups: ['hips'], equip: [], tier: 1,
      cue: 'Hug the knee in, stand tall', cycle: 3.6,
      frames: [P(NARROW, { footR: [136, 122], handR: [140, 128], handL: [134, 120] }), STAND,
               P(NARROW, { footL: [136, 122], handL: [140, 128], handR: [134, 120] })] },

    { id: 'quad-pull', name: 'Standing Quad Pull', pool: 'stretch', groups: ['hips'], equip: [], tier: 1, alt: true,
      cue: 'Heel to glute, knee points down', cycle: 4,
      frames: [P(NARROW, { footR: [98, 123], handR: [102, 132], handL: [124, 116], kneeR: 1 }),
               P(NARROW, { footR: [96, 118], handR: [100, 128], handL: [124, 116], kneeR: 1 })] },

    { id: 'hamstring-sweep', name: 'Hamstring Sweeps', pool: 'stretch', groups: ['hams'], equip: [], tier: 1,
      cue: 'Hinge back, sweep the floor', cycle: 4,
      frames: [HINGE_LOW, P(STAND, { handL: [110, 96], handR: [130, 96] })] },

    { id: 'inchworm', name: 'Inchworm', pool: 'stretch', groups: ['hams', 'full'], equip: [], tier: 2,
      cue: 'Walk the hands out, then back', cycle: 6,
      frames: [P(STAND, { handL: [110, 130], handR: [126, 130] }), HINGE_LOW, DOWN_DOG, PLANK_HIGH, DOWN_DOG] },

    { id: 'down-dog-cobra', name: 'Down Dog to Cobra', pool: 'stretch', groups: ['spine', 'shoulders', 'hams'], equip: [], tier: 2,
      cue: 'Press the hips up, then open the chest', cycle: 6,
      frames: [DOWN_DOG, PLANK_HIGH, COBRA, PLANK_HIGH] },

    { id: 'worlds-greatest', name: "World's Greatest Stretch", pool: 'stretch', groups: ['hips', 'spine'], equip: [], tier: 2, alt: true,
      cue: 'Deep lunge, then reach for the ceiling', cycle: 6,
      frames: [P(LUNGE_DOWN, { hip: [112, 150], handL: [138, 178], handR: [144, 178], torso: 62, head: -14 }),
               P(LUNGE_DOWN, { hip: [112, 150], torso: 74, handL: [140, 178], handR: [128, 78], head: 12 })] },

    { id: 'lunge-reach', name: 'Lunge with Overhead Reach', pool: 'stretch', groups: ['hips'], equip: [], tier: 1, alt: true,
      cue: 'Sink the hips, reach tall', cycle: 5,
      frames: [P(LUNGE_DOWN, { handL: [112, 40], handR: [126, 38], torso: 92 }), P(STAND, ARMS_UP)] },

    { id: 'frog-rocks', name: 'Frog Rocks', pool: 'stretch', groups: ['hips'], equip: [], tier: 2,
      cue: 'Rock back into the hips, easy breath', cycle: 4.5,
      frames: [P(QUAD_ALL4, { hip: [110, 150], footL: [72, 178], footR: [80, 178] }),
               P(QUAD_ALL4, { hip: [88, 156], footL: [62, 178], footR: [70, 178], arch: 5, head: -10 })] },

    { id: 'deep-squat-hold', name: 'Deep Squat Hold', pool: 'stretch', groups: ['hips', 'ankles'], equip: [], tier: 2,
      cue: 'Elbows inside the knees, pry them open', cycle: 5,
      frames: [SQUAT_DEEP, P(SQUAT_DEEP, { hip: [110, 152], torso: 66 })] },

    { id: 'glute-bridge-mob', name: 'Glute Bridge', pool: 'stretch', groups: ['hips', 'core'], equip: [], tier: 1,
      cue: 'Squeeze at the top, ribs down', cycle: 4,
      frames: [BRIDGE_DOWN, BRIDGE_UP] },

    { id: 'ankle-rocks', name: 'Ankle Rocks', pool: 'stretch', groups: ['ankles'], equip: [], tier: 1, alt: true,
      cue: 'Drive the knee forward, heel stays down', cycle: 3,
      frames: [P(LUNGE_SHALLOW, { hip: [114, 132], footR: [146, 178] }), P(LUNGE_SHALLOW, { hip: [122, 130], footR: [146, 178] })] },

    { id: 'calf-bounce', name: 'Calf Bounces', pool: 'stretch', groups: ['ankles'], equip: [], tier: 1,
      cue: 'Springy heels, stay light', cycle: 1.4,
      frames: [P(NARROW, HANDS_HIP), P(NARROW, HANDS_HIP, { hip: [120, 106], footL: [117, 174], footR: [123, 174] })] },

    { id: 'wall-angels', name: 'Wall Angels', pool: 'stretch', groups: ['shoulders'], equip: ['wall'], tier: 1, props: ['wall'],
      cue: 'Back flat to the wall, slide up slow', cycle: 5,
      frames: [P(STAND, { hip: [54, 118], footL: [50, 178], footR: [58, 178], handL: [74, 104], handR: [80, 100], elbowL: 1, elbowR: 1 }),
               P(STAND, { hip: [54, 118], footL: [50, 178], footR: [58, 178], handL: [62, 44], handR: [68, 42] })] },

    { id: 'seated-fold', name: 'Seated Forward Fold', pool: 'stretch', groups: ['hams', 'spine'], equip: [], tier: 1,
      cue: 'Long spine first, then fold', cycle: 5,
      frames: [P(SEATED_FOLD, { torso: 58, arch: 0, handL: [148, 140], handR: [154, 142] }), SEATED_FOLD] },

    { id: 'child-pose', name: "Child's Pose Reach", pool: 'stretch', groups: ['spine', 'shoulders'], equip: [], tier: 1,
      cue: 'Melt the chest down, breathe wide', cycle: 5,
      frames: [CHILD, P(CHILD, { hip: [92, 160], arch: 5 })] },

    { id: 'scap-pushup', name: 'Scapular Push-Ups', pool: 'stretch', groups: ['shoulders'], equip: [], tier: 2,
      cue: 'Arms stay straight — only the shoulders move', cycle: 3,
      frames: [P(PLANK_HIGH, { arch: 6 }), P(PLANK_HIGH, { arch: -4, hip: [123, 152] })] },

    /* ============ STRENGTH — bodyweight, anywhere ============ */

    { id: 'squat', name: 'Bodyweight Squat', pool: 'strength', groups: ['legs'], equip: [], tier: 1,
      cue: 'Chest up, sit back, knees track out', cycle: 3,
      frames: [P(STAND, HANDS_CLASP), SQUAT_LOW] },

    { id: 'squat-pulse', name: 'Squat Pulses', pool: 'strength', groups: ['legs'], equip: [], tier: 2,
      cue: 'Stay low, small drives out of the hole', cycle: 1.6,
      frames: [SQUAT_HALF, SQUAT_LOW] },

    { id: 'wall-sit', name: 'Wall Sit', pool: 'strength', groups: ['legs'], equip: ['wall'], tier: 1, props: ['wall'],
      cue: 'Thighs level, breathe through it', cycle: 5,
      frames: [P(STAND, { hip: [54, 147], torso: 90, footL: [80, 178], footR: [88, 178], handL: [76, 142], handR: [84, 142] }),
               P(STAND, { hip: [54, 149], torso: 90, footL: [80, 178], footR: [88, 178], handL: [76, 144], handR: [84, 144] })] },

    { id: 'reverse-lunge', name: 'Reverse Lunges', pool: 'strength', groups: ['legs'], equip: [], tier: 1, alt: true,
      cue: 'Step back, drop the knee, drive up', cycle: 3.2,
      frames: [P(STAND, HANDS_HIP), P(LUNGE_BACK_DOWN, HANDS_HIP)] },

    { id: 'split-squat', name: 'Split Squat', pool: 'strength', groups: ['legs'], equip: [], tier: 2, alt: true,
      cue: 'Straight up and down, front heel planted', cycle: 3,
      frames: [P(LUNGE_SHALLOW, HANDS_HIP), P(LUNGE_DOWN, HANDS_HIP)] },

    { id: 'step-up', name: 'Step-Ups', pool: 'strength', groups: ['legs'], equip: ['chair'], tier: 2, alt: true, props: ['chair'],
      cue: 'Full stand at the top, control down', cycle: 3.4,
      frames: [P(STAND, HANDS_HIP), P(STAND, HANDS_HIP, { hip: [138, 96], footR: [158, 140], footL: [126, 178] }),
               P(STAND, HANDS_HIP, { hip: [148, 84], footR: [160, 140], footL: [142, 152], kneeL: -1 })] },

    { id: 'good-morning', name: 'Hip Hinge / Good Morning', pool: 'strength', groups: ['hinge'], equip: [], tier: 1,
      cue: 'Push the hips back, flat back', cycle: 3.4,
      frames: [P(HINGE_TOP, { handL: [126, 96], handR: [130, 100], elbowL: 1, elbowR: 1 }),
               P(HINGE_LOW, { handL: [150, 122], handR: [154, 126], elbowL: 1, elbowR: 1 })] },

    { id: 'glute-bridge', name: 'Glute Bridge', pool: 'strength', groups: ['hinge', 'core'], equip: [], tier: 1,
      cue: 'Drive through the heels, squeeze hard', cycle: 3,
      frames: [BRIDGE_DOWN, BRIDGE_UP] },

    { id: 'sl-glute-bridge', name: 'Single-Leg Glute Bridge', pool: 'strength', groups: ['hinge'], equip: [], tier: 2, alt: true,
      cue: 'One foot down, hips stay level', cycle: 3.2,
      frames: [P(BRIDGE_DOWN, { footL: [66, 148], kneeL: -1 }), P(BRIDGE_UP, { footL: [70, 128], kneeL: -1 })] },

    { id: 'pushup', name: 'Push-Up', pool: 'strength', groups: ['push'], equip: [], tier: 2,
      cue: 'One straight line, elbows back not out', cycle: 3,
      frames: [PLANK_HIGH, PUSHUP_LOW] },

    { id: 'pushup-incline', name: 'Incline Push-Up', pool: 'strength', groups: ['push'], equip: ['chair'], tier: 1, props: ['chair'],
      cue: 'Hands on the seat, body still straight', cycle: 3,
      frames: [P(PLANK_HIGH, { hip: [116, 158], torso: 26, handL: [162, 140], handR: [168, 140], footL: [66, 178], footR: [72, 178] }),
               P(PLANK_HIGH, { hip: [116, 164], torso: 26, handL: [162, 140], handR: [168, 140], footL: [66, 178], footR: [72, 178] })] },

    { id: 'pushup-wide', name: 'Wide Push-Up', pool: 'strength', groups: ['push'], equip: [], tier: 2,
      cue: 'Hands wider, chest does the work', cycle: 3,
      frames: [P(PLANK_HIGH, { handL: [152, 178], handR: [170, 178] }), P(PUSHUP_LOW, { handL: [152, 178], handR: [170, 178] })] },

    { id: 'pike-pushup', name: 'Pike Push-Up', pool: 'strength', groups: ['push', 'shoulders'], equip: [], tier: 3,
      cue: 'Hips high, crown of the head to the floor', cycle: 3.2,
      frames: [DOWN_DOG, P(DOWN_DOG, { hip: [104, 124], handL: [150, 178], handR: [156, 178], head: -30, torso: -4 })] },

    { id: 'chair-dip', name: 'Chair Dips', pool: 'strength', groups: ['push', 'arms'], equip: ['chair'], tier: 2, props: ['chair'],
      cue: 'Elbows back, chest tall', cycle: 3,
      frames: [P(STAND, { hip: [140, 148], torso: 84, footL: [86, 178], footR: [94, 178], handL: [168, 140], handR: [174, 140], kneeL: 1, kneeR: 1, elbowL: -1, elbowR: -1 }),
               P(STAND, { hip: [138, 164], torso: 84, footL: [86, 178], footR: [94, 178], handL: [168, 140], handR: [174, 140], kneeL: 1, kneeR: 1, elbowL: -1, elbowR: -1 })] },

    { id: 'plank', name: 'Plank', pool: 'strength', groups: ['core'], equip: [], tier: 1,
      cue: 'Squeeze glutes, ribs down, breathe', cycle: 5,
      frames: [PLANK_FORE, P(PLANK_FORE, { hip: [120, 150] })] },

    { id: 'side-plank', name: 'Side Plank', pool: 'strength', groups: ['core'], equip: [], tier: 2, alt: true,
      cue: 'Stack the hips, push the floor away', cycle: 5,
      frames: [SIDE_PLANK, P(SIDE_PLANK, { hip: [120, 146] })] },

    { id: 'dead-bug', name: 'Dead Bug', pool: 'strength', groups: ['core'], equip: [], tier: 1, alt: true,
      cue: 'Low back glued down, move slow', cycle: 4,
      frames: [P(LIE_BACK, { footR: [147, 139], footL: [141, 146], handR: [156, 132], handL: [150, 136], kneeR: 1, kneeL: 1 }),
               P(LIE_BACK, { footR: [147, 139], footL: [62, 168], handR: [186, 152], handL: [150, 136], kneeR: 1, kneeL: -1 })] },

    { id: 'hollow-hold', name: 'Hollow Hold', pool: 'strength', groups: ['core'], equip: [], tier: 3,
      cue: 'Low back pressed flat, long body', cycle: 4.5,
      frames: [{ hip: [116, 168], torso: 6, head: -8, arch: 6, footL: [62, 150], footR: [68, 146], handL: [186, 142], handR: [192, 146] },
               { hip: [116, 170], torso: 4, head: -8, arch: 6, footL: [62, 156], footR: [68, 152], handL: [186, 148], handR: [192, 152] }] },

    { id: 'crunch-reach', name: 'Reaching Crunch', pool: 'strength', groups: ['core'], equip: [], tier: 1,
      cue: 'Curl the ribs toward the hips', cycle: 3,
      frames: [P(LIE_BACK, { footL: [86, 178], footR: [92, 178], handL: [150, 168], handR: [156, 170] }),
               P(LIE_BACK, { torso: 22, head: -10, arch: 8, footL: [86, 178], footR: [92, 178], handL: [172, 150], handR: [178, 152] })] },

    { id: 'superman', name: 'Superman', pool: 'strength', groups: ['core', 'pull'], equip: [], tier: 1,
      cue: 'Lift long, squeeze the back', cycle: 3.4,
      frames: [{ hip: [112, 176], torso: 4, head: 0, footL: [66, 178], footR: [72, 178], handL: [190, 176], handR: [196, 178] },
               { hip: [112, 174], torso: 8, head: 16, arch: -10, footL: [66, 164], footR: [72, 160], handL: [190, 152], handR: [196, 148] }] },

    { id: 'reverse-snow', name: 'Reverse Snow Angels', pool: 'strength', groups: ['pull', 'shoulders'], equip: [], tier: 1,
      cue: 'Face down, sweep the arms wide and back', cycle: 4,
      frames: [{ hip: [112, 176], torso: 4, head: 6, arch: -6, footL: [66, 178], footR: [72, 178], handL: [176, 158], handR: [182, 154] },
               { hip: [112, 176], torso: 4, head: 6, arch: -6, footL: [66, 178], footR: [72, 178], handL: [138, 166], handR: [144, 162], elbowL: 1, elbowR: 1 }] },

    { id: 'calf-raise', name: 'Calf Raises', pool: 'strength', groups: ['legs'], equip: [], tier: 1,
      cue: 'All the way up, slow all the way down', cycle: 2.4,
      frames: [P(NARROW, HANDS_HIP), P(NARROW, HANDS_HIP, { hip: [120, 104], footL: [117, 172], footR: [123, 172] })] },

    /* ============ STRENGTH — dumbbells ============ */

    { id: 'db-goblet-squat', name: 'Goblet Squat', pool: 'strength', groups: ['legs'], equip: ['dumbbell'], tier: 2, props: ['dumbbell'],
      cue: 'Weight at the chest, elbows inside the knees', cycle: 3.2,
      frames: [P(STAND, { handL: [126, 100], handR: [130, 102], elbowL: -1, elbowR: -1 }),
               P(SQUAT_LOW, { handL: [134, 122], handR: [138, 124], elbowL: -1, elbowR: -1 })] },

    { id: 'db-row', name: 'Bent-Over Dumbbell Row', pool: 'strength', groups: ['pull'], equip: ['dumbbell'], tier: 2, props: ['dumbbells'],
      cue: 'Pull to the ribs, no shrugging', cycle: 3,
      frames: [BENT_OVER, ROW_PULL] },

    { id: 'db-press', name: 'Dumbbell Floor Press', pool: 'strength', groups: ['push'], equip: ['dumbbell'], tier: 2, props: ['dumbbells'],
      cue: 'Elbows at 45, press to lockout', cycle: 3,
      frames: [P(LIE_BACK, { footL: [86, 178], footR: [92, 178], handL: [148, 158], handR: [154, 160], elbowL: -1, elbowR: -1 }),
               P(LIE_BACK, { footL: [86, 178], footR: [92, 178], handL: [156, 122], handR: [162, 124] })] },

    { id: 'db-shoulder-press', name: 'Dumbbell Shoulder Press', pool: 'strength', groups: ['shoulders', 'push'], equip: ['dumbbell'], tier: 2, props: ['dumbbells'],
      cue: 'Ribs down, press straight overhead', cycle: 3,
      frames: [PRESS_RACK, PRESS_TOP] },

    { id: 'db-curl', name: 'Dumbbell Curls', pool: 'strength', groups: ['arms'], equip: ['dumbbell'], tier: 1, props: ['dumbbells'],
      cue: 'Elbows pinned, no swinging', cycle: 2.6,
      frames: [P(STAND, { handL: [110, 122], handR: [130, 122] }), P(STAND, { handL: [108, 88], handR: [134, 88], elbowL: -1, elbowR: -1 })] },

    { id: 'db-rdl', name: 'Romanian Deadlift', pool: 'strength', groups: ['hinge'], equip: ['dumbbell'], tier: 2, props: ['dumbbells'],
      cue: 'Hips back, weights graze the shins', cycle: 3.4,
      frames: [P(HINGE_TOP, { handL: [112, 126], handR: [128, 126] }), P(HINGE_LOW, { handL: [146, 152], handR: [152, 154] })] },

    { id: 'db-lateral-raise', name: 'Lateral Raises', pool: 'strength', groups: ['shoulders'], equip: ['dumbbell'], tier: 1, props: ['dumbbells'],
      cue: 'Lead with the elbows, stop at shoulder height', cycle: 2.8,
      frames: [P(STAND, { handL: [112, 120], handR: [128, 120] }), P(STAND, ARMS_SIDE)] },

    { id: 'db-thruster', name: 'Dumbbell Thruster', pool: 'strength', groups: ['legs', 'shoulders'], equip: ['dumbbell'], tier: 3, props: ['dumbbells'],
      cue: 'Squat, then drive it overhead in one move', cycle: 3.4,
      frames: [PRESS_RACK, P(SQUAT_LOW, { handL: [116, 106], handR: [132, 108], elbowL: -1, elbowR: -1 }), PRESS_TOP] },

    { id: 'db-overhead-tri', name: 'Overhead Triceps Extension', pool: 'strength', groups: ['arms'], equip: ['dumbbell'], tier: 1, props: ['dumbbell'],
      cue: 'Elbows point up and stay there', cycle: 2.8,
      frames: [P(STAND, { handL: [120, 40], handR: [124, 38] }), P(STAND, { handL: [140, 82], handR: [144, 80], elbowL: 1, elbowR: 1 })] },

    { id: 'db-carry', name: 'Farmer Hold', pool: 'strength', groups: ['carry', 'core'], equip: ['dumbbell'], tier: 1, props: ['dumbbells'],
      cue: 'Tall and tight, grip hard, walk if you can', cycle: 2,
      frames: [P(NARROW, { handL: [110, 122], handR: [130, 122] }), P(NARROW, { hip: [120, 114], handL: [110, 120], handR: [130, 120] })] },

    { id: 'db-renegade-row', name: 'Renegade Row', pool: 'strength', groups: ['pull', 'core'], equip: ['dumbbell'], tier: 3, alt: true, props: ['dumbbells'],
      cue: 'Wide feet, hips do not rotate', cycle: 3.4,
      frames: [PLANK_HIGH, P(PLANK_HIGH, { handR: [150, 152], elbowR: 1 })] },

    /* ============ STRENGTH — barbell / bar / band ============ */

    { id: 'bb-squat', name: 'Barbell Back Squat', pool: 'strength', groups: ['legs'], equip: ['barbell'], tier: 3, props: ['barbell'],
      cue: 'Brace, sit between the hips, drive up', cycle: 3.6,
      frames: [P(STAND, { handL: [104, 84], handR: [136, 86], elbowL: -1, elbowR: -1 }),
               P(SQUAT_LOW, { handL: [112, 112], handR: [142, 114], elbowL: -1, elbowR: -1 })] },

    { id: 'bb-deadlift', name: 'Barbell Deadlift', pool: 'strength', groups: ['hinge'], equip: ['barbell'], tier: 3, props: ['barbell'],
      cue: 'Bar over mid-foot, push the floor away', cycle: 3.8,
      frames: [P(HINGE_TOP, { handL: [112, 128], handR: [128, 128] }),
               P(STAND, { hip: [108, 134], torso: 34, arch: -4, handL: [140, 168], handR: [146, 170], footL: [112, 178], footR: [126, 178] })] },

    { id: 'bb-bench', name: 'Barbell Bench Press', pool: 'strength', groups: ['push'], equip: ['barbell', 'bench'], tier: 3, props: ['bench', 'barbell'],
      cue: 'Shoulders back, bar to the sternum', cycle: 3.2,
      frames: [P(LIE_BACK, { hip: [116, 142], torso: -6, head: 6, footL: [58, 178], footR: [64, 178], handL: [148, 130], handR: [154, 132], elbowL: -1, elbowR: -1 }),
               P(LIE_BACK, { hip: [116, 142], torso: -6, head: 6, footL: [58, 178], footR: [64, 178], handL: [154, 96], handR: [160, 98] })] },

    { id: 'bb-row', name: 'Barbell Row', pool: 'strength', groups: ['pull'], equip: ['barbell'], tier: 3, props: ['barbell'],
      cue: 'Flat back, bar to the belly button', cycle: 3.2,
      frames: [BENT_OVER, P(ROW_PULL, { handL: [140, 132], handR: [146, 134] })] },

    { id: 'bb-ohp', name: 'Overhead Press', pool: 'strength', groups: ['shoulders', 'push'], equip: ['barbell'], tier: 3, props: ['barbell'],
      cue: 'Squeeze everything, press and lock out', cycle: 3.2,
      frames: [P(STAND, { handL: [106, 88], handR: [134, 88], elbowL: -1, elbowR: -1 }), P(STAND, { handL: [112, 36], handR: [128, 36] })] },

    { id: 'pull-up', name: 'Pull-Up', pool: 'strength', groups: ['pull'], equip: ['bar'], tier: 3, props: ['pullbar'],
      cue: 'Chest to the bar, control the way down', cycle: 3.4,
      frames: [HANG, HANG_TOP] },

    { id: 'chin-up', name: 'Chin-Up', pool: 'strength', groups: ['pull', 'arms'], equip: ['bar'], tier: 3, props: ['pullbar'],
      cue: 'Palms toward you, drive the elbows down', cycle: 3.4,
      frames: [P(HANG, { handL: [114, 26], handR: [126, 26] }), P(HANG_TOP, { handL: [114, 26], handR: [126, 26] })] },

    { id: 'hang-knee-raise', name: 'Hanging Knee Raises', pool: 'strength', groups: ['core'], equip: ['bar'], tier: 3, props: ['pullbar'],
      cue: 'No swinging — curl the hips up', cycle: 3.4,
      frames: [HANG, P(HANG, { footL: [140, 128], footR: [146, 124], arch: 6, kneeL: 1, kneeR: 1 })] },

    { id: 'dead-hang', name: 'Dead Hang', pool: 'strength', groups: ['pull', 'carry'], equip: ['bar'], tier: 2, props: ['pullbar'],
      cue: 'Relax the shoulders, just hang and breathe', cycle: 5,
      frames: [HANG, P(HANG, { hip: [120, 114] })] },

    { id: 'band-row', name: 'Band Row', pool: 'strength', groups: ['pull'], equip: ['band'], tier: 1, props: ['band'],
      cue: 'Squeeze the shoulder blades together', cycle: 2.8,
      frames: [P(NARROW, { handL: [158, 106], handR: [162, 110] }), P(NARROW, { handL: [124, 108], handR: [128, 112], elbowL: 1, elbowR: 1 })] },

    { id: 'band-pull-apart', name: 'Band Pull-Aparts', pool: 'strength', groups: ['pull', 'shoulders'], equip: ['band'], tier: 1,
      cue: 'Straight arms, open the chest', cycle: 2.6,
      frames: [P(NARROW, { handL: [154, 90], handR: [158, 94] }), P(NARROW, { handL: [92, 96], handR: [156, 92] })] },

    /* ============ SWEAT — conditioning ============ */

    { id: 'jumping-jacks', name: 'Jumping Jacks', pool: 'sweat', groups: ['impact', 'full'], equip: [], tier: 1,
      cue: 'Full range, land soft', cycle: 1.1,
      frames: [JJ_IN, JJ_OUT] },

    { id: 'cross-jacks', name: 'Cross Jacks', pool: 'sweat', groups: ['impact', 'full'], equip: [], tier: 1,
      cue: 'Cross arms and feet, then open', cycle: 1.2,
      frames: [P(JJ_OUT, { footL: [98, 178], footR: [142, 178] }),
               P(NARROW, { hip: [120, 120], footL: [126, 178], footR: [114, 178], handL: [142, 108], handR: [100, 106] })] },

    { id: 'seal-jacks', name: 'Seal Jacks', pool: 'sweat', groups: ['impact', 'upper'], equip: [], tier: 1,
      cue: 'Clap in front at chest height', cycle: 1.2,
      frames: [P(JJ_OUT, { handL: [92, 88], handR: [148, 88] }), P(NARROW, { handL: [154, 90], handR: [158, 92] })] },

    { id: 'high-knees', name: 'High Knees', pool: 'sweat', groups: ['impact'], equip: [], tier: 1,
      cue: 'Knees to hip height, quick feet', cycle: 0.8,
      frames: [KNEE_R, KNEE_L] },

    { id: 'butt-kicks', name: 'Butt Kicks', pool: 'sweat', groups: ['impact'], equip: [], tier: 1,
      cue: 'Heels to the glutes, stay tall', cycle: 0.8,
      frames: [P(NARROW, { footR: [98, 123], handR: [104, 106], handL: [136, 112], kneeR: 1 }),
               P(NARROW, { footL: [98, 123], handL: [104, 106], handR: [136, 112], kneeL: 1 })] },

    { id: 'fast-feet', name: 'Fast Feet', pool: 'sweat', groups: ['low'], equip: [], tier: 1,
      cue: 'Low stance, chop the feet as fast as you can', cycle: 0.5,
      frames: [P(SQUAT_HALF, { footL: [108, 174], footR: [130, 178], handL: [148, 112], handR: [152, 116] }),
               P(SQUAT_HALF, { footL: [110, 178], footR: [132, 174], handL: [148, 112], handR: [152, 116] })] },

    { id: 'squat-jump', name: 'Squat Jumps', pool: 'sweat', groups: ['impact'], equip: [], tier: 2,
      cue: 'Explode up, land soft into the next one', cycle: 1.6,
      frames: [SQUAT_LOW, P(JUMP_UP, { handL: [104, 96], handR: [140, 92] })] },

    { id: 'tuck-jump', name: 'Tuck Jumps', pool: 'sweat', groups: ['impact'], equip: [], tier: 3,
      cue: 'Knees to chest at the top', cycle: 1.8,
      frames: [SQUAT_HALF, P(JUMP_UP, { hip: [120, 112], footL: [140, 128], footR: [146, 124], handL: [154, 130], handR: [158, 134], kneeL: 1, kneeR: 1 })] },

    { id: 'split-jump', name: 'Split Jumps', pool: 'sweat', groups: ['impact'], equip: [], tier: 3,
      cue: 'Switch legs in the air, soft landings', cycle: 1.6,
      frames: [P(LUNGE_DOWN, { handL: [104, 110], handR: [140, 108] }),
               P(JUMP_UP, { hip: [120, 110], footL: [96, 166], footR: [146, 160] }),
               P(LUNGE_BACK_DOWN, { handL: [140, 108], handR: [104, 110] })] },

    { id: 'star-jump', name: 'Star Jumps', pool: 'sweat', groups: ['impact', 'full'], equip: [], tier: 2,
      cue: 'Squat small, burst into a star', cycle: 1.8,
      frames: [P(SQUAT_HALF, { handL: [128, 130], handR: [132, 132] }),
               P(JUMP_UP, { hip: [120, 106], footL: [88, 160], footR: [152, 158], handL: [84, 62], handR: [156, 60] })] },

    { id: 'skater-hops', name: 'Skater Hops', pool: 'sweat', groups: ['impact'], equip: [], tier: 2,
      cue: 'Bound side to side, stick each landing', cycle: 1.4,
      frames: [{ hip: [138, 134], torso: 78, footR: [146, 178], footL: [108, 162], handL: [148, 118], handR: [116, 128], kneeL: -1 },
               { hip: [102, 134], torso: 100, footL: [94, 178], footR: [132, 162], handR: [92, 118], handL: [124, 128], kneeR: -1 }] },

    { id: 'lateral-shuffle', name: 'Lateral Shuffle', pool: 'sweat', groups: ['low'], equip: [], tier: 1,
      cue: 'Stay low, three steps each way', cycle: 1.2,
      frames: [P(SQUAT_HALF, { hip: [104, 134], footL: [88, 178], footR: [118, 178], handL: [132, 116], handR: [136, 120] }),
               P(SQUAT_HALF, { hip: [136, 134], footL: [122, 178], footR: [152, 178], handL: [164, 116], handR: [168, 120] })] },

    { id: 'mountain-climbers', name: 'Mountain Climbers', pool: 'sweat', groups: ['floor', 'core'], equip: [], tier: 2,
      cue: 'Hips low, drive the knees in fast', cycle: 0.9,
      frames: [P(PLANK_HIGH, { footR: [132, 166], kneeR: 1 }), P(PLANK_HIGH, { footL: [126, 164], footR: [83, 178], kneeL: 1 })] },

    { id: 'plank-jacks', name: 'Plank Jacks', pool: 'sweat', groups: ['floor', 'core'], equip: [], tier: 2,
      cue: 'Hands still, feet jump wide and in', cycle: 1,
      frames: [PLANK_HIGH, P(PLANK_HIGH, { footL: [64, 172], footR: [94, 176] })] },

    { id: 'sprawl', name: 'Sprawls', pool: 'sweat', groups: ['floor', 'full'], equip: [], tier: 2,
      cue: 'Hands down, kick out, stand up', cycle: 2.2,
      frames: [P(SQUAT_HALF, { handL: [148, 118], handR: [152, 122] }), TUCK, PLANK_HIGH, TUCK] },

    { id: 'burpee', name: 'Burpee', pool: 'sweat', groups: ['floor', 'impact', 'full'], equip: [], tier: 3,
      cue: 'Chest to the floor, jump at the top', cycle: 3,
      frames: [P(JUMP_UP, { hip: [120, 104] }), TUCK, PLANK_HIGH, PUSHUP_LOW, PLANK_HIGH, TUCK] },

    { id: 'squat-thrust', name: 'Squat Thrusts', pool: 'sweat', groups: ['floor', 'full'], equip: [], tier: 2,
      cue: 'Same as a burpee without the jump', cycle: 2,
      frames: [P(SQUAT_HALF, { handL: [148, 118], handR: [152, 122] }), TUCK, PLANK_HIGH, TUCK] },

    { id: 'bear-crawl', name: 'Bear Crawl Hold', pool: 'sweat', groups: ['floor', 'core'], equip: [], tier: 2,
      cue: 'Knees hover, opposite hand and foot', cycle: 1.6,
      frames: [P(QUAD_ALL4, { hip: [108, 140], footL: [80, 172], footR: [86, 170] }),
               P(QUAD_ALL4, { hip: [108, 140], footL: [76, 162], footR: [86, 170], handR: [162, 168] })] },

    { id: 'shadow-box', name: 'Shadow Boxing', pool: 'sweat', groups: ['upper', 'low'], equip: [], tier: 1,
      cue: 'Jab, cross, rotate through the hips', cycle: 1,
      frames: [BOX_GUARD, P(BOX_GUARD, { handR: [164, 92], torso: 84 }), BOX_GUARD, P(BOX_GUARD, { handL: [166, 96], torso: 80 })] },

    { id: 'knee-strikes', name: 'Knee Strikes', pool: 'sweat', groups: ['impact', 'core'], equip: [], tier: 1,
      cue: 'Pull the hands down as the knee drives up', cycle: 1.2,
      frames: [P(BOX_GUARD, { handL: [140, 92], handR: [136, 98] }),
               P(BOX_GUARD, { footR: [140, 124], handL: [148, 128], handR: [144, 134], kneeR: 1 })] },

    { id: 'punch-overhead', name: 'Overhead Punches', pool: 'sweat', groups: ['upper'], equip: [], tier: 1,
      cue: 'Punch the ceiling, alternate fast', cycle: 0.9,
      frames: [P(NARROW, { handL: [112, 40], handR: [130, 92] }), P(NARROW, { handL: [110, 92], handR: [128, 38] })] },

    { id: 'jump-rope', name: 'Jump Rope', pool: 'sweat', groups: ['impact'], equip: [], tier: 1,
      cue: 'Tiny hops, wrists do the work', cycle: 0.7,
      frames: [P(NARROW, { handL: [102, 110], handR: [138, 110], elbowL: 1, elbowR: 1 }),
               P(NARROW, { hip: [120, 108], footL: [117, 172], footR: [123, 172], handL: [102, 104], handR: [138, 104], elbowL: 1, elbowR: 1 })] },

    { id: 'toe-taps', name: 'Toe Taps', pool: 'sweat', groups: ['low'], equip: ['chair'], tier: 1, props: ['chair'],
      cue: 'Quick alternating taps, stay springy', cycle: 0.8,
      frames: [P(NARROW, { footR: [152, 142], handL: [110, 112], handR: [132, 110], kneeR: 1 }),
               P(NARROW, { footL: [152, 142], handR: [110, 112], handL: [132, 110], kneeL: 1 })] },

    { id: 'broad-jump', name: 'Broad Jump + Step Back', pool: 'sweat', groups: ['impact'], equip: [], tier: 3,
      cue: 'Big swing, jump forward, walk it back', cycle: 2.4,
      frames: [P(HINGE_LOW, { hip: [108, 132], handL: [96, 150], handR: [100, 154] }),
               P(JUMP_UP, { hip: [126, 112], handL: [154, 66], handR: [160, 70], footL: [116, 158], footR: [130, 156] }),
               P(SQUAT_LOW, { hip: [122, 148] })] },

    { id: 'inchworm-jump', name: 'Inchworm to Jump', pool: 'sweat', groups: ['floor', 'impact'], equip: [], tier: 3,
      cue: 'Walk out, walk in, finish with a jump', cycle: 3.4,
      frames: [HINGE_LOW, PLANK_HIGH, TUCK, P(JUMP_UP, { hip: [120, 104] })] },

    { id: 'sprint-place', name: 'Sprint in Place', pool: 'sweat', groups: ['impact'], equip: [], tier: 2,
      cue: 'Everything you have — drive the arms', cycle: 0.6,
      frames: [P(NARROW, { hip: [120, 114], torso: 84, footR: [140, 132], footL: [104, 176], handR: [100, 100], handL: [142, 116], kneeR: 1 }),
               P(NARROW, { hip: [120, 114], torso: 84, footL: [140, 132], footR: [104, 176], handL: [100, 100], handR: [142, 116], kneeL: 1 })] }
  ];

  var BY_ID = {};
  for (var i = 0; i < EX.length; i++) BY_ID[EX[i].id] = EX[i];

  global.S3 = global.S3 || {};
  global.S3.exercises = { all: EX, byId: BY_ID, poses: { STAND: STAND } };
})(window);
