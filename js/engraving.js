/* ════════════════════════════════════════════════════════════════════
   engraving.js — procedural copperplate etching

   Original line art in the manner of 18th-century architectural
   etching: everything is stroked, tone is built from hatching rather
   than fill, and nothing is copied from any existing work.

   Why hatching and not shading: an etcher cannot lay down grey. Tone
   comes from line density — parallel strokes for a light wash, crossed
   strokes for shadow, strokes laid along the form (contour hatching)
   to describe curvature. Reproducing that rule is most of what makes
   generated line art read as an engraving rather than as clip art.

   Every hatch field is collapsed into ONE <path> with many subpaths,
   so a fully hatched vault costs about a dozen DOM nodes.

   Units are world metres, like the rest of the city. `u` is a plate's
   own line unit, derived from its width, so a 1,700 m plate and a
   700 m plate are drawn with proportionate pen weights.
   ════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var H = global.Hive;
  var rngFor = H.rngFor, clamp = H.clamp;

  function n(v) { return Math.round(v * 100) / 100; }
  var TAU = Math.PI * 2;

  /* ── line clipping (Liang–Barsky) ─────────────────────────────────
     Hatching is generated as infinite rulings and trimmed to the shape
     being shaded, which is far cheaper than a clipPath per field.    */
  function clipSeg(x1, y1, x2, y2, xmin, ymin, xmax, ymax) {
    var t0 = 0, t1 = 1, dx = x2 - x1, dy = y2 - y1, p, q, r;
    for (var i = 0; i < 4; i++) {
      if (i === 0) { p = -dx; q = x1 - xmin; }
      else if (i === 1) { p = dx; q = xmax - x1; }
      else if (i === 2) { p = -dy; q = y1 - ymin; }
      else { p = dy; q = ymax - y1; }
      if (p === 0) { if (q < 0) return null; continue; }
      r = q / p;
      if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
  }

  /** Parallel rulings across a rectangle at `ang` degrees. */
  function hatch(x, y, w, h, ang, gap, rng, broken) {
    var a = ang * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
    var nx = -dy, ny = dx;
    var cs = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
    var lo = Infinity, hi = -Infinity;
    for (var c = 0; c < 4; c++) {
      var t = cs[c][0] * nx + cs[c][1] * ny;
      if (t < lo) lo = t; if (t > hi) hi = t;
    }
    var span = Math.hypot(w, h), d = '';
    for (var s = lo; s <= hi; s += gap) {
      var px = nx * s, py = ny * s;
      var seg = clipSeg(px - dx * span, py - dy * span, px + dx * span, py + dy * span, x, y, x + w, y + h);
      if (!seg) continue;
      if (broken && rng) {
        /* a real plate has bitten lines that break and taper */
        var k = rng.range(0.05, 0.3), m = rng.range(0.7, 0.98);
        var ax = seg[0] + (seg[2] - seg[0]) * k, ay = seg[1] + (seg[3] - seg[1]) * k;
        var bx = seg[0] + (seg[2] - seg[0]) * m, by = seg[1] + (seg[3] - seg[1]) * m;
        d += 'M' + n(ax) + ' ' + n(ay) + 'L' + n(bx) + ' ' + n(by);
      } else {
        d += 'M' + n(seg[0]) + ' ' + n(seg[1]) + 'L' + n(seg[2]) + ' ' + n(seg[3]);
      }
    }
    return d;
  }

  /** Strokes laid along a curve and normal to it — describes form. */
  function contour(fn, t0, t1, steps, len, u) {
    var d = '';
    for (var i = 0; i <= steps; i++) {
      var t = t0 + (t1 - t0) * (i / steps);
      var p = fn(t), q = fn(t + 0.001);
      var vx = q[0] - p[0], vy = q[1] - p[1], m = Math.hypot(vx, vy) || 1;
      var nx = -vy / m, ny = vx / m;
      var L = (typeof len === 'function' ? len(t) : len) * u;
      d += 'M' + n(p[0]) + ' ' + n(p[1]) + 'L' + n(p[0] + nx * L) + ' ' + n(p[1] + ny * L);
    }
    return d;
  }

  function P(d, cls, sw) {
    if (!d) return '';
    return '<path class="' + cls + '"' + (sw ? ' stroke-width="' + n(sw) + '"' : '') + ' d="' + d + '"/>';
  }
  function arcPath(cx, cy, r, a0, a1) {
    var x0 = cx + Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r;
    var x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
    var large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
    return 'M' + n(x0) + ' ' + n(y0) + 'A' + n(r) + ' ' + n(r) + ' 0 ' + large + ' 1 ' + n(x1) + ' ' + n(y1);
  }

  /* ══ COMPOSITIONS ══════════════════════════════════════════════════
     Each returns SVG for a plate of size w × h with its origin at the
     top-left. All are drawn in the vocabulary of the Carceri: vaults
     receding past the point where they should have ended, stairs that
     serve nothing, machinery of unstated purpose.                    */

  /** Receding barrel vault — the deep perspective corridor. */
  function vault(w, h, rng) {
    var u = w / 800, s = '';
    var vx = w * rng.range(0.4, 0.6), vy = h * rng.range(0.46, 0.58);
    var bays = rng.int(6, 9);
    var r0 = w * rng.range(0.34, 0.46), base = h * rng.range(0.72, 0.84);
    var k = rng.range(0.7, 0.79);

    var hatchD = '', lineD = '';
    for (var i = 0; i < bays; i++) {
      var r = r0 * Math.pow(k, i);
      var cy = vy + (base - vy) * Math.pow(k, i) * 0.55;
      lineD += arcPath(vx, cy, r, Math.PI, TAU);
      /* piers down to the floor */
      var fy = vy + (base - vy) * Math.pow(k, i);
      lineD += 'M' + n(vx - r) + ' ' + n(cy) + 'L' + n(vx - r) + ' ' + n(fy);
      lineD += 'M' + n(vx + r) + ' ' + n(cy) + 'L' + n(vx + r) + ' ' + n(fy);
      /* contour hatching on the intrados, heaviest at the springing */
      if (i < bays - 2) {
        var rr = r, ccy = cy;
        hatchD += contour(function (t) {
          var a = Math.PI + t * Math.PI;
          return [vx + Math.cos(a) * rr, ccy + Math.sin(a) * rr];
        }, 0, 1, Math.max(8, Math.round(26 - i * 2)),
          function (t) { return (1 - Math.sin(t * Math.PI)) * 26 + 4; }, u);
      }
    }
    /* floor boards converging on the vanishing point */
    var fl = '';
    for (var f = -6; f <= 6; f++) {
      var ex = vx + f * (w * 0.075);
      fl += 'M' + n(ex) + ' ' + n(h) + 'L' + n(vx + f * u * 6) + ' ' + n(base);
    }
    /* side masses, cross-hatched into shadow */
    var mw = vx - r0;
    if (mw > w * 0.04) {
      hatchD += hatch(0, h * 0.1, mw, h * 0.8, 62, 7 * u, rng, true);
      hatchD += hatch(0, h * 0.34, mw * 0.6, h * 0.56, -58, 9 * u, rng, true);
    }
    var rw = w - (vx + r0);
    if (rw > w * 0.04) {
      hatchD += hatch(vx + r0, h * 0.1, rw, h * 0.8, 118, 7 * u, rng, true);
    }
    /* a catwalk crossing the void, as they always do */
    if (rng.chance(0.8)) {
      var cy2 = vy + (base - vy) * rng.range(0.15, 0.5);
      lineD += 'M0 ' + n(cy2) + 'L' + n(w) + ' ' + n(cy2 + rng.range(-1, 1) * h * 0.04);
      lineD += 'M0 ' + n(cy2 + 5 * u) + 'L' + n(w) + ' ' + n(cy2 + 5 * u + rng.range(-1, 1) * h * 0.04);
      var rail = '';
      for (var g = 0; g < 26; g++) {
        var gx = (w / 26) * g;
        rail += 'M' + n(gx) + ' ' + n(cy2) + 'l0 ' + n(-11 * u);
      }
      s += P(rail, 'eF', 0.9 * u);
    }
    s += P(fl, 'eF', 0.9 * u);
    s += P(hatchD, 'eH', 0.85 * u);
    s += P(lineD, 'eL', 2.0 * u);
    return s;
  }

  /** Tiers of arcades — Roman substructure, load-bearing and endless. */
  function arcade(w, h, rng) {
    var u = w / 800, s = '';
    var tiers = rng.int(3, 5), lineD = '', hatchD = '';
    var y = h;
    for (var t = 0; t < tiers; t++) {
      var th = h / tiers * rng.range(0.85, 1.1);
      var top = y - th;
      var cols = Math.max(3, Math.round(w / (th * rng.range(0.7, 1.1))));
      var cw = w / cols;
      for (var c = 0; c < cols; c++) {
        var x = c * cw, r = cw * 0.36;
        var acy = top + th * 0.42;
        lineD += arcPath(x + cw / 2, acy, r, Math.PI, TAU);
        lineD += 'M' + n(x + cw / 2 - r) + ' ' + n(acy) + 'L' + n(x + cw / 2 - r) + ' ' + n(y);
        lineD += 'M' + n(x + cw / 2 + r) + ' ' + n(acy) + 'L' + n(x + cw / 2 + r) + ' ' + n(y);
        /* the recess behind each arch reads as the darkest tone */
        hatchD += hatch(x + cw / 2 - r, acy, r * 2, y - acy, 74, 5.5 * u, rng, true);
        if (rng.chance(0.4)) hatchD += hatch(x + cw / 2 - r, acy, r * 2, y - acy, -70, 8 * u, rng, true);
      }
      /* cornice */
      lineD += 'M0 ' + n(top) + 'L' + n(w) + ' ' + n(top);
      lineD += 'M0 ' + n(top + 4 * u) + 'L' + n(w) + ' ' + n(top + 4 * u);
      hatchD += hatch(0, top, w, 4 * u, 30, 6 * u, rng, false);
      y = top;
    }
    s += P(hatchD, 'eH', 0.85 * u);
    s += P(lineD, 'eL', 1.8 * u);
    return s;
  }

  /** Flights of stairs zig-zagging up a shaft, serving nothing in
      particular. Each flight reverses direction and lands on the one
      above it, the way a real dog-leg stair does — the alternation is
      what makes the shaft read as deep. */
  function stairs(w, h, rng) {
    var u = w / 800, s = '';
    var lineD = '', hatchD = '', railD = '', stepD = '';
    var flights = rng.int(4, 6);
    var margin = w * 0.05, landing = w * rng.range(0.13, 0.2);
    var fh = (h * 0.9) / flights;
    var y = h * 0.96, dir = rng.chance(0.5) ? 1 : -1;

    for (var f = 0; f < flights; f++) {
      var xa = dir > 0 ? margin : w - margin;
      var xb = dir > 0 ? w - margin - landing : margin + landing;
      var y1 = y - fh, run = (xb - xa), rise = (y1 - y);

      /* stepped profile: riser, tread, riser, tread */
      var steps = Math.max(7, Math.round(Math.abs(run) / (17 * u)));
      var sr = run / steps, sv = rise / steps;
      var d = 'M' + n(xa) + ' ' + n(y);
      for (var i = 0; i < steps; i++) d += 'l0 ' + n(sv) + 'l' + n(sr) + ' 0';
      stepD += d;

      /* stringer under the treads, two lines for thickness */
      lineD += 'M' + n(xa) + ' ' + n(y) + 'L' + n(xb) + ' ' + n(y1);
      lineD += 'M' + n(xa) + ' ' + n(y + 9 * u) + 'L' + n(xb) + ' ' + n(y1 + 9 * u);

      /* soffit shading — strokes normal to the underside of the flight */
      (function (ax, ay, bx, by) {
        hatchD += contour(function (t) {
          return [ax + (bx - ax) * t, ay + 9 * u + (by - ay) * t];
        }, 0.04, 0.96, 30, function () { return dir > 0 ? 15 : -15; }, u);
      })(xa, y, xb, y1);

      /* balusters and handrail */
      for (var b = 0; b <= steps; b += 2) {
        var bx2 = xa + sr * b, by2 = y + sv * b;
        railD += 'M' + n(bx2) + ' ' + n(by2) + 'l0 ' + n(-30 * u);
      }
      railD += 'M' + n(xa) + ' ' + n(y - 30 * u) + 'L' + n(xb) + ' ' + n(y1 - 30 * u);
      railD += 'M' + n(xa) + ' ' + n(y - 26 * u) + 'L' + n(xb) + ' ' + n(y1 - 26 * u);

      /* landing slab, cantilevered off the wall */
      var lx = xb, lx2 = xb + (dir > 0 ? landing : -landing);
      lineD += 'M' + n(lx) + ' ' + n(y1) + 'L' + n(lx2) + ' ' + n(y1);
      lineD += 'M' + n(lx) + ' ' + n(y1 + 9 * u) + 'L' + n(lx2) + ' ' + n(y1 + 9 * u);
      lineD += 'M' + n(lx2) + ' ' + n(y1) + 'l0 ' + n(9 * u);
      hatchD += hatch(Math.min(lx, lx2), y1 + 9 * u, landing, 13 * u, 58, 5 * u, rng, true);
      railD += 'M' + n(lx2) + ' ' + n(y1) + 'l0 ' + n(-30 * u);

      /* corbel carrying the landing */
      lineD += 'M' + n(lx2) + ' ' + n(y1 + 9 * u) + 'L' + n(lx2 + (dir > 0 ? -18 * u : 18 * u)) + ' ' + n(y1 + 30 * u);

      y = y1; dir = -dir;
    }

    /* shaft walls the whole thing is pinned to */
    lineD += 'M' + n(margin * 0.4) + ' 0l0 ' + n(h);
    lineD += 'M' + n(w - margin * 0.4) + ' 0l0 ' + n(h);
    hatchD += hatch(0, 0, margin * 0.4, h, 72, 8 * u, rng, true);
    hatchD += hatch(w - margin * 0.4, 0, margin * 0.4, h, 108, 8 * u, rng, true);

    s += P(hatchD, 'eH', 0.85 * u);
    s += P(railD, 'eF', 1.0 * u);
    s += P(stepD, 'eL', 1.5 * u);
    s += P(lineD, 'eL', 1.9 * u);
    return s;
  }

  /** Great wheel, drum and rope — the machinery of raising things,
      carried on a braced timber frame. */
  function windlass(w, h, rng) {
    var u = w / 800, s = '';
    var cx = w * rng.range(0.36, 0.5), cy = h * rng.range(0.34, 0.44);
    var r = Math.min(w, h) * rng.range(0.26, 0.34);
    var lineD = '', hatchD = '', fineD = '';

    /* ── the wheel: rim, inner rim, felloe joints, hub, spokes ── */
    lineD += arcPath(cx, cy, r, 0, Math.PI) + arcPath(cx, cy, r, Math.PI, TAU);
    lineD += arcPath(cx, cy, r * 0.88, 0, Math.PI) + arcPath(cx, cy, r * 0.88, Math.PI, TAU);
    lineD += arcPath(cx, cy, r * 0.17, 0, Math.PI) + arcPath(cx, cy, r * 0.17, Math.PI, TAU);
    lineD += arcPath(cx, cy, r * 0.09, 0, Math.PI) + arcPath(cx, cy, r * 0.09, Math.PI, TAU);
    var spokes = rng.int(10, 16);
    for (var i = 0; i < spokes; i++) {
      var a = (TAU / spokes) * i;
      var c1 = Math.cos(a), s1 = Math.sin(a);
      /* spokes drawn as tapered pairs, not single lines */
      var off = 2.4 * u;
      fineD += 'M' + n(cx + c1 * r * 0.17 - s1 * off) + ' ' + n(cy + s1 * r * 0.17 + c1 * off) +
        'L' + n(cx + c1 * r * 0.88 - s1 * off * 0.5) + ' ' + n(cy + s1 * r * 0.88 + c1 * off * 0.5);
      fineD += 'M' + n(cx + c1 * r * 0.17 + s1 * off) + ' ' + n(cy + s1 * r * 0.17 - c1 * off) +
        'L' + n(cx + c1 * r * 0.88 + s1 * off * 0.5) + ' ' + n(cy + s1 * r * 0.88 - c1 * off * 0.5);
      /* felloe joint across the rim */
      if (i % 2 === 0) {
        fineD += 'M' + n(cx + c1 * r * 0.88) + ' ' + n(cy + s1 * r * 0.88) +
          'L' + n(cx + c1 * r) + ' ' + n(cy + s1 * r);
      }
    }
    /* rim tone, heavier on the lower right as if lit from upper left */
    hatchD += contour(function (t) {
      var a = t * TAU;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    }, 0, 1, 110, function (t) { return 3 + 13 * Math.max(0, Math.sin(t * TAU - 0.9)); }, u);

    /* ── braced timber frame ── */
    var legSpread = r * 1.5;
    [-1, 1].forEach(function (sgn) {
      var footX = cx + sgn * legSpread, topX = cx + sgn * r * 0.22;
      lineD += 'M' + n(footX) + ' ' + n(h * 0.97) + 'L' + n(topX) + ' ' + n(cy - r * 0.1);
      lineD += 'M' + n(footX + sgn * 9 * u) + ' ' + n(h * 0.97) + 'L' + n(topX + sgn * 7 * u) + ' ' + n(cy - r * 0.1);
      /* sole plate */
      lineD += 'M' + n(footX - 16 * u) + ' ' + n(h * 0.97) + 'l' + n(38 * u) + ' 0';
      hatchD += hatch(footX - 16 * u, h * 0.97, 38 * u, 8 * u, 40, 4 * u, rng, false);
    });
    /* cross braces */
    var by1 = cy + r * 0.5, by2 = h * 0.86;
    lineD += 'M' + n(cx - legSpread * 0.86) + ' ' + n(by2) + 'L' + n(cx + legSpread * 0.5) + ' ' + n(by1);
    lineD += 'M' + n(cx + legSpread * 0.86) + ' ' + n(by2) + 'L' + n(cx - legSpread * 0.5) + ' ' + n(by1);
    lineD += 'M' + n(cx - legSpread * 0.7) + ' ' + n(by2) + 'L' + n(cx + legSpread * 0.7) + ' ' + n(by2);

    /* ── rope over a head pulley, load hanging in the dark ── */
    var px = cx + r * rng.range(1.7, 2.3), py = cy - h * rng.range(0.14, 0.26);
    var pr = r * 0.17;
    lineD += arcPath(px, py, pr, 0, Math.PI) + arcPath(px, py, pr, Math.PI, TAU);
    lineD += arcPath(px, py, pr * 0.3, 0, Math.PI) + arcPath(px, py, pr * 0.3, Math.PI, TAU);
    /* pulley bracket */
    lineD += 'M' + n(px - pr) + ' ' + n(py - pr * 1.5) + 'L' + n(px + pr) + ' ' + n(py - pr * 1.5);
    lineD += 'M' + n(px - pr) + ' ' + n(py - pr * 1.5) + 'L' + n(px - pr * 0.4) + ' ' + n(py);
    lineD += 'M' + n(px + pr) + ' ' + n(py - pr * 1.5) + 'L' + n(px + pr * 0.4) + ' ' + n(py);
    /* rope: wheel tangent → sag → pulley, drawn as a doubled line */
    var sag = h * rng.range(0.06, 0.14);
    for (var o = -1; o <= 1; o += 2) {
      lineD += 'M' + n(cx) + ' ' + n(cy - r + o * 1.6 * u) +
        'Q' + n((cx + px) / 2) + ' ' + n(Math.min(cy - r, py) + sag + o * 1.6 * u) +
        ' ' + n(px) + ' ' + n(py - pr + o * 1.6 * u);
      lineD += 'M' + n(px + pr + o * 1.6 * u) + ' ' + n(py) + 'L' + n(px + pr + o * 1.6 * u) + ' ' + n(h * 0.72);
    }
    /* the load, and its cross-hatched shadow side */
    var lw = r * 0.5, ly = h * 0.72;
    lineD += 'M' + n(px + pr - lw / 2) + ' ' + n(ly) + 'l' + n(lw) + ' 0l0 ' + n(lw * 0.7) + 'l' + n(-lw) + ' 0z';
    hatchD += hatch(px + pr - lw / 2, ly, lw, lw * 0.7, 62, 5 * u, rng, true);
    hatchD += hatch(px + pr, ly, lw / 2, lw * 0.7, -58, 6 * u, rng, true);

    /* ground and the shadow the frame throws */
    fineD += 'M0 ' + n(h * 0.97) + 'L' + n(w) + ' ' + n(h * 0.97);
    hatchD += hatch(0, h * 0.97, w, h * 0.03, 12, 6 * u, rng, true);

    s += P(hatchD, 'eH', 0.85 * u);
    s += P(fineD, 'eF', 1.0 * u);
    s += P(lineD, 'eL', 1.9 * u);
    return s;
  }

  /** A shaft with ladders and staging — after the mining treatises. */
  function shaft(w, h, rng) {
    var u = w / 800, s = '';
    var sw = w * rng.range(0.3, 0.46), x0 = (w - sw) / 2 + rng.range(-w * 0.1, w * 0.1);
    var lineD = '', hatchD = '', fineD = '';
    lineD += 'M' + n(x0) + ' 0L' + n(x0) + ' ' + n(h);
    lineD += 'M' + n(x0 + sw) + ' 0L' + n(x0 + sw) + ' ' + n(h);
    /* rock walls */
    hatchD += hatch(0, 0, x0, h, 74, 7 * u, rng, true);
    hatchD += hatch(0, 0, x0 * 0.55, h, -66, 11 * u, rng, true);
    hatchD += hatch(x0 + sw, 0, w - x0 - sw, h, 106, 7 * u, rng, true);
    /* timbering */
    var levels = rng.int(5, 9);
    for (var i = 0; i <= levels; i++) {
      var y = (h / levels) * i;
      lineD += 'M' + n(x0 - 6 * u) + ' ' + n(y) + 'L' + n(x0 + sw + 6 * u) + ' ' + n(y);
      lineD += 'M' + n(x0 - 6 * u) + ' ' + n(y + 5 * u) + 'L' + n(x0 + sw + 6 * u) + ' ' + n(y + 5 * u);
      /* ladder in alternating bays */
      if (i < levels) {
        var lx = x0 + (i % 2 ? sw * 0.62 : sw * 0.16);
        var lw = sw * 0.2;
        fineD += 'M' + n(lx) + ' ' + n(y + 5 * u) + 'L' + n(lx) + ' ' + n(y + h / levels);
        fineD += 'M' + n(lx + lw) + ' ' + n(y + 5 * u) + 'L' + n(lx + lw) + ' ' + n(y + h / levels);
        var rungs = Math.max(3, Math.round((h / levels) / (11 * u)));
        for (var r2 = 1; r2 < rungs; r2++) {
          var ry = y + 5 * u + ((h / levels - 5 * u) / rungs) * r2;
          fineD += 'M' + n(lx) + ' ' + n(ry) + 'L' + n(lx + lw) + ' ' + n(ry);
        }
      }
    }
    s += P(hatchD, 'eH', 0.85 * u);
    s += P(fineD, 'eF', 1.0 * u);
    s += P(lineD, 'eL', 1.8 * u);
    return s;
  }

  /** Branching subterranean channels through rock — after the old
      cosmographies, where the earth had arteries. */
  function cavern(w, h, rng) {
    var u = w / 800, s = '';
    var lineD = '', hatchD = '', fineD = '';
    /* rock body: an irregular closed outline from value noise */
    var pts = [], N = 46;
    for (var i = 0; i < N; i++) {
      var a = (TAU / N) * i;
      var rad = (0.34 + 0.12 * H.fbm1(i * 0.4 + 3, 991, 3));
      pts.push([w * 0.5 + Math.cos(a) * w * rad, h * 0.5 + Math.sin(a) * h * rad * 1.05]);
    }
    lineD += 'M' + n(pts[0][0]) + ' ' + n(pts[0][1]);
    for (var p2 = 1; p2 < N; p2++) lineD += 'L' + n(pts[p2][0]) + ' ' + n(pts[p2][1]);
    lineD += 'z';
    /* Channels branching from a central reservoir. Drawn as tapering
       twin banks rather than single strokes, so they read as voids cut
       through rock rather than as cracks on its surface. */
    function branch(x, y, ang, len, wid, depth) {
      if (depth <= 0 || len < w * 0.015) return;
      var x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
      var bend = rng.range(-0.3, 0.3);
      var mx = (x + x2) / 2 + Math.cos(ang + 1.57) * len * bend;
      var my = (y + y2) / 2 + Math.sin(ang + 1.57) * len * bend;
      var nx = -Math.sin(ang), ny = Math.cos(ang);
      for (var o = -1; o <= 1; o += 2) {
        lineD += 'M' + n(x + nx * wid * o) + ' ' + n(y + ny * wid * o) +
          'Q' + n(mx + nx * wid * o) + ' ' + n(my + ny * wid * o) +
          ' ' + n(x2 + nx * wid * 0.62 * o) + ' ' + n(y2 + ny * wid * 0.62 * o);
      }
      /* hatch the far bank so the channel has a shaded side */
      hatchD += contour(function (t) {
        var xx = (1 - t) * (1 - t) * x + 2 * (1 - t) * t * mx + t * t * x2;
        var yy = (1 - t) * (1 - t) * y + 2 * (1 - t) * t * my + t * t * y2;
        return [xx + nx * wid, yy + ny * wid];
      }, 0.05, 0.95, 12, 5, u);
      var k = rng.int(1, 3);
      for (var b = 0; b < k; b++) {
        branch(x2, y2, ang + rng.range(-0.9, 0.9), len * rng.range(0.55, 0.8), wid * 0.66, depth - 1);
      }
    }
    var cx = w * 0.5, cy = h * 0.5, rr = w * 0.085;
    lineD += arcPath(cx, cy, rr, 0, Math.PI) + arcPath(cx, cy, rr, Math.PI, TAU);
    lineD += arcPath(cx, cy, rr * 0.72, 0, Math.PI) + arcPath(cx, cy, rr * 0.72, Math.PI, TAU);
    hatchD += contour(function (t) {
      var a = t * TAU; return [cx + Math.cos(a) * rr * 0.72, cy + Math.sin(a) * rr * 0.72];
    }, 0, 1, 44, function (t) { return 2 + 9 * Math.max(0, Math.sin(t * TAU - 1)); }, u);
    var arms = rng.int(5, 8);
    for (var a2 = 0; a2 < arms; a2++) {
      var ang = (TAU / arms) * a2 + rng.range(-0.3, 0.3);
      branch(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, ang, w * rng.range(0.11, 0.19), w * 0.016, 3);
    }
    /* strata: broken bands rather than an even grey, plus patches of
       cross-hatch where the rock turns away */
    for (var b2 = 0; b2 < 7; b2++) {
      var byy = h * (0.1 + b2 * 0.115), bh2 = h * rng.range(0.03, 0.07);
      hatchD += hatch(w * rng.range(0.06, 0.16), byy, w * rng.range(0.5, 0.82), bh2, rng.range(2, 14), 6 * u, rng, true);
    }
    hatchD += hatch(w * 0.58, h * 0.14, w * 0.3, h * 0.34, 118, 9 * u, rng, true);
    hatchD += hatch(w * 0.12, h * 0.56, w * 0.26, h * 0.3, 64, 10 * u, rng, true);
    s += P(hatchD, 'eH', 0.8 * u);
    s += P(fineD, 'eF', 1.2 * u);
    s += P(lineD, 'eL', 1.7 * u);
    return s;
  }

  /** Beam engine and gear train — machinery of unstated purpose. */
  function engine(w, h, rng) {
    var u = w / 800, s = '';
    var lineD = '', hatchD = '', fineD = '';
    function gear(gx, gy, r, teeth) {
      lineD += arcPath(gx, gy, r, 0, Math.PI) + arcPath(gx, gy, r, Math.PI, TAU);
      lineD += arcPath(gx, gy, r * 0.78, 0, Math.PI) + arcPath(gx, gy, r * 0.78, Math.PI, TAU);
      var d = '';
      for (var t = 0; t < teeth; t++) {
        var a = (TAU / teeth) * t;
        d += 'M' + n(gx + Math.cos(a) * r) + ' ' + n(gy + Math.sin(a) * r) +
          'L' + n(gx + Math.cos(a) * r * 1.1) + ' ' + n(gy + Math.sin(a) * r * 1.1);
      }
      fineD += d;
      hatchD += contour(function (tt) {
        var a = tt * TAU;
        return [gx + Math.cos(a) * r * 0.78, gy + Math.sin(a) * r * 0.78];
      }, 0, 1, 40, function (tt) { return 3 + 7 * Math.max(0, Math.sin(tt * TAU - 1.2)); }, u);
    }
    /* ── gear train, driven off a crank ── */
    var g1 = { x: w * rng.range(0.2, 0.3), y: h * rng.range(0.46, 0.58), r: Math.min(w, h) * rng.range(0.15, 0.2) };
    gear(g1.x, g1.y, g1.r, rng.int(16, 24));
    var ang = rng.range(-0.7, -0.2);
    var g2 = { x: g1.x + Math.cos(ang) * g1.r * 1.8, y: g1.y + Math.sin(ang) * g1.r * 1.8, r: g1.r * rng.range(0.5, 0.7) };
    gear(g2.x, g2.y, g2.r, rng.int(10, 15));
    var ang2 = rng.range(0.3, 0.9);
    var g3 = { x: g2.x + Math.cos(ang2) * g2.r * 1.75, y: g2.y + Math.sin(ang2) * g2.r * 1.75, r: g2.r * rng.range(0.6, 0.95) };
    gear(g3.x, g3.y, g3.r, rng.int(9, 14));
    /* bearing pedestals under each gear */
    [g1, g2, g3].forEach(function (g) {
      lineD += 'M' + n(g.x - g.r * 0.3) + ' ' + n(g.y) + 'l0 ' + n(h - g.y - h * 0.06);
      lineD += 'M' + n(g.x + g.r * 0.3) + ' ' + n(g.y) + 'l0 ' + n(h - g.y - h * 0.06);
      lineD += 'M' + n(g.x - g.r * 0.5) + ' ' + n(h - h * 0.06) + 'l' + n(g.r) + ' 0';
      hatchD += hatch(g.x - g.r * 0.3, g.y, g.r * 0.6, h - g.y - h * 0.06, 64, 6 * u, rng, true);
    });

    /* ── the beam: a hatched member on a masonry trunnion pier ── */
    var bx = w * rng.range(0.6, 0.72), by = h * rng.range(0.2, 0.3);
    var bl = w * rng.range(0.18, 0.26), tilt = rng.range(-0.2, 0.2);
    var ex1 = bx - Math.cos(tilt) * bl, ey1 = by - Math.sin(tilt) * bl;
    var ex2 = bx + Math.cos(tilt) * bl, ey2 = by + Math.sin(tilt) * bl;
    var bt = 13 * u;
    lineD += 'M' + n(ex1) + ' ' + n(ey1) + 'L' + n(ex2) + ' ' + n(ey2) +
      'L' + n(ex2) + ' ' + n(ey2 + bt) + 'L' + n(ex1) + ' ' + n(ey1 + bt) + 'z';
    /* shade along the beam itself — hatching its bounding box would
       shade a wedge of empty air above and below it */
    hatchD += contour(function (t) {
      return [ex1 + (ex2 - ex1) * t, ey1 + (ey2 - ey1) * t];
    }, 0.02, 0.98, 46, bt / u, u);
    /* trunnion */
    lineD += arcPath(bx, by + bt / 2, 7 * u, 0, Math.PI) + arcPath(bx, by + bt / 2, 7 * u, Math.PI, TAU);
    /* pier down to the floor, tapering */
    lineD += 'M' + n(bx - 14 * u) + ' ' + n(by + bt) + 'L' + n(bx - 26 * u) + ' ' + n(h - h * 0.06);
    lineD += 'M' + n(bx + 14 * u) + ' ' + n(by + bt) + 'L' + n(bx + 26 * u) + ' ' + n(h - h * 0.06);
    hatchD += hatch(bx - 26 * u, by + bt, 52 * u, h - by - bt - h * 0.06, 70, 7 * u, rng, true);
    for (var cs = 1; cs < 6; cs++) {
      var cy2 = by + bt + (h - by - bt - h * 0.06) * (cs / 6);
      fineD += 'M' + n(bx - 14 * u - 12 * u * (cs / 6)) + ' ' + n(cy2) + 'l' + n(28 * u + 24 * u * (cs / 6)) + ' 0';
    }

    /* ── cylinder and connecting rods ── */
    var cyx = ex1, cyr = 16 * u, cyTop = h * rng.range(0.5, 0.6);
    lineD += 'M' + n(cyx - cyr) + ' ' + n(cyTop) + 'l0 ' + n(h * 0.94 - cyTop) + 'l' + n(cyr * 2) + ' 0l0 ' + n(cyTop - h * 0.94) + 'z';
    lineD += 'M' + n(cyx - cyr * 1.3) + ' ' + n(cyTop) + 'l' + n(cyr * 2.6) + ' 0';
    hatchD += hatch(cyx - cyr, cyTop, cyr * 2, h * 0.94 - cyTop, 68, 5 * u, rng, true);
    hatchD += hatch(cyx + cyr * 0.3, cyTop, cyr * 0.7, h * 0.94 - cyTop, -62, 6 * u, rng, true);
    /* piston rod up to the beam end */
    lineD += 'M' + n(cyx - 2.5 * u) + ' ' + n(ey1 + bt) + 'L' + n(cyx - 2.5 * u) + ' ' + n(cyTop);
    lineD += 'M' + n(cyx + 2.5 * u) + ' ' + n(ey1 + bt) + 'L' + n(cyx + 2.5 * u) + ' ' + n(cyTop);
    /* the other end drives a crank on the first gear */
    lineD += 'M' + n(ex2) + ' ' + n(ey2 + bt) + 'L' + n(g3.x) + ' ' + n(g3.y - g3.r * 0.55);
    lineD += 'M' + n(ex2 + 3 * u) + ' ' + n(ey2 + bt) + 'L' + n(g3.x + 3 * u) + ' ' + n(g3.y - g3.r * 0.55);

    /* pipework and floor */
    for (var p = 0; p < rng.int(3, 6); p++) {
      var py = h * rng.range(0.6, 0.92);
      fineD += 'M0 ' + n(py) + 'L' + n(w) + ' ' + n(py + rng.range(-1, 1) * h * 0.02);
    }
    lineD += 'M0 ' + n(h - h * 0.06) + 'L' + n(w) + ' ' + n(h - h * 0.06);
    hatchD += hatch(0, h - h * 0.06, w, h * 0.06, 14, 7 * u, rng, true);
    hatchD += hatch(w * 0.82, h * 0.06, w * 0.18, h * 0.7, 116, 10 * u, rng, true);

    s += P(hatchD, 'eH', 0.8 * u);
    s += P(fineD, 'eF', 1.0 * u);
    s += P(lineD, 'eL', 2.0 * u);
    return s;
  }

  /** A monument standing in an empty plate — the surface register. */
  function monument(w, h, rng) {
    var u = w / 800, s = '';
    var lineD = '', hatchD = '', fineD = '';
    var cx = w * rng.range(0.4, 0.6);
    var bw = w * rng.range(0.24, 0.38), bh = h * rng.range(0.5, 0.68);
    var by = h * 0.9;
    /* stepped podium */
    for (var i = 0; i < 4; i++) {
      var pw = bw * (1.5 - i * 0.11), py = by - i * (10 * u);
      lineD += 'M' + n(cx - pw / 2) + ' ' + n(py) + 'L' + n(cx + pw / 2) + ' ' + n(py);
      lineD += 'M' + n(cx - pw / 2) + ' ' + n(py) + 'L' + n(cx - pw / 2) + ' ' + n(py - 10 * u);
      lineD += 'M' + n(cx + pw / 2) + ' ' + n(py) + 'L' + n(cx + pw / 2) + ' ' + n(py - 10 * u);
    }
    var top = by - 40 * u - bh;
    /* the mass, with a great arched opening */
    lineD += 'M' + n(cx - bw / 2) + ' ' + n(by - 40 * u) + 'L' + n(cx - bw / 2) + ' ' + n(top) +
      'L' + n(cx + bw / 2) + ' ' + n(top) + 'L' + n(cx + bw / 2) + ' ' + n(by - 40 * u);
    var ar = bw * 0.3;
    lineD += arcPath(cx, by - 40 * u - bh * 0.34, ar, Math.PI, TAU);
    lineD += 'M' + n(cx - ar) + ' ' + n(by - 40 * u - bh * 0.34) + 'L' + n(cx - ar) + ' ' + n(by - 40 * u);
    lineD += 'M' + n(cx + ar) + ' ' + n(by - 40 * u - bh * 0.34) + 'L' + n(cx + ar) + ' ' + n(by - 40 * u);
    hatchD += hatch(cx - ar, by - 40 * u - bh * 0.34, ar * 2, bh * 0.34, 78, 5 * u, rng, true);
    /* pilasters */
    var pil = rng.int(4, 7);
    for (var q = 1; q < pil; q++) {
      var px2 = cx - bw / 2 + (bw / pil) * q;
      fineD += 'M' + n(px2) + ' ' + n(top + 8 * u) + 'L' + n(px2) + ' ' + n(by - 40 * u);
    }
    /* entablature and a crowning drum */
    lineD += 'M' + n(cx - bw * 0.6) + ' ' + n(top) + 'L' + n(cx + bw * 0.6) + ' ' + n(top);
    lineD += 'M' + n(cx - bw * 0.6) + ' ' + n(top - 9 * u) + 'L' + n(cx + bw * 0.6) + ' ' + n(top - 9 * u);
    hatchD += hatch(cx - bw * 0.6, top - 9 * u, bw * 1.2, 9 * u, 34, 5 * u, rng, false);
    var dr = bw * 0.26;
    lineD += 'M' + n(cx - dr) + ' ' + n(top - 9 * u) + 'L' + n(cx - dr) + ' ' + n(top - 9 * u - dr * 1.1);
    lineD += 'M' + n(cx + dr) + ' ' + n(top - 9 * u) + 'L' + n(cx + dr) + ' ' + n(top - 9 * u - dr * 1.1);
    lineD += arcPath(cx, top - 9 * u - dr * 1.1, dr, Math.PI, TAU);
    hatchD += contour(function (t) {
      var a = Math.PI + t * Math.PI;
      return [cx + Math.cos(a) * dr, (top - 9 * u - dr * 1.1) + Math.sin(a) * dr];
    }, 0, 1, 26, function (t) { return 3 + 10 * Math.max(0, Math.sin(t * Math.PI - 0.4)); }, u);
    /* body shading and ground */
    hatchD += hatch(cx - bw / 2, top, bw * 0.34, bh, 72, 9 * u, rng, true);
    var gd = '';
    for (var gl = 0; gl < 5; gl++) {
      var gy = by + gl * (8 * u);
      if (gy > h) break;
      gd += 'M0 ' + n(gy) + 'L' + n(w) + ' ' + n(gy + rng.range(-1, 1) * 6 * u);
    }
    fineD += gd;
    s += P(hatchD, 'eH', 0.85 * u);
    s += P(fineD, 'eF', 1.0 * u);
    s += P(lineD, 'eL', 2.0 * u);
    return s;
  }

  var KINDS = {
    vault: vault, arcade: arcade, stairs: stairs, windlass: windlass,
    shaft: shaft, cavern: cavern, engine: engine, monument: monument
  };

  global.Hive.Engraving = {
    kinds: Object.keys(KINDS),
    /** Build one plate. Deterministic for a given (seed, id). */
    build: function (kind, w, h, seed, id) {
      var fn = KINDS[kind] || vault;
      var rng = rngFor(seed || 1, hashId(id || kind), 6151);
      return fn(w, h, rng);
    }
  };

  function hashId(s) {
    var v = 0;
    for (var i = 0; i < s.length; i++) v = (Math.imul(v, 31) + s.charCodeAt(i)) | 0;
    return v;
  }
})(window);
