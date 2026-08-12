/* ════════════════════════════════════════════════════════════════════
   world.js — camera, chunk virtualisation, environment

   The cross-section is 46.4 km tall. Only ~2 km of it exists in the
   DOM at any moment. Chunks of 250 m are composed on demand, inserted
   with a single innerHTML write, and discarded once they leave a
   generous margin around the viewport.

   Four parallax planes share one <svg>. Each plane is a <g> carrying a
   translate+scale transform that is rewritten once per frame — the
   browser composites this on the GPU, so scrolling stays smooth no
   matter how much geometry is on screen.
   ════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var H = global.Hive, clamp = H.clamp, lerp = H.lerp;
  var CH = 220;                       // chunk height, metres

  var PLANES = [
    { id: 'layer-far', p: 0.80, key: 'far' },
    { id: 'layer-mid', p: 0.93, key: 'mid' },
    { id: 'layer-mega', p: 1.00, key: null },
    { id: 'layer-near', p: 1.09, key: 'near' }
  ];

  function hex2rgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var v = parseInt(h, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function rgb2hex(c) {
    return '#' + ((1 << 24) + (Math.round(c[0]) << 16) + (Math.round(c[1]) << 8) + Math.round(c[2]))
      .toString(16).slice(1);
  }
  function mixHex(a, b, t) {
    var A = hex2rgb(a), B = hex2rgb(b);
    return rgb2hex([lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)]);
  }

  var World = {
    city: null,
    svg: null,
    planes: {},
    chunks: new Map(),
    structs: new Map(),
    camD: 0,
    targetD: 0,
    vel: 0,
    scale: 1.5,          // screen px per metre
    anchor: 0.44,        // camera depth sits at this fraction of viewport height
    vw: 0, vh: 0,
    halfWm: 0,
    viewM: 0,
    env: null,
    colors: { light: '#ffd79a', haze: '#d8d2bd' },
    plates: [], plateDir: 'art/', plateNodes: new Map(),
    plateState: {},        // id -> 'loading' | 'ok' | 'missing'
    plateAspect: {},
    currentPlate: null,
    engravings: [], engNodes: new Map(),
    lastPaletteKey: '',
    onStructureClick: null,
    suppressClick: false,
    bound: false,

    init: function (city) {
      this.city = city;
      this.svg = document.getElementById('hive');
      var self = this;
      PLANES.forEach(function (pl) { self.planes[pl.id] = document.getElementById(pl.id); });
      this.measure();
      this.bindPointer();
      this.camD = this.targetD = city.skyTop + 200;
    },

    measure: function () {
      this.vw = window.innerWidth;
      this.vh = window.innerHeight;
      /* One metre is worth roughly 1.5 screen pixels on a laptop; a
         little more on tiny screens so structures stay legible. */
      var base = this.vw < 640 ? 1.9 : this.vw < 1100 ? 1.65 : 1.45;
      this.scale = base;
      this.viewM = this.vh / this.scale;
      this.halfWm = (this.vw / 2) / this.scale;
      this.svg.setAttribute('viewBox', '0 0 ' + this.vw + ' ' + this.vh);
      this.svg.setAttribute('width', this.vw);
      this.svg.setAttribute('height', this.vh);
    },

    /* world-x range that must be populated, with margin for parallax */
    xBounds: function () {
      var m = this.halfWm / 0.78 + 160;
      return [-m, m];
    },

    depthBounds: function (pad) {
      var top = this.camD - (this.anchor * this.vh) / (this.scale * 0.78) - pad;
      var bot = this.camD + ((1 - this.anchor) * this.vh) / (this.scale * 0.78) + pad;
      return [top, bot];
    },

    /* ── chunk lifecycle ──────────────────────────────────────────── */
    chunkKey: function (i) { return i; },

    buildChunk: function (i) {
      var y0 = i * CH, y1 = y0 + CH;
      var city = this.city;
      if (y1 < city.skyTop - 400 || y0 > city.maxDepth + 600) return null;
      var b = H.Data.blendAt(city, y0 + CH / 2);
      var xb = this.xBounds();
      var out = H.Arch.compose(city, b.layer.id, y0, y1, xb[0], xb[1], b.layer.env);
      var nodes = {};
      PLANES.forEach(function (pl) {
        if (!pl.key) return;
        var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('data-c', i);
        g.innerHTML = out[pl.key] || '';
        World.planes[pl.id].appendChild(g);
        nodes[pl.key] = g;
      });
      return nodes;
    },

    updateChunks: function () {
      /* the margin must exceed the tallest structure a chunk can spill
         past its own band, otherwise a culled chunk pops visibly */
      var db = this.depthBounds(this.vh / this.scale * 0.8);
      var i0 = Math.floor(db[0] / CH), i1 = Math.ceil(db[1] / CH);
      var self = this;
      /* drop what left the window */
      this.chunks.forEach(function (v, k) {
        if (k < i0 - 1 || k > i1 + 1) {
          for (var key in v) if (v[key] && v[key].parentNode) v[key].parentNode.removeChild(v[key]);
          self.chunks.delete(k);
        }
      });
      /* add what entered — budget a few per frame so a fast fling
         never blocks the main thread for long */
      var budget = 4;
      for (var i = i0; i <= i1 && budget > 0; i++) {
        if (this.chunks.has(i)) continue;
        var nodes = this.buildChunk(i);
        this.chunks.set(i, nodes || {});
        budget--;
      }
    },

    /* ── interactive structures ───────────────────────────────────── */
    updateStructures: function () {
      var city = this.city, self = this;
      var db = this.depthBounds(this.viewM * 1.2);
      var mega = this.planes['layer-mega'];
      city.structures.forEach(function (def) {
        var top = def.depth, bot = def.depth + def.h;
        var visible = bot > db[0] - 400 && top < db[1] + 400;
        var have = self.structs.has(def.id);
        if (visible && !have) {
          var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          g.setAttribute('class', 'ig');
          g.setAttribute('data-id', def.id);
          /* keep every record reachable, even on a phone */
          var limit = Math.max(0, self.halfWm - def.w / 2 - 14);
          var x = clamp(def.x, -limit, limit);
          var K = 1 / self.scale;
          var body = H.Arch.drawStructure(def, city);
          var labelY = def.depth - 16;
          var found = Hive.State && Hive.State.seen[def.id];
          g.innerHTML =
            '<g class="struct-i" transform="translate(' + x + ',' + def.depth + ')">' + body + '</g>' +
            '<rect class="halo" x="' + (x - def.w / 2 - 8) + '" y="' + (def.depth - 8) + '" width="' + (def.w + 16) + '" height="' + (def.h + 16) + '"/>' +
            '<rect class="hitbox" x="' + (x - def.w / 2 - 6) + '" y="' + (def.depth - 6) + '" width="' + (def.w + 12) + '" height="' + (def.h + 12) + '"/>' +
            /* counter-scaled so label geometry is in screen pixels and
               never grows or shrinks with the world */
            '<g class="marker" transform="translate(' + (x - def.w / 2) + ',' + labelY + ') scale(' + K + ')">' +
            '<line x1="0" y1="0" x2="0" y2="20"/>' +
            '<line x1="0" y1="0" x2="26" y2="0"/>' +
            '<text x="32" y="3.5">' + (found ? '◆ ' : '◇ ') + shortName(def.name) + '</text>' +
            '</g>';
          mega.appendChild(g);
          self.structs.set(def.id, g);
        } else if (!visible && have) {
          var el = self.structs.get(def.id);
          if (el && el.parentNode) el.parentNode.removeChild(el);
          self.structs.delete(def.id);
        }
      });
    },

    markFound: function (id) {
      var g = this.structs.get(id);
      if (!g) return;
      var t = g.querySelector('text');
      if (t && t.textContent.charAt(0) === '◇') t.textContent = '◆' + t.textContent.slice(1);
    },

    setActive: function (id) {
      this.structs.forEach(function (g, k) { g.classList.toggle('active', k === id); });
    },

    /* ── historical plates ───────────────────────────────────────────
       Public-domain engravings sit on their own plane behind every
       other layer, at a slower parallax than the far architecture, so
       they read as something enormous glimpsed between structures.

       Files are optional. Each plate is preflighted with an Image()
       before any <image> element is created, so a missing art/ folder
       produces no broken graphics, no 404 noise in the layout, and no
       behaviour change at all.                                       */
    initPlates: function (manifest) {
      this.plates = (manifest && manifest.plates) || [];
      this.plateDir = (manifest && manifest.dir) || 'art/';
      this.plates.sort(function (a, b) { return a.depth - b.depth; });
      this.plateNodes.forEach(function (g) { if (g.parentNode) g.parentNode.removeChild(g); });
      this.plateNodes.clear();
      this.plateState = {};
      this.plateAspect = {};
    },

    preflightPlate: function (p) {
      if (this.plateState[p.id]) return;
      this.plateState[p.id] = 'loading';
      var self = this, img = new Image();
      img.onload = function () {
        self.plateAspect[p.id] = (img.naturalHeight || 1) / (img.naturalWidth || 1);
        self.plateState[p.id] = 'ok';
      };
      img.onerror = function () { self.plateState[p.id] = 'missing'; };
      img.src = this.plateDir + p.file;
    },

    updatePlates: function () {
      if (!this.plates.length) return;
      var self = this, layer = document.getElementById('layer-plates');
      if (!layer) return;
      var db = this.depthBounds(this.viewM * 1.6);
      var nearest = null, nearestD = Infinity;

      this.plates.forEach(function (p) {
        var aspect = self.plateAspect[p.id] || 0.72;
        var h = p.w * aspect;
        var top = p.depth - h / 2, bot = p.depth + h / 2;
        var inRange = bot > db[0] - 300 && top < db[1] + 300;
        var have = self.plateNodes.has(p.id);

        if (inRange) {
          if (!self.plateState[p.id]) self.preflightPlate(p);
          if (self.plateState[p.id] === 'ok' && !have) {
            var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('class', 'plate');
            g.setAttribute('data-p', p.plane || 0.66);
            g.setAttribute('opacity', p.opacity == null ? 0.38 : p.opacity);
            g.innerHTML = '<image href="' + self.plateDir + p.file + '"' +
              ' x="' + (p.x - p.w / 2) + '" y="' + (p.depth - h / 2) + '"' +
              ' width="' + p.w + '" height="' + h + '"' +
              ' preserveAspectRatio="xMidYMid slice"' +
              ' filter="url(#fPlate)" mask="url(#mPlate)"/>';
            layer.appendChild(g);
            self.plateNodes.set(p.id, g);
          }
          var dist = Math.abs(p.depth - self.camD);
          if (self.plateState[p.id] === 'ok' && dist < nearestD) { nearestD = dist; nearest = p; }
        } else if (have) {
          var el = self.plateNodes.get(p.id);
          if (el && el.parentNode) el.parentNode.removeChild(el);
          self.plateNodes.delete(p.id);
        }
      });
      this.currentPlate = nearest;
    },

    /* ── procedural engravings ───────────────────────────────────────
       Generated line art on the same backdrop plane as the optional
       bitmap plates. These need no network, no files and no licence,
       so they are the layer that always works. An engraving stands
       down if an installed bitmap plate occupies the same depth.     */
    initEngravings: function (manifest) {
      this.engravings = (manifest && manifest.plates) || [];
      this.engravings.sort(function (a, b) { return a.depth - b.depth; });
      this.engNodes.forEach(function (g) { if (g.parentNode) g.parentNode.removeChild(g); });
      this.engNodes.clear();
    },

    engSuppressed: function (e) {
      for (var i = 0; i < this.plates.length; i++) {
        var p = this.plates[i];
        if (this.plateState[p.id] === 'ok' && Math.abs(p.depth - e.depth) < 1400) return true;
      }
      return false;
    },

    updateEngravings: function () {
      if (!this.engravings.length || !H.Engraving) return;
      var self = this, layer = document.getElementById('layer-plates');
      if (!layer) return;
      var db = this.depthBounds(this.viewM * 1.4);
      var seed = (this.city && this.city.seed) || 1;

      this.engravings.forEach(function (e) {
        var top = e.depth - e.h / 2, bot = e.depth + e.h / 2;
        var inRange = bot > db[0] - 200 && top < db[1] + 200 && !self.engSuppressed(e);
        var have = self.engNodes.has(e.id);
        if (inRange && !have) {
          var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          g.setAttribute('class', 'engraving');
          g.setAttribute('data-p', e.plane || 0.66);
          g.setAttribute('opacity', e.opacity == null ? 0.32 : e.opacity);
          var inner = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          inner.setAttribute('transform', 'translate(' + (e.x - e.w / 2) + ',' + top + ')');
          inner.innerHTML = H.Engraving.build(e.kind, e.w, e.h, seed, e.id);
          g.appendChild(inner);
          layer.appendChild(g);
          self.engNodes.set(e.id, g);
        } else if (!inRange && have) {
          var el = self.engNodes.get(e.id);
          if (el && el.parentNode) el.parentNode.removeChild(el);
          self.engNodes.delete(e.id);
        }
      });
    },

    /* ── per-frame transform ──────────────────────────────────────── */
    applyTransforms: function () {
      var anchorPx = this.vh * this.anchor;
      var cx = this.vw / 2, S = this.scale, d = this.camD;
      for (var i = 0; i < PLANES.length; i++) {
        var pl = PLANES[i], g = this.planes[pl.id];
        var s = S * pl.p;
        var ty = anchorPx - d * s;
        g.setAttribute('transform', 'translate(' + cx.toFixed(1) + ',' + ty.toFixed(2) + ') scale(' + s.toFixed(4) + ')');
      }
      /* each backdrop plate carries its own parallax depth, so they
         cannot share a single plane transform */
      var place = function (g) {
        var p = parseFloat(g.getAttribute('data-p')) || 0.66;
        var s = S * p;
        g.setAttribute('transform', 'translate(' + cx.toFixed(1) + ',' + (anchorPx - d * s).toFixed(2) + ') scale(' + s.toFixed(4) + ')');
      };
      this.plateNodes.forEach(place);
      this.engNodes.forEach(place);
    },

    /* ── environment interpolation ────────────────────────────────── */
    applyEnv: function (force) {
      var b = H.Data.blendAt(this.city, this.camD);
      var t = b.t, A = b.a.palette, B = b.b.palette, EA = b.a.env, EB = b.b.env;
      var key = b.a.id + '|' + Math.round(t * 40);
      if (!force && key === this.lastPaletteKey) return;
      this.lastPaletteKey = key;
      var r = document.documentElement.style;
      r.setProperty('--sky-top', mixHex(A.skyTop, B.skyTop, t));
      r.setProperty('--sky-bottom', mixHex(A.skyBottom, B.skyBottom, t));
      r.setProperty('--haze', mixHex(A.haze, B.haze, t));
      r.setProperty('--struct-a', mixHex(A.structA, B.structA, t));
      r.setProperty('--struct-b', mixHex(A.structB, B.structB, t));
      r.setProperty('--struct-c', mixHex(A.structC, B.structC, t));
      r.setProperty('--far', mixHex(A.far, B.far, t));
      r.setProperty('--line', mixHex(A.line, B.line, t));
      var lightC = mixHex(A.light, B.light, t), hazeC = mixHex(A.haze, B.haze, t);
      r.setProperty('--light', lightC);
      r.setProperty('--accent', mixHex(A.accent, B.accent, t));
      r.setProperty('--ink', mixHex(A.text, B.text, t));
      /* handed to the particle canvas so it never has to call
         getComputedStyle inside the animation frame */
      this.colors = { light: lightC, haze: hazeC };

      /* retint the engraved linework to the stratum */
      var inkC = mixHex(mixHex(A.structA, B.structA, t), lightC, 0.38);
      r.setProperty('--plate-ink', inkC);      // stroked engravings
      var tint = document.getElementById('plateTint');
      if (tint) {
        var c = hex2rgb(inkC);                 // bitmap plates
        tint.setAttribute('values',
          '0 0 0 0 ' + (c[0] / 255).toFixed(3) +
          ' 0 0 0 0 ' + (c[1] / 255).toFixed(3) +
          ' 0 0 0 0 ' + (c[2] / 255).toFixed(3) +
          ' -0.34 -0.34 -0.34 0 1');
      }
      var env = {};
      for (var k in EA) env[k] = lerp(EA[k], EB[k] == null ? EA[k] : EB[k], t);
      r.setProperty('--fog', env.fog.toFixed(3));
      r.setProperty('--vig', env.vignette.toFixed(3));
      r.setProperty('--noise', env.noise.toFixed(3));
      r.setProperty('--glitch', env.glitch.toFixed(3));
      document.body.classList.toggle('glitching', env.glitch > 0.02);
      this.env = env;
      return env;
    },

    rebuild: function () {
      var self = this;
      this.chunks.forEach(function (v) {
        for (var key in v) if (v[key] && v[key].parentNode) v[key].parentNode.removeChild(v[key]);
      });
      this.chunks.clear();
      this.structs.forEach(function (g) { if (g.parentNode) g.parentNode.removeChild(g); });
      this.structs.clear();
      this.plateNodes.forEach(function (g) { if (g.parentNode) g.parentNode.removeChild(g); });
      this.plateNodes.clear();
      this.engNodes.forEach(function (g) { if (g.parentNode) g.parentNode.removeChild(g); });
      this.engNodes.clear();
      this.measure();
      this.updateChunks();
      this.updateStructures();
      this.updatePlates();
      this.updateEngravings();
      this.applyTransforms();
      this.applyEnv(true);
    },

    /* ── pointer interaction ──────────────────────────────────────── */
    bindPointer: function () {
      if (this.bound) return;
      this.bound = true;
      var self = this, svg = this.svg;
      svg.addEventListener('pointermove', function (e) {
        var t = e.target.closest ? e.target.closest('.ig') : null;
        self.structs.forEach(function (g) { g.classList.toggle('hovered', g === t); });
        svg.style.cursor = t ? 'pointer' : '';
      });
      svg.addEventListener('pointerleave', function () {
        self.structs.forEach(function (g) { g.classList.remove('hovered'); });
      });
      svg.addEventListener('click', function (e) {
        if (self.suppressClick) return;          // this was a drag, not a click
        var t = e.target.closest ? e.target.closest('.ig') : null;
        if (!t) return;
        var id = t.getAttribute('data-id');
        if (self.onStructureClick) self.onStructureClick(id);
      });
    }
  };

  function shortName(s) {
    s = s.replace(/\s*—.*$/, '');
    return s.length > 34 ? s.slice(0, 32) + '…' : s;
  }

  global.Hive.World = World;
  global.Hive.World.CH = CH;
  global.Hive.mixHex = mixHex;
})(window);
