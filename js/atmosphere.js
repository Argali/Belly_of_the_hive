/* ════════════════════════════════════════════════════════════════════
   atmosphere.js — dust, ash, embers, steam, failing lights

   One canvas, one pool of particles, recycled forever. The pool is
   allocated once at the maximum count and simply not drawn when the
   air is clean, so nothing is ever garbage collected mid-descent.
   ════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var H = global.Hive;

  var MAX = 190;

  var Atmo = {
    cv: null, ctx: null, w: 0, h: 0, dpr: 1,
    parts: [],
    env: { dust: .3, sparks: 0, flicker: 0, grime: 0 },
    palette: { light: '#ffd79a', haze: '#d8d2bd' },
    vel: 0,
    flickerT: 0,
    enabled: true,

    init: function () {
      this.cv = document.getElementById('particles');
      this.ctx = this.cv.getContext('2d', { alpha: true });
      this.resize();
      for (var i = 0; i < MAX; i++) this.parts.push(this.spawn({}, true));
      var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (mq.matches) this.enabled = false;
    },

    resize: function () {
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = window.innerWidth; this.h = window.innerHeight;
      this.cv.width = Math.floor(this.w * this.dpr);
      this.cv.height = Math.floor(this.h * this.dpr);
      this.cv.style.width = this.w + 'px';
      this.cv.style.height = this.h + 'px';
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    },

    spawn: function (p, seedAnywhere) {
      p = p || {};
      p.x = Math.random() * this.w;
      p.y = seedAnywhere ? Math.random() * this.h : this.h + Math.random() * 60;
      p.r = Math.random() * 1.7 + 0.3;
      p.vy = -(Math.random() * 0.26 + 0.05);
      p.vx = (Math.random() - 0.5) * 0.22;
      p.life = Math.random();
      p.kind = Math.random();
      p.a = Math.random() * 0.5 + 0.15;
      p.sw = Math.random() * 0.02 + 0.005;
      p.ph = Math.random() * 6.28;
      return p;
    },

    setEnv: function (env, palette, vel) {
      if (env) this.env = env;
      if (palette) this.palette = palette;
      this.vel = vel || 0;
    },

    frame: function (dt) {
      if (!this.enabled) return;
      var ctx = this.ctx, e = this.env;
      ctx.clearRect(0, 0, this.w, this.h);

      var dust = e.dust || 0, sparks = e.sparks || 0;
      var count = Math.floor(MAX * (0.15 + dust * 0.85));
      /* descent drags the air past the viewport */
      var drag = H.clamp(this.vel * 0.028, -26, 26);

      /* colours arrive pre-resolved from World.applyEnv — calling
         getComputedStyle in here would force a style recalculation on
         every single frame */
      var lightCol = this.palette.light || '#ffd79a';
      var hazeCol = this.palette.haze || '#d8d2bd';

      for (var i = 0; i < count; i++) {
        var p = this.parts[i];
        p.ph += p.sw * dt;
        p.x += (p.vx + Math.sin(p.ph) * 0.16) * dt * 0.06;
        p.y += (p.vy * dt * 0.06) - drag;
        if (p.y < -30 || p.y > this.h + 40 || p.x < -30 || p.x > this.w + 30) {
          this.spawn(p, false);
          if (drag < 0) p.y = -20 - Math.random() * 40;
          continue;
        }
        var isSpark = p.kind < sparks * 0.55;
        if (isSpark) {
          ctx.globalAlpha = p.a * (0.5 + 0.5 * Math.sin(p.ph * 5));
          ctx.fillStyle = lightCol;
          ctx.fillRect(p.x, p.y, p.r * 0.9, p.r * 2.6);
        } else if (p.kind > 0.93) {
          /* slow steam puff */
          ctx.globalAlpha = p.a * 0.14;
          ctx.fillStyle = hazeCol;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 22, 0, 6.283);
          ctx.fill();
        } else {
          ctx.globalAlpha = p.a * (0.35 + dust * 0.65);
          ctx.fillStyle = hazeCol;
          ctx.fillRect(p.x, p.y, p.r, p.r);
        }
      }
      ctx.globalAlpha = 1;

      /* failing lights */
      this.flickerT -= dt;
      if (this.flickerT <= 0) {
        this.flickerT = 220 + Math.random() * 2400 * (1.05 - (e.flicker || 0));
        if (Math.random() < (e.flicker || 0)) this.pulse();
      }
    },

    pulse: function () {
      var f = document.getElementById('flash');
      if (!f) return;
      var strength = 0.05 + Math.random() * 0.1;
      f.style.transition = 'none';
      f.style.opacity = strength;
      requestAnimationFrame(function () {
        f.style.transition = 'opacity .18s steps(3)';
        f.style.opacity = 0;
      });
    },

    /* a heavier, deliberate interruption used at layer boundaries */
    surge: function () {
      var f = document.getElementById('flash');
      if (!f) return;
      var seq = [0.16, 0, 0.09, 0, 0.22, 0], i = 0;
      var tick = function () {
        if (i >= seq.length) { f.style.opacity = 0; return; }
        f.style.transition = 'none';
        f.style.opacity = seq[i++];
        setTimeout(tick, 55 + Math.random() * 70);
      };
      tick();
    }
  };

  global.Hive.Atmo = Atmo;
})(window);
