/* 3S — figure rig, inverse kinematics, and SVG renderer.
 *
 * Coordinate space: viewBox 0 0 240 200, y grows downward, ground at y=178.
 * Angles: degrees, dir(t) = (cos t, -sin t) so 90 = up, 0 = right, -90 = down.
 * Poses are authored facing right. Limbs suffixed L are the far side (drawn
 * lighter), R the near side.
 */
(function (global) {
  'use strict';

  var RIG = {
    torso: 42, neck: 16, headR: 10,
    upperArm: 24, foreArm: 22,
    thigh: 31, shin: 31
  };

  var GROUND = 178;
  var CX = 120;

  var DEFAULT_POSE = {
    hip: [120, 118],
    torso: 90,
    head: 0,
    footL: [112, 178], footR: [128, 178],
    handL: [112, 118], handR: [128, 118],
    kneeL: 1, kneeR: 1,     // +1 bends toward facing direction (+x)
    elbowL: -1, elbowR: -1, // -1 bends away from facing direction
    arch: 0                 // spine curvature: >0 rounded/flexed, <0 arched
  };

  var RAD = Math.PI / 180;

  function dir(deg) { var r = deg * RAD; return [Math.cos(r), -Math.sin(r)]; }
  function add(p, v, k) { return [p[0] + v[0] * k, p[1] + v[1] * k]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
  function len(v) { return Math.hypot(v[0], v[1]); }

  /* Two-bone IK. Returns the mid joint placed so that |root-joint| = l1 and
   * |joint-target| = l2, bending by `bend` (+1 = toward +x). */
  function ik(root, target, l1, l2, bend) {
    var v = sub(target, root);
    var d = len(v);
    var min = Math.abs(l1 - l2) + 0.01;
    var max = l1 + l2 - 0.01;
    if (d < min) d = min;
    if (d > max) d = max;
    if (len(v) < 0.0001) v = [0.0001, 0];
    var u = [v[0] / len(v), v[1] / len(v)];
    var a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    var h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    // perp(u) = (-uy, ux); negate so bend=+1 leans toward +x
    var n = [u[1] * bend, -u[0] * bend];
    return [root[0] + u[0] * a + n[0] * h, root[1] + u[1] * a + n[1] * h];
  }

  /* Knees and elbows must not sink through the floor. Prone, kneeling, and plank
   * poses put a limb's endpoints close together with the foot planted, and the
   * authored bend direction can then swing the joint below the ground line — a
   * leg visibly sagging through the floor. Honour the authored bend whenever it
   * stays above ground and flip it only when it would not. */
  function ikAbove(root, target, l1, l2, bend, limit) {
    var j = ik(root, target, l1, l2, bend);
    if (j[1] <= limit) return j;
    var alt = ik(root, target, l1, l2, -bend);
    return alt[1] < j[1] ? alt : j;
  }

  function normalize(pose) {
    var out = {};
    for (var k in DEFAULT_POSE) out[k] = DEFAULT_POSE[k];
    for (var j in pose) if (pose[j] !== undefined) out[j] = pose[j];
    return out;
  }

  /* Resolve a pose into screen points. */
  function solve(raw) {
    var p = normalize(raw);
    var hip = p.hip;
    var td = dir(p.torso);
    var shoulder = add(hip, td, RIG.torso);
    var hd = dir(p.torso + p.head);
    var head = add(shoulder, hd, RIG.neck);

    /* Spine control point: perpendicular offset from the hip-shoulder midline,
     * pushed toward the figure's back so positive arch reads as a rounded spine. */
    var mid = [(hip[0] + shoulder[0]) / 2, (hip[1] + shoulder[1]) / 2];
    var spineCtl = [mid[0] - td[1] * p.arch, mid[1] - td[0] * p.arch];

    return {
      hip: hip,
      shoulder: shoulder,
      spineCtl: spineCtl,
      head: head,
      headR: RIG.headR,
      kneeL: ikAbove(hip, p.footL, RIG.thigh, RIG.shin, p.kneeL, GROUND),
      kneeR: ikAbove(hip, p.footR, RIG.thigh, RIG.shin, p.kneeR, GROUND),
      footL: p.footL, footR: p.footR,
      elbowL: ikAbove(shoulder, p.handL, RIG.upperArm, RIG.foreArm, p.elbowL, GROUND),
      elbowR: ikAbove(shoulder, p.handR, RIG.upperArm, RIG.foreArm, p.elbowR, GROUND),
      handL: p.handL, handR: p.handR
    };
  }

  /* ---- interpolation ---- */

  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpPt(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]; }
  function lerpAngle(a, b, t) {
    var d = ((b - a) % 360 + 540) % 360 - 180;  // shortest arc
    return a + d * t;
  }

  var PT_KEYS = ['hip', 'footL', 'footR', 'handL', 'handR'];
  var ANG_KEYS = ['torso', 'head'];
  var NUM_KEYS = ['arch'];
  var PICK_KEYS = ['kneeL', 'kneeR', 'elbowL', 'elbowR'];

  function blend(rawA, rawB, t) {
    var a = normalize(rawA), b = normalize(rawB), out = {}, i;
    for (i = 0; i < PT_KEYS.length; i++) out[PT_KEYS[i]] = lerpPt(a[PT_KEYS[i]], b[PT_KEYS[i]], t);
    for (i = 0; i < ANG_KEYS.length; i++) out[ANG_KEYS[i]] = lerpAngle(a[ANG_KEYS[i]], b[ANG_KEYS[i]], t);
    for (i = 0; i < NUM_KEYS.length; i++) out[NUM_KEYS[i]] = lerp(a[NUM_KEYS[i]], b[NUM_KEYS[i]], t);
    for (i = 0; i < PICK_KEYS.length; i++) out[PICK_KEYS[i]] = (t < 0.5 ? a : b)[PICK_KEYS[i]];
    return out;
  }

  function easeInOut(t) { return 0.5 - 0.5 * Math.cos(Math.PI * t); }

  /* Sample a closed keyframe loop at phase u in [0,1). Frames may carry a
   * weight `w` to spend more of the cycle on one segment. */
  function sampleLoop(frames, u) {
    var n = frames.length;
    if (n === 1) return frames[0];
    var w = [], total = 0, i;
    for (i = 0; i < n; i++) { var k = frames[i].w || 1; w.push(k); total += k; }
    var x = (u % 1 + 1) % 1 * total;
    for (i = 0; i < n; i++) {
      if (x < w[i] || i === n - 1) {
        var t = easeInOut(Math.min(1, x / w[i]));
        return blend(frames[i], frames[(i + 1) % n], t);
      }
      x -= w[i];
    }
    return frames[0];
  }

  /* ---- SVG renderer ---- */

  var NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function Figure(mount) {
    /* A square box centred on the minimal circle that encloses every joint of
     * every pose (radius 101.6 at 120.2,109.5 — recompute with tools/shoot.js
     * after adding poses). Because the content circle is inscribed in this box,
     * scaling the box to sit just inside the progress ring guarantees no limb
     * ever crosses the ring, at the largest figure the ring allows. Props may
     * extend past it; they read as scenery. */
    this.svg = el('svg', {
      viewBox: '19 8 203 203', class: 'figure',
      preserveAspectRatio: 'xMidYMid meet'
    });

    this.propsBack = el('g', { class: 'fx-prop-back' });
    this.far = el('g', { class: 'fx-far' });
    this.near = el('g', { class: 'fx-near' });
    this.propsFront = el('g', { class: 'fx-prop-front' });

    this.ground = el('line', { class: 'fx-ground', x1: 66, y1: GROUND, x2: 176, y2: GROUND });

    this.legFar = el('polyline', { class: 'fx-limb fx-dim' });
    this.armFar = el('polyline', { class: 'fx-limb fx-dim' });
    this.spine = el('path', { class: 'fx-spine' });
    this.neck = el('line', { class: 'fx-neck' });
    this.head = el('circle', { class: 'fx-head', r: RIG.headR });
    this.legNear = el('polyline', { class: 'fx-limb' });
    this.armNear = el('polyline', { class: 'fx-limb' });

    this.far.appendChild(this.legFar);
    this.far.appendChild(this.armFar);
    this.near.appendChild(this.spine);
    this.near.appendChild(this.neck);
    this.near.appendChild(this.head);
    this.near.appendChild(this.legNear);
    this.near.appendChild(this.armNear);

    this.svg.appendChild(this.ground);
    this.svg.appendChild(this.propsBack);
    this.svg.appendChild(this.far);
    this.svg.appendChild(this.near);
    this.svg.appendChild(this.propsFront);

    if (mount) mount.appendChild(this.svg);
    this.props = [];
  }

  Figure.prototype.setProps = function (list) {
    this.props = list || [];
    this.propsBack.textContent = '';
    this.propsFront.textContent = '';
    this._propNodes = { back: {}, front: {} };
    for (var i = 0; i < this.props.length; i++) {
      var def = PROPS[this.props[i]];
      if (!def) continue;
      var layer = def.front ? this.propsFront : this.propsBack;
      var nodes = def.build();
      for (var j = 0; j < nodes.length; j++) layer.appendChild(nodes[j]);
      (def.front ? this._propNodes.front : this._propNodes.back)[this.props[i]] = nodes;
    }
  };

  Figure.prototype.showGround = function (on) {
    this.ground.style.display = on === false ? 'none' : '';
  };

  function pts(list) {
    var s = '';
    for (var i = 0; i < list.length; i++) s += (i ? ' ' : '') + list[i][0].toFixed(1) + ',' + list[i][1].toFixed(1);
    return s;
  }

  Figure.prototype.draw = function (pose) {
    var p = solve(pose);

    this.legFar.setAttribute('points', pts([p.hip, p.kneeL, p.footL]));
    this.armFar.setAttribute('points', pts([p.shoulder, p.elbowL, p.handL]));
    this.legNear.setAttribute('points', pts([p.hip, p.kneeR, p.footR]));
    this.armNear.setAttribute('points', pts([p.shoulder, p.elbowR, p.handR]));

    this.spine.setAttribute('d',
      'M' + p.hip[0].toFixed(1) + ',' + p.hip[1].toFixed(1) +
      ' Q' + p.spineCtl[0].toFixed(1) + ',' + p.spineCtl[1].toFixed(1) +
      ' ' + p.shoulder[0].toFixed(1) + ',' + p.shoulder[1].toFixed(1));

    this.neck.setAttribute('x1', p.shoulder[0].toFixed(1));
    this.neck.setAttribute('y1', p.shoulder[1].toFixed(1));
    this.neck.setAttribute('x2', p.head[0].toFixed(1));
    this.neck.setAttribute('y2', p.head[1].toFixed(1));

    this.head.setAttribute('cx', p.head[0].toFixed(1));
    this.head.setAttribute('cy', p.head[1].toFixed(1));

    for (var i = 0; i < this.props.length; i++) {
      var name = this.props[i], def = PROPS[name];
      if (!def) continue;
      var store = def.front ? this._propNodes.front : this._propNodes.back;
      def.update(store[name], p);
    }
    return p;
  };

  /* ---- props ---- */

  function plate(r) { return el('circle', { class: 'fx-weight', r: r }); }
  function place(node, pt) {
    node.setAttribute('cx', pt[0].toFixed(1));
    node.setAttribute('cy', pt[1].toFixed(1));
  }

  var PROPS = {
    /* Side view: a dumbbell reads as a short thick bar across the hand. */
    dumbbells: {
      front: true,
      build: function () {
        return [el('line', { class: 'fx-db' }), el('line', { class: 'fx-db fx-dim' })];
      },
      update: function (n, p) {
        bar(n[0], p.handR, p.elbowR);
        bar(n[1], p.handL, p.elbowL);
      }
    },
    /* One dumbbell, held near-side (goblet / single-arm work). */
    dumbbell: {
      front: true,
      build: function () { return [el('line', { class: 'fx-db' })]; },
      update: function (n, p) { bar(n[0], p.handR, p.elbowR); }
    },
    /* Side view of a loaded barbell: you see the plates end-on. */
    barbell: {
      front: true,
      build: function () {
        return [el('line', { class: 'fx-bar' }), plate(13), plate(13)];
      },
      update: function (n, p) {
        n[0].setAttribute('x1', p.handL[0].toFixed(1));
        n[0].setAttribute('y1', p.handL[1].toFixed(1));
        n[0].setAttribute('x2', p.handR[0].toFixed(1));
        n[0].setAttribute('y2', p.handR[1].toFixed(1));
        place(n[1], p.handL);
        place(n[2], p.handR);
      }
    },
    pullbar: {
      front: false,
      build: function () {
        return [el('line', { class: 'fx-fixture', x1: 46, y1: 26, x2: 194, y2: 26 }),
                el('line', { class: 'fx-fixture fx-dim', x1: 60, y1: 26, x2: 60, y2: 11 }),
                el('line', { class: 'fx-fixture fx-dim', x1: 180, y1: 26, x2: 180, y2: 11 })];
      },
      update: function () {}
    },
    bench: {
      front: false,
      build: function () {
        return [el('rect', { class: 'fx-fixture-fill', x: 62, y: 146, width: 116, height: 9, rx: 4 }),
                el('line', { class: 'fx-fixture', x1: 76, y1: 155, x2: 76, y2: GROUND }),
                el('line', { class: 'fx-fixture', x1: 164, y1: 155, x2: 164, y2: GROUND })];
      },
      update: function () {}
    },
    chair: {
      front: false,
      build: function () {
        return [el('rect', { class: 'fx-fixture-fill', x: 138, y: 140, width: 68, height: 8, rx: 4 }),
                el('line', { class: 'fx-fixture', x1: 146, y1: 148, x2: 146, y2: GROUND }),
                el('line', { class: 'fx-fixture', x1: 198, y1: 148, x2: 198, y2: GROUND }),
                el('line', { class: 'fx-fixture', x1: 202, y1: 140, x2: 202, y2: 92 })];
      },
      update: function () {}
    },
    /* The figure faces +x, so a wall it leans against belongs behind it. */
    wall: {
      front: false,
      build: function () { return [el('line', { class: 'fx-fixture', x1: 44, y1: 22, x2: 44, y2: GROUND })]; },
      update: function () {}
    },
    /* Resistance band: a slack curve from an anchor to the hands. */
    band: {
      front: true,
      build: function () { return [el('path', { class: 'fx-band' })]; },
      update: function (n, p) {
        var a = [206, 104];
        var m = [(a[0] + p.handR[0]) / 2, (a[1] + p.handR[1]) / 2 + 10];
        n[0].setAttribute('d', 'M' + a[0] + ',' + a[1] + ' Q' + m[0].toFixed(1) + ',' +
          m[1].toFixed(1) + ' ' + p.handR[0].toFixed(1) + ',' + p.handR[1].toFixed(1));
      }
    }
  };

  function bar(node, hand, elbow) {
    // short bar centred on the hand, perpendicular to the forearm
    var v = sub(hand, elbow), L = len(v) || 1;
    var n = [-v[1] / L, v[0] / L], k = 11;
    node.setAttribute('x1', (hand[0] - n[0] * k).toFixed(1));
    node.setAttribute('y1', (hand[1] - n[1] * k).toFixed(1));
    node.setAttribute('x2', (hand[0] + n[0] * k).toFixed(1));
    node.setAttribute('y2', (hand[1] + n[1] * k).toFixed(1));
  }

  global.S3 = global.S3 || {};
  global.S3.rig = {
    RIG: RIG, GROUND: GROUND, CX: CX,
    solve: solve, blend: blend, sampleLoop: sampleLoop,
    Figure: Figure, PROPS: PROPS
  };
})(window);
