/* ════════════════════════════════════════════════════════════════════
   architecture.js — procedural Imperial architecture

   Nothing here is hand-drawn. Every structure is generated from the
   archive seed plus its own coordinates, so the city is identical on
   every access but never repeats itself.

   All generators emit SVG source strings rather than DOM nodes: one
   innerHTML assignment per chunk is an order of magnitude cheaper than
   several hundred createElementNS calls, and the browser parses SVG
   markup very fast.

   World units are METRES. +Y is down (depth). X = 0 is the hive axis.
   ════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var H = global.Hive;
  var rngFor = H.rngFor, clamp = H.clamp, lerp = H.lerp;

  function n(v) { return Math.round(v * 10) / 10; }
  function rect(x, y, w, h, cls) {
    if (w <= 0 || h <= 0) return '';
    return '<rect class="' + cls + '" x="' + n(x) + '" y="' + n(y) + '" width="' + n(w) + '" height="' + n(h) + '"/>';
  }
  function poly(pts, cls) { return '<polygon class="' + cls + '" points="' + pts + '"/>'; }
  function path(d, cls) { return '<path class="' + cls + '" d="' + d + '"/>'; }
  function line(x1, y1, x2, y2, cls, w) {
    return '<line class="' + cls + '" x1="' + n(x1) + '" y1="' + n(y1) + '" x2="' + n(x2) + '" y2="' + n(y2) +
      '"' + (w ? ' stroke-width="' + n(w) + '"' : '') + '/>';
  }
  function lamp(x, y, r) {
    return '<circle class="glow" cx="' + n(x) + '" cy="' + n(y) + '" r="' + n(r) + '"/>';
  }

  /* ── window grids ─────────────────────────────────────────────────
     Every lit window in a building is a single <path>. A 40-storey hab
     stack costs two DOM nodes, not four hundred.                      */
  function windows(x, y, w, h, rng, opts) {
    opts = opts || {};
    var cw = opts.cw || 3.4, ch = opts.ch || 4.2;
    var gx = opts.gx || 3.2, gy = opts.gy || 5.4;
    var cols = Math.max(1, Math.floor((w - gx) / (cw + gx)));
    var rows = Math.max(1, Math.floor((h - gy) / (ch + gy)));
    if (cols * rows > 900) { // enormous facade — thin it out
      gx *= 2.2; gy *= 2.2;
      cols = Math.max(1, Math.floor((w - gx) / (cw + gx)));
      rows = Math.max(1, Math.floor((h - gy) / (ch + gy)));
    }
    var ox = x + (w - (cols * (cw + gx) - gx)) / 2;
    var oy = y + gy;
    var lit = '', dim = '', occ = opts.occ == null ? 0.55 : opts.occ;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var v = rng.next();
        if (v > occ + 0.36) continue;                    // dead window
        var wx = ox + c * (cw + gx), wy = oy + r * (ch + gy);
        var s = 'M' + n(wx) + ' ' + n(wy) + 'h' + n(cw) + 'v' + n(ch) + 'h' + n(-cw) + 'z';
        if (v < occ) lit += s; else dim += s;
      }
    }
    return (dim ? path(dim, 'winD') : '') + (lit ? path(lit, 'win') : '');
  }

  /* ── ornament: gothic buttresses, cornices, finials ───────────────── */
  function buttresses(x, y, w, h, rng, count) {
    var s = '', k = count || 3, step = h / (k + 1);
    for (var i = 1; i <= k; i++) {
      var yy = y + step * i;
      s += poly(
        n(x) + ',' + n(yy) + ' ' + n(x - w * 0.09) + ',' + n(yy + step * 0.34) + ' ' + n(x) + ',' + n(yy + step * 0.22), 'sC');
      s += poly(
        n(x + w) + ',' + n(yy) + ' ' + n(x + w + w * 0.09) + ',' + n(yy + step * 0.34) + ' ' + n(x + w) + ',' + n(yy + step * 0.22), 'sC');
    }
    return s;
  }
  function cornice(x, y, w, d) {
    return rect(x - w * 0.05, y, w * 1.1, d, 'sC');
  }
  function spireTop(x, y, w, hgt, rng) {
    var s = '';
    var cx = x + w / 2;
    s += poly(n(cx) + ',' + n(y - hgt) + ' ' + n(x) + ',' + n(y) + ' ' + n(x + w) + ',' + n(y), 'sB');
    s += line(cx, y - hgt, cx, y - hgt - hgt * 0.35, 'wire', 0.8);
    if (rng.chance(0.5)) s += rect(cx - w * 0.03, y - hgt - hgt * 0.35, w * 0.06, hgt * 0.18, 'orn');
    return s;
  }

  /* ══ BUILDING GENERATORS ═══════════════════════════════════════════
     Each returns an SVG string. `cls` picks the depth tint: sA near,
     sB mid, sC far/shadowed, sF background silhouette.               */

  function habBlock(x, y, w, h, rng, cls, opts) {
    opts = opts || {};
    var s = rect(x, y, w, h, cls);
    var bays = rng.int(1, 3);
    for (var i = 0; i < bays; i++) {
      var bw = w * rng.range(0.12, 0.3), bx = x + rng.range(0, w - bw);
      s += rect(bx, y + rng.range(0, h * 0.4), bw, h * rng.range(0.5, 1), cls === 'sA' ? 'sB' : 'sC');
    }
    s += windows(x, y, w, h, rng, { occ: opts.occ, cw: opts.cw, ch: opts.ch, gx: opts.gx, gy: opts.gy });
    s += cornice(x, y, w, Math.min(3.5, h * 0.02));
    /* roof clutter — tanks, aerials, vents */
    var k = rng.int(2, 6);
    for (var j = 0; j < k; j++) {
      var ax = x + rng.range(2, w - 4);
      var t = rng.next();
      if (t < 0.4) s += rect(ax, y - rng.range(3, 9), rng.range(2, 6), rng.range(3, 9), 'sC');
      else if (t < 0.8) s += line(ax, y, ax, y - rng.range(6, 22), 'wire', 0.7);
      else s += rect(ax, y - rng.range(4, 12), 1.4, rng.range(4, 12), 'sC');
    }
    if (opts.pipes !== false && rng.chance(0.6)) {
      var px = x + rng.range(1, w - 2);
      s += line(px, y, px, y + h, 'pipe', rng.range(1.2, 3));
    }
    return s;
  }

  function gothicTower(x, y, w, h, rng, cls) {
    var s = '';
    var tiers = rng.int(3, 6), ty = y + h, tw = w;
    /* build upward from the base in narrowing tiers */
    for (var i = 0; i < tiers; i++) {
      var th = h / tiers * rng.range(0.8, 1.15);
      var tx = x + (w - tw) / 2;
      s += rect(tx, ty - th, tw, th, i === 0 ? cls : (cls === 'sA' ? 'sA' : cls));
      s += windows(tx, ty - th, tw, th, rng, { occ: 0.45, cw: 2.6, ch: 5.6, gx: 4, gy: 8 });
      s += cornice(tx, ty - th, tw, Math.max(1.4, h * 0.006));
      s += buttresses(tx, ty - th, tw, th, rng, 2);
      ty -= th;
      tw *= rng.range(0.72, 0.9);
    }
    s += spireTop(x + (w - tw) / 2, ty, tw, tw * rng.range(1.6, 3.4), rng);
    /* flying spans to nowhere */
    if (rng.chance(0.45)) {
      var yy = y + h * rng.range(0.2, 0.7);
      var dir = rng.chance(0.5) ? 1 : -1;
      s += rect(dir > 0 ? x + w : x - w * 0.5, yy, w * 0.5, 2.2, 'sC');
    }
    return s;
  }

  function cathedral(x, y, w, h, rng, cls) {
    var s = '';
    var bodyH = h * 0.55, bodyY = y + h - bodyH;
    s += rect(x, bodyY, w, bodyH, cls);
    /* nave arches as one path */
    var arches = Math.max(3, Math.floor(w / 26)), aw = w / arches;
    var d = '';
    for (var i = 0; i < arches; i++) {
      var ax = x + i * aw + aw * 0.22, awd = aw * 0.56, ah = bodyH * 0.5;
      var ay = bodyY + bodyH * 0.42;
      d += 'M' + n(ax) + ' ' + n(ay + ah) + 'v' + n(-ah * 0.6) +
        'a' + n(awd / 2) + ' ' + n(awd / 2) + ' 0 0 1 ' + n(awd) + ' 0' +
        'v' + n(ah * 0.6) + 'z';
    }
    s += path(d, 'win');
    /* twin towers */
    var twr = w * 0.17;
    s += rect(x + w * 0.04, y + h * 0.12, twr, h * 0.88 - h * 0.12, cls);
    s += rect(x + w - w * 0.04 - twr, y + h * 0.12, twr, h * 0.88 - h * 0.12, cls);
    s += spireTop(x + w * 0.04, y + h * 0.12, twr, h * 0.16, rng);
    s += spireTop(x + w - w * 0.04 - twr, y + h * 0.12, twr, h * 0.16, rng);
    /* central spire */
    var cw = w * 0.3, cx = x + (w - cw) / 2;
    s += rect(cx, y + h * 0.2, cw, h * 0.5, cls);
    s += spireTop(cx, y + h * 0.2, cw, h * 0.42, rng);
    /* rose window */
    s += '<circle class="win" cx="' + n(x + w / 2) + '" cy="' + n(bodyY + bodyH * 0.24) + '" r="' + n(w * 0.075) + '"/>';
    s += '<circle class="edge" cx="' + n(x + w / 2) + '" cy="' + n(bodyY + bodyH * 0.24) + '" r="' + n(w * 0.1) + '"/>';
    s += buttresses(x, bodyY, w, bodyH, rng, 4);
    s += lamp(x + w / 2, bodyY + bodyH * 0.24, w * 0.5);
    return s;
  }

  function manufactorum(x, y, w, h, rng, cls) {
    var s = rect(x, y, w, h, cls);
    /* saw-tooth roof */
    var teeth = Math.max(2, Math.floor(w / 22)), tw = w / teeth, d = '';
    for (var i = 0; i < teeth; i++) {
      var tx = x + i * tw;
      d += 'M' + n(tx) + ' ' + n(y) + 'L' + n(tx + tw * 0.5) + ' ' + n(y - tw * 0.42) + 'L' + n(tx + tw) + ' ' + n(y) + 'z';
    }
    s += path(d, cls === 'sA' ? 'sB' : 'sC');
    /* chimneys */
    var ch = rng.int(2, 5);
    for (var j = 0; j < ch; j++) {
      var cx = x + rng.range(w * 0.08, w * 0.92), cwd = rng.range(3.5, 9), chh = rng.range(h * 0.25, h * 0.9);
      s += rect(cx, y - chh, cwd, chh, 'sC');
      s += rect(cx - cwd * 0.25, y - chh, cwd * 1.5, cwd * 0.7, 'sC');
      if (rng.chance(0.7)) s += '<ellipse class="smokeS" cx="' + n(cx + cwd / 2) + '" cy="' + n(y - chh - cwd * 3) +
        '" rx="' + n(cwd * 3.4) + '" ry="' + n(cwd * 3) + '"/>';
    }
    /* furnace mouths */
    var f = rng.int(1, 4), fd = '';
    for (var k = 0; k < f; k++) {
      var fx = x + rng.range(4, w - 14), fy = y + h - rng.range(6, h * 0.5);
      fd += 'M' + n(fx) + ' ' + n(fy) + 'h' + n(rng.range(6, 14)) + 'v' + n(rng.range(4, 9)) + 'h' + n(-8) + 'z';
      s += lamp(fx + 5, fy + 3, rng.range(18, 46));
    }
    s += path(fd, 'hot');
    /* gantries and pipework */
    var g = rng.int(2, 5);
    for (var m = 0; m < g; m++) {
      var gy2 = y + h * ((m + 1) / (g + 1));
      s += rect(x - w * 0.04, gy2, w * 1.08, 1.6, 'sC');
      if (rng.chance(0.5)) s += line(x + rng.range(0, w), gy2, x + rng.range(0, w), gy2 + h * 0.2, 'pipe', 2);
    }
    s += windows(x, y + h * 0.1, w, h * 0.8, rng, { occ: 0.3, cw: 5.5, ch: 3, gx: 7, gy: 11 });
    return s;
  }

  function ventStack(x, y, w, h, rng, cls) {
    var s = rect(x, y, w, h, cls);
    var rings = Math.max(2, Math.floor(h / 30)), d = '';
    for (var i = 0; i <= rings; i++) {
      var ry = y + (h / rings) * i;
      d += 'M' + n(x - w * 0.06) + ' ' + n(ry) + 'h' + n(w * 1.12) + 'v' + n(Math.max(1.2, h * 0.006)) + 'h' + n(-w * 1.12) + 'z';
    }
    s += path(d, 'sC');
    /* louvres */
    var lv = '';
    for (var j = 0; j < rings; j++) {
      var ly = y + (h / rings) * j + h / rings * 0.3;
      lv += 'M' + n(x + w * 0.2) + ' ' + n(ly) + 'h' + n(w * 0.6) + 'v' + n(h / rings * 0.22) + 'h' + n(-w * 0.6) + 'z';
    }
    s += path(lv, 'sC');
    return s;
  }

  function pipeRun(x, y, h, w, rng, cls) {
    var s = rect(x, y, w, h, cls || 'sB');
    var joints = Math.max(1, Math.floor(h / rng.range(45, 120)));
    var d = '';
    for (var i = 0; i <= joints; i++) {
      var jy = y + (h / joints) * i;
      d += 'M' + n(x - w * 0.18) + ' ' + n(jy) + 'h' + n(w * 1.36) + 'v' + n(Math.max(1.6, w * 0.22)) + 'h' + n(-w * 1.36) + 'z';
    }
    s += path(d, 'sC');
    if (rng.chance(0.4)) {
      var by = y + rng.range(0, h * 0.8), dir = rng.chance(0.5) ? 1 : -1;
      s += rect(dir > 0 ? x + w : x - rng.range(30, 90), by, rng.range(30, 90), w * 0.7, 'sC');
    }
    return s;
  }

  function bridgeSpan(x, y, w, rng, cls) {
    var th = clamp(w * 0.02, 2, 9);
    var s = rect(x, y, w, th, cls);
    s += rect(x, y + th, w, th * 0.35, 'sC');
    /* hangers or arches */
    if (rng.chance(0.5)) {
      var seg = Math.max(3, Math.floor(w / 40)), d = '';
      for (var i = 0; i <= seg; i++) {
        var hx = x + (w / seg) * i;
        d += 'M' + n(hx) + ' ' + n(y) + 'v' + n(-th * rng.range(2, 6)) + 'h1.2v' + n(th * rng.range(2, 6)) + 'z';
      }
      s += path(d, 'sC');
    } else {
      var seg2 = Math.max(2, Math.floor(w / 60)), d2 = '';
      for (var j = 0; j < seg2; j++) {
        var ax = x + (w / seg2) * j, aw = w / seg2;
        d2 += 'M' + n(ax) + ' ' + n(y + th) + 'q' + n(aw / 2) + ' ' + n(th * 5) + ' ' + n(aw) + ' 0z';
      }
      s += path(d2, 'sC');
    }
    /* lamp posts */
    var lp = Math.max(2, Math.floor(w / 70));
    for (var k = 0; k < lp; k++) {
      var lx = x + (w / lp) * (k + 0.5);
      s += line(lx, y, lx, y - 6, 'wire', 0.8);
      s += lamp(lx, y - 6, 26);
    }
    return s;
  }

  function craneRig(x, y, h, rng, cls) {
    var s = '';
    var mw = clamp(h * 0.05, 2, 7);
    s += rect(x, y, mw, h, cls);
    /* lattice */
    var steps = Math.floor(h / 14), d = '';
    for (var i = 0; i < steps; i++) {
      var sy = y + i * 14;
      d += 'M' + n(x) + ' ' + n(sy) + 'L' + n(x + mw) + ' ' + n(sy + 14) + 'M' + n(x + mw) + ' ' + n(sy) + 'L' + n(x) + ' ' + n(sy + 14);
    }
    s += '<path class="wire" d="' + d + '"/>';
    var jib = rng.range(h * 0.4, h * 0.9), dir = rng.chance(0.5) ? 1 : -1;
    var jy = y + rng.range(0, h * 0.25);
    s += rect(dir > 0 ? x : x - jib, jy, jib, mw * 0.7, cls);
    var hookX = dir > 0 ? x + jib * rng.range(0.4, 0.9) : x - jib * rng.range(0.4, 0.9);
    s += line(hookX, jy, hookX, jy + rng.range(20, h * 0.7), 'wire', 0.8);
    s += rect(hookX - 3, jy + rng.range(20, h * 0.7), 6, 4, 'sC');
    return s;
  }

  function shanty(x, y, w, h, rng, cls) {
    var s = '';
    var cells = Math.max(3, Math.floor(w / rng.range(7, 16)));
    for (var i = 0; i < cells; i++) {
      var cw = w / cells * rng.range(0.75, 1.15);
      var cx = x + (w / cells) * i;
      var chh = h * rng.range(0.3, 1);
      var cy = y + h - chh;
      s += rect(cx, cy, cw, chh, rng.chance(0.5) ? cls : 'sC');
      if (rng.chance(0.35)) {
        s += path('M' + n(cx - 1) + ' ' + n(cy) + 'h' + n(cw + 2) + 'v-1.4h' + n(-cw - 2) + 'z', 'sC');
      }
      if (rng.chance(0.4)) {
        s += path('M' + n(cx + cw * 0.3) + ' ' + n(cy + chh * 0.4) + 'h2.2v2.6h-2.2z', 'win');
        s += lamp(cx + cw * 0.3, cy + chh * 0.4, 14);
      }
      if (rng.chance(0.25)) s += line(cx + cw * 0.5, cy, cx + cw * rng.range(1.5, 3), cy - rng.range(2, 8), 'wire', 0.6);
    }
    return s;
  }

  function ruinBlock(x, y, w, h, rng, cls) {
    var s = '';
    /* a collapsed hab: jagged top profile as one polygon */
    var pts = [], steps = Math.max(4, Math.floor(w / 14));
    pts.push(n(x) + ',' + n(y + h));
    for (var i = 0; i <= steps; i++) {
      var px = x + (w / steps) * i;
      var py = y + h - h * (0.35 + 0.65 * H.fbm1(px * 0.02 + 11, 731, 3));
      pts.push(n(px) + ',' + n(py));
    }
    pts.push(n(x + w) + ',' + n(y + h));
    s += poly(pts.join(' '), cls);
    /* exposed floor plates */
    var fl = rng.int(3, 9);
    for (var j = 0; j < fl; j++) {
      var fy = y + h - (h / fl) * j * rng.range(0.8, 1.05);
      var fx = x + rng.range(0, w * 0.4), fw = rng.range(w * 0.2, w * 0.75);
      s += rect(fx, fy, Math.min(fw, x + w - fx), 1.6, 'sC');
    }
    /* rebar */
    var rb = '';
    for (var k = 0; k < 6; k++) {
      var rx = x + rng.range(0, w);
      rb += 'M' + n(rx) + ' ' + n(y + h * 0.2) + 'l' + n(rng.range(-4, 4)) + ' ' + n(-rng.range(4, 14));
    }
    s += '<path class="wire" d="' + rb + '"/>';
    if (rng.chance(0.5)) s += lamp(x + w * rng.next(), y + h * rng.range(0.4, 0.9), rng.range(20, 60));
    return s;
  }

  function machineMass(x, y, w, h, rng, cls) {
    var s = rect(x, y, w, h, cls);
    var parts = rng.int(4, 10);
    for (var i = 0; i < parts; i++) {
      var pw = rng.range(w * 0.08, w * 0.34), ph = rng.range(h * 0.15, h * 0.7);
      var px = x + rng.range(0, w - pw), py = y + rng.range(0, h - ph);
      s += rect(px, py, pw, ph, rng.chance(0.5) ? 'sB' : 'sC');
      if (rng.chance(0.4)) s += '<circle class="sC" cx="' + n(px + pw / 2) + '" cy="' + n(py + ph / 2) + '" r="' + n(Math.min(pw, ph) * 0.3) + '"/>';
    }
    var pipes = rng.int(3, 8), d = '';
    for (var j = 0; j < pipes; j++) {
      var y1 = y + rng.range(0, h);
      d += 'M' + n(x - w * 0.05) + ' ' + n(y1) + 'h' + n(w * 1.1);
    }
    s += '<path class="pipe" stroke-width="' + n(clamp(w * 0.008, 1, 3)) + '" d="' + d + '"/>';
    return s;
  }

  function ancientForm(x, y, w, h, rng, cls) {
    /* Deliberately non-Gothic: no windows, no joints, no wear.
       Long unbroken faces and shallow incisions.                      */
    var s = '';
    var style = rng.int(0, 3);
    if (style === 0) {
      s += poly(n(x) + ',' + n(y + h) + ' ' + n(x + w * 0.16) + ',' + n(y) + ' ' +
        n(x + w * 0.84) + ',' + n(y) + ' ' + n(x + w) + ',' + n(y + h), 'anomF');
    } else if (style === 1) {
      s += rect(x, y, w, h, 'anomF');
      s += poly(n(x) + ',' + n(y) + ' ' + n(x + w) + ',' + n(y) + ' ' + n(x + w * 0.5) + ',' + n(y - h * 0.22), 'anomF');
    } else if (style === 2) {
      s += '<ellipse class="anomF" cx="' + n(x + w / 2) + '" cy="' + n(y + h / 2) + '" rx="' + n(w / 2) + '" ry="' + n(h / 2) + '"/>';
    } else {
      s += rect(x, y, w, h, 'anomF');
      s += rect(x + w * 0.2, y - h * 0.1, w * 0.6, h * 1.2, 'anomF');
    }
    /* incisions — faint, perfectly regular, meaningless */
    var k = rng.int(3, 8), d = '';
    for (var i = 0; i < k; i++) {
      var iy = y + (h / (k + 1)) * (i + 1);
      d += 'M' + n(x + w * 0.12) + ' ' + n(iy) + 'h' + n(w * 0.76);
    }
    s += '<path class="anom" d="' + d + '"/>';
    if (rng.chance(0.35)) {
      s += '<circle class="anom" cx="' + n(x + w / 2) + '" cy="' + n(y + h * rng.range(0.3, 0.7)) + '" r="' + n(w * rng.range(0.08, 0.2)) + '"/>';
    }
    return s;
  }

  function tunnelMouth(x, y, w, h, rng, cls) {
    var s = rect(x, y, w, h, cls);
    var d = 'M' + n(x + w * 0.15) + ' ' + n(y + h) +
      'v' + n(-h * 0.55) + 'a' + n(w * 0.35) + ' ' + n(h * 0.4) + ' 0 0 1 ' + n(w * 0.7) + ' 0v' + n(h * 0.55) + 'z';
    s += path(d, 'sL');
    s += '<path class="edge" d="' + d + '"/>';
    /* rails */
    s += rect(x + w * 0.24, y + h - 2.4, w * 0.52, 1.1, 'sC');
    s += rect(x + w * 0.28, y + h - 4.2, w * 0.44, 1.1, 'sC');
    if (rng.chance(0.5)) s += lamp(x + w * 0.5, y + h * 0.62, w * 0.35);
    return s;
  }

  function reactorHall(x, y, w, h, rng, cls) {
    var s = rect(x, y, w, h, cls);
    var cr = Math.min(w, h) * 0.3, cx = x + w / 2, cy = y + h * 0.5;
    s += '<circle class="sC" cx="' + n(cx) + '" cy="' + n(cy) + '" r="' + n(cr) + '"/>';
    s += '<circle class="hot" cx="' + n(cx) + '" cy="' + n(cy) + '" r="' + n(cr * 0.45) + '"/>';
    s += lamp(cx, cy, cr * 4.2);
    var arms = 8, d = '';
    for (var i = 0; i < arms; i++) {
      var a = (Math.PI * 2 / arms) * i;
      d += 'M' + n(cx + Math.cos(a) * cr) + ' ' + n(cy + Math.sin(a) * cr) +
        'L' + n(cx + Math.cos(a) * cr * 2.1) + ' ' + n(cy + Math.sin(a) * cr * 2.1);
    }
    s += '<path class="pipe" stroke-width="' + n(cr * 0.14) + '" d="' + d + '"/>';
    s += rect(x, y, w, Math.max(2, h * 0.04), 'sC');
    s += rect(x, y + h - Math.max(2, h * 0.04), w, Math.max(2, h * 0.04), 'sC');
    return s;
  }

  /* Monuments along the datum. Three forms so a plaza does not read as
     a row of identical chess pieces. */
  function statue(x, y, hgt, rng, cls) {
    var w = hgt * 0.26, s = '';
    var form = rng.int(0, 2);
    s += rect(x - w * 0.95, y - hgt * 0.1, w * 1.9, hgt * 0.14, cls);      // plinth
    if (form === 0) {
      /* robed figure, arms outstretched */
      s += rect(x - w * 0.3, y - hgt * 0.78, w * 0.6, hgt * 0.7, cls);
      s += '<circle class="' + cls + '" cx="' + n(x) + '" cy="' + n(y - hgt * 0.85) + '" r="' + n(w * 0.22) + '"/>';
      s += poly(n(x - w * 1.1) + ',' + n(y - hgt * 0.56) + ' ' + n(x) + ',' + n(y - hgt * 0.68) + ' ' +
        n(x + w * 1.1) + ',' + n(y - hgt * 0.56) + ' ' + n(x) + ',' + n(y - hgt * 0.46), cls);
    } else if (form === 1) {
      /* votive obelisk */
      s += poly(n(x - w * 0.34) + ',' + n(y - hgt * 0.1) + ' ' + n(x - w * 0.18) + ',' + n(y - hgt * 0.94) + ' ' +
        n(x + w * 0.18) + ',' + n(y - hgt * 0.94) + ' ' + n(x + w * 0.34) + ',' + n(y - hgt * 0.1), cls);
      s += poly(n(x) + ',' + n(y - hgt * 1.06) + ' ' + n(x - w * 0.18) + ',' + n(y - hgt * 0.94) + ' ' +
        n(x + w * 0.18) + ',' + n(y - hgt * 0.94), 'orn');
    } else {
      /* commemorative column with capital */
      s += rect(x - w * 0.2, y - hgt * 0.84, w * 0.4, hgt * 0.74, cls);
      s += rect(x - w * 0.42, y - hgt * 0.92, w * 0.84, hgt * 0.09, cls);
      s += rect(x - w * 0.22, y - hgt * 1.02, w * 0.44, hgt * 0.1, cls);
      s += line(x, y - hgt * 1.02, x, y - hgt * 1.2, 'wire', 0.9);
    }
    return s;
  }

  /* ══ THE BACKBONE ══════════════════════════════════════════════════
     Load columns, conduit mains and the great exchange shaft run the
     entire 45 km. Their x positions are fixed for the whole city, so
     chunk boundaries are invisible and the eye reads one continuous
     structure rather than a stack of tiles.                          */
  var backboneCache = null;
  function backboneSpec(city) {
    if (backboneCache && backboneCache.seed === city.seed) return backboneCache;
    var rng = rngFor(city.seed, 9001, 1);
    var cols = [];
    for (var i = -7; i <= 7; i++) {
      cols.push({
        x: i * 210 + rng.range(-42, 42),
        w: rng.range(14, 46),
        kind: rng.next(),
        seed: rng.int(1, 1e6)
      });
    }
    backboneCache = { seed: city.seed, cols: cols };
    return backboneCache;
  }

  function backbone(city, y0, y1, xMin, xMax, env) {
    if (y1 <= -60) return '';          // nothing structural above the datum
    var spec = backboneSpec(city), s = '';
    y0 = Math.max(y0, -60);
    var h = y1 - y0;
    for (var i = 0; i < spec.cols.length; i++) {
      var c = spec.cols[i];
      if (c.x + c.w * 2 < xMin || c.x - c.w * 2 > xMax) continue;
      var rng = rngFor(c.seed, Math.floor(y0 / 250), 3);
      if (c.kind < 0.45) {
        /* structural load column */
        s += rect(c.x, y0, c.w, h, 'sC');
        var bands = Math.max(1, Math.floor(h / 62)), d = '';
        for (var b = 0; b <= bands; b++) {
          var by = y0 + (h / bands) * b;
          d += 'M' + n(c.x - c.w * 0.14) + ' ' + n(by) + 'h' + n(c.w * 1.28) + 'v3h' + n(-c.w * 1.28) + 'z';
        }
        s += path(d, 'sB');
      } else if (c.kind < 0.78) {
        /* conduit bundle */
        var tubes = 3;
        for (var t = 0; t < tubes; t++) {
          var tw = c.w / (tubes + 0.6);
          s += rect(c.x + t * tw * 1.15, y0, tw, h, t === 1 ? 'sB' : 'sC');
        }
        var jd = '', jn = Math.max(1, Math.floor(h / 95));
        for (var j = 0; j <= jn; j++) {
          var jy = y0 + (h / jn) * j;
          jd += 'M' + n(c.x - 3) + ' ' + n(jy) + 'h' + n(c.w + 6) + 'v5h' + n(-c.w - 6) + 'z';
        }
        s += path(jd, 'sC');
      } else {
        /* transit / lift shaft — with a car somewhere in it */
        s += rect(c.x, y0, c.w, h, 'sC');
        s += rect(c.x + c.w * 0.2, y0, c.w * 0.6, h, 'sL');
        var carY = y0 + rng.range(0, h - 12);
        s += rect(c.x + c.w * 0.15, carY, c.w * 0.7, 11, 'sB');
        s += path('M' + n(c.x + c.w * 0.25) + ' ' + n(carY + 3) + 'h' + n(c.w * 0.5) + 'v4h' + n(-c.w * 0.5) + 'z', 'win');
        s += lamp(c.x + c.w / 2, carY + 5, 34);
      }
    }
    return s;
  }

  /* ══ STRATUM COMPOSERS ═════════════════════════════════════════════
     One per architectural layer. Each fills a 250 m chunk band.      */

  var CH = 250; // chunk height in metres

  /* ── the skyline ──────────────────────────────────────────────────
     The spires above the datum are up to 1.8 km tall and therefore span
     many chunks. Rather than redrawing a whole tower in every chunk
     that touches it, each tower's silhouette is defined as a function
     of depth and a chunk emits only its own slice. The result is a
     genuinely continuous skyline with no seams and no duplicate work. */
  function towerProfile(city, i) {
    var r = rngFor(city.seed, i, 55);
    var baseW = r.range(70, 210);
    var top = -r.range(280, 1260);
    var base = 620;
    var nT = r.int(4, 7), tiers = [], w = baseW;
    for (var t = 0; t < nT; t++) { tiers.push(w); w *= r.range(0.68, 0.87); }
    return {
      x: i * 270 + r.range(-80, 80),
      top: top, base: base, tiers: tiers, baseW: baseW,
      spire: Math.min(tiers[nT - 1] * r.range(1.4, 2.6), 190),
      lit: r.range(0.3, 0.6),
      cath: r.chance(0.22),
      seed: r.int(1, 1e6)
    };
  }

  function skyline(city, y0, y1, xMin, xMax) {
    var far = '', mid = '';
    var i0 = Math.floor(xMin / 270) - 1, i1 = Math.ceil(xMax / 270) + 1;
    for (var i = i0; i <= i1; i++) {
      var T = towerProfile(city, i);
      if (T.x + T.baseW < xMin - 100 || T.x - T.baseW > xMax + 100) continue;
      if (y0 > T.base || y1 < T.top - T.spire) continue;
      var into = ((i % 3) + 3) % 3;               // stable near/far assignment
      var cls = into === 0 ? 'sF' : 'sB';
      var bucket = into === 0 ? 'far' : 'mid';
      var s = '';
      var span = T.base - T.top, seg = span / T.tiers.length;
      var rng = rngFor(T.seed, Math.floor(y0 / CH), 5);
      for (var t = 0; t < T.tiers.length; t++) {
        /* tiers are indexed from the top downward: widest at the base */
        var segTop = T.top + seg * t, segBot = segTop + seg;
        if (segBot < y0 - 4 || segTop > y1 + 4) continue;
        var w = T.tiers[T.tiers.length - 1 - t];
        var cx = T.x, x = cx - w / 2;
        var a = Math.max(segTop, y0 - 4), b = Math.min(segBot, y1 + 4);
        s += rect(x, a, w, b - a, cls);
        s += windows(x, a, w, b - a, rng, { occ: T.lit, cw: 2.8, ch: 5.2, gx: 4.4, gy: 8.5 });
        if (segTop >= y0 - 4 && segTop <= y1 + 4) {
          s += cornice(x, segTop, w, 3.4);
          s += buttresses(x, segTop, w, Math.min(seg, y1 - segTop), rng, 2);
        }
      }
      /* crown */
      if (T.top >= y0 - T.spire - 4 && T.top <= y1 + 4) {
        var tw = T.tiers[T.tiers.length - 1];
        s += spireTop(T.x - tw / 2, T.top, tw, T.spire, rng);
        if (T.cath) {
          s += '<circle class="win" cx="' + n(T.x) + '" cy="' + n(T.top + 46) + '" r="' + n(tw * 0.16) + '"/>';
          s += lamp(T.x, T.top + 46, tw * 1.5);
        }
        s += lamp(T.x, T.top - T.spire * 0.5, tw * 1.1);
      }
      if (bucket === 'far') far += s; else mid += s;
    }
    return { far: far, mid: mid };
  }

  function composeSurface(city, y0, y1, xMin, xMax, rng, env) {
    var sk = skyline(city, y0, y1, xMin, xMax);
    var far = sk.far, mid = sk.mid, near = '';

    /* the datum: ground slab, plaza, monuments */
    if (y0 <= 40 && y1 >= -20) {
      near += rect(xMin - 200, 0, (xMax - xMin) + 400, 30, 'sB');
      near += rect(xMin - 200, 30, (xMax - xMin) + 400, 8, 'sC');
      var sc = Math.floor((xMax - xMin) / 110);
      for (var s2 = 0; s2 <= sc; s2++) {
        var r3 = rngFor(city.seed, s2 + Math.floor(xMin / 110), 77);
        var sx = xMin + s2 * 110 + r3.range(-28, 28);
        near += statue(sx, 0, r3.range(16, 46), r3, 'sB');
        if (r3.chance(0.3)) near += lamp(sx, -20, 60);
      }
    }

    /* everything below the datum in this layer is dense low city */
    if (y1 > -30) {
      var slots = Math.floor((xMax - xMin) / 190) + 1;
      for (var k = 0; k <= slots; k++) {
        var rr = rngFor(city.seed, Math.floor(xMin / 190) + k, Math.floor(y0 / CH) * 31);
        var x = xMin + k * 190 + rr.range(-50, 50);
        var w = rr.range(70, 190);
        var top = Math.max(y0 + rr.range(-90, 70), 10);
        var hh = rr.range(160, 460);
        var body, tgt = rr.next();
        var cls = tgt < 0.45 ? 'sB' : 'sA';
        if (rr.chance(0.26)) body = cathedral(x, top, w * 1.5, hh * 1.2, rr, cls);
        else if (rr.chance(0.4)) body = gothicTower(x, top, w, hh, rr, cls);
        else body = habBlock(x, top, w, hh, rr, cls, { occ: 0.62 });
        if (cls === 'sB') mid += body; else near += body;
        if (rr.chance(0.4)) mid += bridgeSpan(x - 70, top + hh * rr.range(0.25, 0.85), rr.range(150, 360), rr, 'sB');
      }
    }
    return { far: far, mid: mid, near: near };
  }

  function composeUpper(city, y0, y1, xMin, xMax, rng, env) {
    var far = '', mid = '', near = '';
    var slots = Math.floor((xMax - xMin) / 130) + 1;
    for (var k = 0; k <= slots; k++) {
      var rr = rngFor(city.seed, Math.floor(xMin / 130) + k, Math.floor(y0 / CH) * 47);
      var x = xMin + k * 130 + rr.range(-34, 34);
      var w = rr.range(55, 150);
      var top = y0 + rr.range(-140, 90);
      var hh = rr.range(150, 430);
      var t = rr.next();
      var target = t < 0.34 ? 'far' : (t < 0.74 ? 'mid' : 'near');
      var cls = target === 'far' ? 'sF' : target === 'mid' ? 'sB' : 'sA';
      var body;
      var pick = rr.next();
      if (pick < 0.12) body = cathedral(x, top, w * 1.2, hh, rr, cls);
      else if (pick < 0.34) body = gothicTower(x, top, w, hh, rr, cls);
      else body = habBlock(x, top, w, hh, rr, cls, { occ: 0.55, cw: 3, ch: 3.6, gx: 2.6, gy: 4.2 });
      if (target === 'far') far += body; else if (target === 'mid') mid += body; else near += body;
      if (rr.chance(0.5)) mid += bridgeSpan(x - rr.range(40, 130), top + hh * rr.range(0.15, 0.9), rr.range(110, 300), rr, 'sB');
      if (rr.chance(0.3)) near += pipeRun(x + w * rr.next(), y0 - 30, CH + 60, rr.range(3, 9), rr, 'sB');
    }
    /* transit tube crossing the whole slice */
    var tr = rngFor(city.seed, Math.floor(y0 / CH), 991);
    if (tr.chance(0.35)) {
      var ty = y0 + tr.range(20, CH - 30);
      mid += rect(xMin - 100, ty, (xMax - xMin) + 200, tr.range(7, 14), 'sB');
      var wd = '';
      for (var w2 = 0; w2 < 24; w2++) {
        var wx = xMin + ((xMax - xMin) / 24) * w2 + 4;
        wd += 'M' + n(wx) + ' ' + n(ty + 2.4) + 'h6v3.6h-6z';
      }
      mid += path(wd, 'win');
    }
    return { far: far, mid: mid, near: near };
  }

  function composeMid(city, y0, y1, xMin, xMax, rng, env) {
    var far = '', mid = '', near = '';
    var slots = Math.floor((xMax - xMin) / 165) + 1;
    for (var k = 0; k <= slots; k++) {
      var rr = rngFor(city.seed, Math.floor(xMin / 165) + k, Math.floor(y0 / CH) * 59);
      var x = xMin + k * 165 + rr.range(-44, 44);
      var w = rr.range(80, 220);
      var top = y0 + rr.range(-120, 100);
      var hh = rr.range(120, 340);
      var t = rr.next();
      var target = t < 0.36 ? 'far' : (t < 0.76 ? 'mid' : 'near');
      var cls = target === 'far' ? 'sF' : target === 'mid' ? 'sB' : 'sA';
      var pick = rr.next(), body;
      if (pick < 0.46) body = manufactorum(x, top, w, hh, rr, cls);
      else if (pick < 0.62) body = ventStack(x, top - 60, w * 0.5, hh + 120, rr, cls);
      else if (pick < 0.78) body = habBlock(x, top, w * 0.7, hh, rr, cls, { occ: 0.4, cw: 2.4, ch: 2.8, gx: 2.4, gy: 3.6 });
      else body = machineMass(x, top, w, hh * 0.7, rr, cls);
      if (target === 'far') far += body; else if (target === 'mid') mid += body; else near += body;
      if (rr.chance(0.55)) mid += pipeRun(x + rr.range(0, w), y0 - 40, CH + 80, rr.range(4, 14), rr, 'sB');
      if (rr.chance(0.4)) near += craneRig(x + rr.range(0, w), top - rr.range(20, 80), rr.range(90, 240), rr, 'sA');
      if (rr.chance(0.35)) mid += bridgeSpan(x - rr.range(30, 120), top + hh * rr.range(0.2, 0.9), rr.range(120, 340), rr, 'sB');
    }
    /* horizontal pipe mains */
    var pr = rngFor(city.seed, Math.floor(y0 / CH), 313);
    var pc = pr.int(1, 4);
    for (var p = 0; p < pc; p++) {
      var py = y0 + pr.range(0, CH);
      var pw = pr.range(3, 16);
      near += rect(xMin - 120, py, (xMax - xMin) + 240, pw, 'sC');
      if (pr.chance(0.5)) near += '<ellipse class="smokeS" cx="' + n(xMin + (xMax - xMin) * pr.next()) + '" cy="' + n(py) + '" rx="60" ry="26"/>';
    }
    return { far: far, mid: mid, near: near };
  }

  function composeLower(city, y0, y1, xMin, xMax, rng, env) {
    var far = '', mid = '', near = '';
    var slots = Math.floor((xMax - xMin) / 180) + 1;
    for (var k = 0; k <= slots; k++) {
      var rr = rngFor(city.seed, Math.floor(xMin / 180) + k, Math.floor(y0 / CH) * 71);
      var x = xMin + k * 180 + rr.range(-50, 50);
      var w = rr.range(90, 260);
      var top = y0 + rr.range(-140, 110);
      var hh = rr.range(110, 320);
      var t = rr.next();
      var target = t < 0.4 ? 'far' : (t < 0.78 ? 'mid' : 'near');
      var cls = target === 'far' ? 'sF' : target === 'mid' ? 'sB' : 'sA';
      var pick = rr.next(), body;
      if (pick < 0.34) body = manufactorum(x, top, w, hh, rr, cls);
      else if (pick < 0.52) body = machineMass(x, top, w, hh * 0.8, rr, cls);
      else if (pick < 0.7) body = ruinBlock(x, top, w, hh, rr, cls);
      else if (pick < 0.86) body = habBlock(x, top, w * 0.65, hh, rr, cls, { occ: 0.22, cw: 2.2, ch: 2.4, gx: 2.6, gy: 3.8 });
      else body = reactorHall(x, top, w, hh * 0.6, rr, cls);
      if (target === 'far') far += body; else if (target === 'mid') mid += body; else near += body;
      if (rr.chance(0.7)) mid += pipeRun(x + rr.range(0, w), y0 - 40, CH + 80, rr.range(6, 22), rr, 'sB');
      if (rr.chance(0.35)) near += craneRig(x + rr.range(0, w), top - rr.range(10, 60), rr.range(80, 200), rr, 'sA');
      if (rr.chance(0.25)) near += shanty(x, top - rr.range(10, 40), w * 0.8, rr.range(20, 50), rr, 'sA');
    }
    var pr = rngFor(city.seed, Math.floor(y0 / CH), 517);
    var pc = pr.int(2, 5);
    for (var p = 0; p < pc; p++) {
      var py = y0 + pr.range(0, CH);
      near += rect(xMin - 120, py, (xMax - xMin) + 240, pr.range(4, 22), 'sC');
    }
    return { far: far, mid: mid, near: near };
  }

  function composeUnderhive(city, y0, y1, xMin, xMax, rng, env) {
    var far = '', mid = '', near = '';
    var slots = Math.floor((xMax - xMin) / 210) + 1;
    for (var k = 0; k <= slots; k++) {
      var rr = rngFor(city.seed, Math.floor(xMin / 210) + k, Math.floor(y0 / CH) * 83);
      var x = xMin + k * 210 + rr.range(-60, 60);
      var w = rr.range(90, 280);
      var top = y0 + rr.range(-120, 130);
      var hh = rr.range(80, 260);
      var t = rr.next();
      var target = t < 0.44 ? 'far' : (t < 0.8 ? 'mid' : 'near');
      var cls = target === 'far' ? 'sF' : target === 'mid' ? 'sB' : 'sA';
      var pick = rr.next(), body;
      if (pick < 0.34) body = ruinBlock(x, top, w, hh, rr, cls);
      else if (pick < 0.52) body = shanty(x, top + hh * 0.5, w, hh * 0.5, rr, cls);
      else if (pick < 0.66) body = tunnelMouth(x, top, w * 0.6, hh * 0.6, rr, cls);
      else if (pick < 0.82) body = machineMass(x, top, w * 0.8, hh, rr, cls);
      else body = pipeRun(x, y0 - 60, CH + 120, rr.range(20, 70), rr, cls);
      if (target === 'far') far += body; else if (target === 'mid') mid += body; else near += body;
      if (rr.chance(0.5)) mid += pipeRun(x + rr.range(0, w), y0 - 60, CH + 120, rr.range(8, 34), rr, 'sB');
      if (rr.chance(0.22)) near += lamp(x + rr.range(0, w), top + rr.range(0, hh), rr.range(30, 90));
    }
    /* collapsed strata — diagonal debris planes */
    var dr = rngFor(city.seed, Math.floor(y0 / CH), 617);
    if (dr.chance(0.45)) {
      var dy = y0 + dr.range(0, CH);
      var tilt = dr.range(-40, 40);
      mid += poly(
        n(xMin - 100) + ',' + n(dy) + ' ' + n(xMax + 100) + ',' + n(dy + tilt) + ' ' +
        n(xMax + 100) + ',' + n(dy + tilt + dr.range(6, 26)) + ' ' + n(xMin - 100) + ',' + n(dy + dr.range(6, 26)), 'sC');
    }
    return { far: far, mid: mid, near: near };
  }

  function composeForgotten(city, y0, y1, xMin, xMax, rng, env) {
    var far = '', mid = '', near = '';
    var slots = Math.floor((xMax - xMin) / 330) + 1;
    for (var k = 0; k <= slots; k++) {
      var rr = rngFor(city.seed, Math.floor(xMin / 330) + k, Math.floor(y0 / CH) * 97);
      if (rr.chance(0.34)) continue; // emptiness is the point
      var x = xMin + k * 330 + rr.range(-90, 90);
      var w = rr.range(120, 400);
      var top = y0 + rr.range(-160, 120);
      var hh = rr.range(140, 460);
      var t = rr.next();
      var target = t < 0.5 ? 'far' : (t < 0.85 ? 'mid' : 'near');
      var cls = target === 'far' ? 'sF' : target === 'mid' ? 'sB' : 'sA';
      var pick = rr.next(), body;
      if (pick < 0.55) body = ancientForm(x, top, w, hh, rr, cls);
      else if (pick < 0.72) body = ruinBlock(x, top, w, hh * 0.6, rr, cls);
      else if (pick < 0.88) body = machineMass(x, top, w * 0.7, hh * 0.5, rr, cls);
      else body = tunnelMouth(x, top, w * 0.5, hh * 0.4, rr, cls);
      if (target === 'far') far += body; else if (target === 'mid') mid += body; else near += body;
      if (rr.chance(0.18)) near += lamp(x + rr.range(0, w), top + rr.range(0, hh), rr.range(40, 120));
    }
    return { far: far, mid: mid, near: near };
  }

  function composeUnknown(city, y0, y1, xMin, xMax, rng, env) {
    var far = '', mid = '', near = '';
    var rr = rngFor(city.seed, Math.floor(y0 / CH), 1237);
    var count = rr.int(0, 2);
    for (var i = 0; i < count; i++) {
      var x = xMin + rr.range(0, xMax - xMin) - 200;
      var w = rr.range(200, 700);
      var top = y0 + rr.range(-100, 150);
      var hh = rr.range(180, 700);
      var body = ancientForm(x, top, w, hh, rr, 'sB');
      if (rr.chance(0.5)) far += body; else mid += body;
    }
    /* faint regular geometry, far off, mostly not there */
    if (rr.chance(0.5)) {
      var gy = y0 + rr.range(0, CH), d = '';
      for (var j = 0; j < 5; j++) {
        d += 'M' + n(xMin - 100) + ' ' + n(gy + j * 26) + 'h' + n((xMax - xMin) + 200);
      }
      far += '<path class="anom" style="stroke-opacity:.14" d="' + d + '"/>';
    }
    if (rr.chance(0.3)) near += lamp(xMin + rr.range(0, xMax - xMin), y0 + rr.range(0, CH), rr.range(60, 180));
    return { far: far, mid: mid, near: near };
  }

  var COMPOSERS = {
    surface: composeSurface,
    upper: composeUpper,
    mid: composeMid,
    lower: composeLower,
    underhive: composeUnderhive,
    forgotten: composeForgotten,
    unknown: composeUnknown
  };

  /* ══ INTERACTIVE STRUCTURES ════════════════════════════════════════ */
  function drawStructure(def, city) {
    var rng = rngFor(city.seed, def._i * 7919, 4242);
    var x = -def.w / 2, y = 0, w = def.w, h = def.h;
    var s = '';
    switch (def.kind) {
      case 'cathedral': s = cathedral(x, y, w, h, rng, 'sA'); break;
      case 'admin':
        s = rect(x, y, w, h, 'sA') + windows(x, y, w, h, rng, { occ: .5, cw: 2.4, ch: 3, gx: 3, gy: 5 });
        for (var i = 1; i < 6; i++) s += cornice(x, y + h * i / 6, w, 3);
        s += buttresses(x, y, w, h, rng, 5) + spireTop(x + w * 0.35, y, w * 0.3, w * 0.5, rng);
        break;
      case 'hab': s = habBlock(x, y, w, h, rng, 'sA', { occ: .48 }); break;
      case 'plaza':
        s = rect(x, y, w, h * 0.4, 'sA') + rect(x, y + h * 0.4, w, h * 0.15, 'sC');
        for (var p = 0; p < 7; p++) s += statue(x + w * (p + 0.5) / 7, y, h * 0.9, rng, 'sB');
        s += lamp(x + w / 2, y, w * 0.6);
        break;
      case 'transit':
        s = rect(x, y, w, h, 'sA');
        for (var t = 0; t < 5; t++) {
          s += rect(x, y + h * (t + 0.5) / 5, w, 2.4, 'sC');
          s += path('M' + n(x + w * 0.1) + ' ' + n(y + h * (t + 0.5) / 5 - 5) + 'h' + n(w * 0.8) + 'v4h' + n(-w * 0.8) + 'z', 'win');
        }
        s += tunnelMouth(x - w * 0.1, y + h * 0.6, w * 0.3, h * 0.4, rng, 'sB');
        s += lamp(x + w / 2, y + h / 2, w * 0.8);
        break;
      case 'bridge': s = bridgeSpan(x, y + h * 0.4, w, rng, 'sA'); break;
      case 'factory': s = manufactorum(x, y, w, h, rng, 'sA'); break;
      case 'vent': s = ventStack(x, y, w, h, rng, 'sA'); break;
      case 'market':
        s = shanty(x, y + h * 0.35, w, h * 0.65, rng, 'sA') + rect(x, y + h * 0.3, w, 3, 'sC');
        for (var m = 0; m < 9; m++) s += lamp(x + w * (m + 0.5) / 9, y + h * 0.6, 40);
        break;
      case 'reactor': s = reactorHall(x, y, w, h, rng, 'sA'); break;
      case 'crane':
        s = '';
        for (var c = 0; c < 4; c++) s += craneRig(x + w * (c + 0.5) / 4, y, h, rng, 'sA');
        s += rect(x, y + h * 0.9, w, 5, 'sC');
        break;
      case 'waste':
        s = machineMass(x, y, w, h, rng, 'sA');
        s += rect(x - 20, y + h, w + 40, 14, 'sC');
        for (var v = 0; v < 5; v++) s += '<ellipse class="smokeS" cx="' + n(x + w * (v + .5) / 5) + '" cy="' + n(y - 30) + '" rx="70" ry="40"/>';
        break;
      case 'ruin': s = ruinBlock(x, y, w, h, rng, 'sA'); break;
      case 'tunnel': s = tunnelMouth(x, y, w, h, rng, 'sA'); break;
      case 'shanty': s = shanty(x, y, w, h, rng, 'sA'); break;
      case 'pipe': s = pipeRun(x, y, h, w, rng, 'sA'); break;
      case 'sump':
        s = rect(x, y + h * 0.45, w, h * 0.55, 'sC');
        var wv = 'M' + n(x) + ' ' + n(y + h * 0.45);
        for (var q = 0; q <= 12; q++) wv += 'q' + n(w / 24) + ' ' + (q % 2 ? 5 : -5) + ' ' + n(w / 12) + ' 0';
        s += '<path class="anom" style="stroke-opacity:.3" d="' + wv + '"/>';
        s += lamp(x + w * 0.3, y + h * 0.5, w * 0.3);
        break;
      case 'machine': s = machineMass(x, y, w, h, rng, 'sA'); break;
      case 'door':
        s = rect(x, y, w, h, 'sC');
        s += rect(x + w * 0.06, y + h * 0.05, w * 0.88, h * 0.9, 'anomF');
        s += line(x + w / 2, y + h * 0.05, x + w / 2, y + h * 0.95, 'anom', 2);
        s += '<circle class="anom" cx="' + n(x + w / 2) + '" cy="' + n(y + h * 0.5) + '" r="' + n(w * 0.18) + '"/>';
        for (var sl = 0; sl < 6; sl++) s += rect(x - 8, y + h * (sl + .5) / 6, w + 16, 6, 'sB');
        break;
      case 'ancient': s = ancientForm(x, y, w, h, rng, 'sA'); break;
      case 'anomaly':
        s = ancientForm(x, y, w, h, rng, 'sA');
        s += '<path class="anom" style="stroke-opacity:.25" d="M' + n(x) + ' ' + n(y) + 'L' + n(x + w) + ' ' + n(y + h) +
          'M' + n(x + w) + ' ' + n(y) + 'L' + n(x) + ' ' + n(y + h) + '"/>';
        break;
      case 'floor':
        s = rect(x, y, w, h, 'sC') + rect(x, y, w, 6, 'sB');
        var fd = '';
        for (var f2 = 0; f2 < 20; f2++) fd += 'M' + n(x + w * f2 / 20) + ' ' + n(y + 6) + 'v' + n(h - 6);
        s += '<path class="wire" d="' + fd + '"/>';
        break;
      case 'tether':
        s = rect(x + w * 0.35, y - 600, w * 0.3, h + 600, 'sA');
        s += rect(x, y + h * 0.7, w, h * 0.3, 'sA');
        s += lamp(x + w / 2, y - 400, 120);
        break;
      default: s = habBlock(x, y, w, h, rng, 'sA', {});
    }
    return s;
  }

  global.Hive.Arch = {
    CH: CH,
    compose: function (city, layerId, y0, y1, xMin, xMax, env) {
      var fn = COMPOSERS[layerId] || composeMid;
      var rng = rngFor(city.seed, Math.floor(y0 / CH), 13);
      var out = fn(city, y0, y1, xMin, xMax, rng, env);
      out.mid = backbone(city, y0, y1, xMin, xMax, env) + out.mid;
      return out;
    },
    drawStructure: drawStructure,
    windows: windows,
    habBlock: habBlock,
    gothicTower: gothicTower,
    cathedral: cathedral,
    manufactorum: manufactorum,
    ventStack: ventStack,
    pipeRun: pipeRun,
    bridgeSpan: bridgeSpan,
    craneRig: craneRig,
    shanty: shanty,
    ruinBlock: ruinBlock,
    machineMass: machineMass,
    ancientForm: ancientForm,
    tunnelMouth: tunnelMouth,
    reactorHall: reactorHall
  };
})(window);
