/* ════════════════════════════════════════════════════════════════════
   audio.js — procedural vox-ambience

   No audio files, no network. Everything is synthesised: filtered
   noise for wind and ventilation, detuned oscillators for the machine
   drone, short enveloped bursts for hull clangs, drips and distant
   bells. The mix morphs with depth.

   If the Web Audio API is unavailable or blocked, every entry point is
   a no-op and the survey continues in silence.
   ════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var H = global.Hive;

  var A = {
    ok: false, on: false, ctx: null, master: null,
    nodes: {}, timer: null, profile: null, depth: 0,

    /* per-layer mix targets */
    PROFILES: {
      surface:   { wind: .22, windF: 780, drone: .03, droneF: 62,  hum: .00, clang: .04, drip: .00, bell: .55, crowd: .16, alarm: 0 },
      upper:     { wind: .16, windF: 560, drone: .07, droneF: 55,  hum: .04, clang: .10, drip: .02, bell: .18, crowd: .30, alarm: 0 },
      mid:       { wind: .20, windF: 340, drone: .16, droneF: 46,  hum: .10, clang: .34, drip: .05, bell: .03, crowd: .16, alarm: .04 },
      lower:     { wind: .17, windF: 220, drone: .21, droneF: 38,  hum: .14, clang: .48, drip: .14, bell: 0,   crowd: .06, alarm: .12 },
      underhive: { wind: .09, windF: 150, drone: .12, droneF: 30,  hum: .18, clang: .16, drip: .40, bell: 0,   crowd: .01, alarm: .03 },
      forgotten: { wind: .05, windF: 110, drone: .08, droneF: 23,  hum: .10, clang: .05, drip: .16, bell: 0,   crowd: 0,   alarm: 0 },
      unknown:   { wind: .02, windF: 80,  drone: .04, droneF: 17,  hum: .04, clang: .01, drip: .03, bell: 0,   crowd: 0,   alarm: 0 }
    },

    noiseBuffer: function (ctx, secs) {
      var len = ctx.sampleRate * secs, b = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = b.getChannelData(0), last = 0;
      for (var i = 0; i < len; i++) {
        var w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;   // brown-ish, gentler than white
        d[i] = last * 3.2;
      }
      return b;
    },

    start: function () {
      if (this.ok) { this.resume(); return true; }
      try {
        var Ctx = global.AudioContext || global.webkitAudioContext;
        if (!Ctx) return false;
        var ctx = this.ctx = new Ctx();
        var master = this.master = ctx.createGain();
        master.gain.value = 0;
        master.connect(ctx.destination);

        var nb = this.noiseBuffer(ctx, 4);

        /* wind / ventilation bed */
        var wSrc = ctx.createBufferSource(); wSrc.buffer = nb; wSrc.loop = true;
        var wFil = ctx.createBiquadFilter(); wFil.type = 'bandpass'; wFil.Q.value = 0.7; wFil.frequency.value = 600;
        var wGain = ctx.createGain(); wGain.gain.value = 0;
        wSrc.connect(wFil); wFil.connect(wGain); wGain.connect(master); wSrc.start();

        /* slow breathing LFO on the wind */
        var lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
        var lfoG = ctx.createGain(); lfoG.gain.value = 0.35;
        lfo.connect(lfoG); lfoG.connect(wGain.gain); lfo.start();

        /* crowd murmur — narrow resonant band on the same noise */
        var cFil = ctx.createBiquadFilter(); cFil.type = 'bandpass'; cFil.Q.value = 4.5; cFil.frequency.value = 420;
        var cGain = ctx.createGain(); cGain.gain.value = 0;
        wSrc.connect(cFil); cFil.connect(cGain); cGain.connect(master);

        /* machine drone — two detuned saws through a low-pass */
        var dGain = ctx.createGain(); dGain.gain.value = 0;
        var dFil = ctx.createBiquadFilter(); dFil.type = 'lowpass'; dFil.frequency.value = 220; dFil.Q.value = 3;
        var o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 46;
        var o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 46.6;
        o1.connect(dFil); o2.connect(dFil); dFil.connect(dGain); dGain.connect(master);
        o1.start(); o2.start();

        /* electrical hum — 50 Hz plus a third harmonic */
        var hGain = ctx.createGain(); hGain.gain.value = 0;
        var h1 = ctx.createOscillator(); h1.type = 'sine'; h1.frequency.value = 50;
        var h2 = ctx.createOscillator(); h2.type = 'sine'; h2.frequency.value = 150;
        var h2g = ctx.createGain(); h2g.gain.value = 0.32;
        h1.connect(hGain); h2.connect(h2g); h2g.connect(hGain); hGain.connect(master);
        h1.start(); h2.start();

        this.nodes = { nb: nb, wGain: wGain, wFil: wFil, cGain: cGain, dGain: dGain, dFil: dFil, o1: o1, o2: o2, hGain: hGain };
        this.ok = true;
        this.scheduleEvents();
        return true;
      } catch (e) { this.ok = false; return false; }
    },

    /* one-shot enveloped sounds */
    burst: function (type, gain) {
      if (!this.ok || !this.on) return;
      var ctx = this.ctx, t = ctx.currentTime, g = ctx.createGain();
      g.connect(this.master);
      if (type === 'clang') {
        var s = ctx.createBufferSource(); s.buffer = this.nodes.nb;
        s.playbackRate.value = 0.4 + Math.random() * 1.6;
        var f = ctx.createBiquadFilter(); f.type = 'bandpass';
        f.frequency.value = 180 + Math.random() * 900; f.Q.value = 6 + Math.random() * 14;
        s.connect(f); f.connect(g);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gain, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6 + Math.random() * 1.4);
        s.start(t); s.stop(t + 2.4);
      } else if (type === 'drip') {
        var o = ctx.createOscillator(); o.type = 'sine';
        var f0 = 900 + Math.random() * 1400;
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f0 * 0.35, t + 0.13);
        o.connect(g);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gain, t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.start(t); o.stop(t + 0.3);
      } else if (type === 'bell') {
        var base = [196, 233, 262, 311][Math.floor(Math.random() * 4)] / 2;
        [1, 2.01, 2.99, 4.2].forEach(function (m, i) {
          var oo = ctx.createOscillator(); oo.type = 'sine'; oo.frequency.value = base * m;
          var gg = ctx.createGain(); gg.gain.setValueAtTime(0, t);
          gg.gain.linearRampToValueAtTime(gain * (1 / (i + 1.4)), t + 0.01);
          gg.gain.exponentialRampToValueAtTime(0.0001, t + 3.4 + i);
          oo.connect(gg); gg.connect(g); oo.start(t); oo.stop(t + 6);
        });
        g.gain.value = 1;
      } else if (type === 'alarm') {
        var oa = ctx.createOscillator(); oa.type = 'square'; oa.frequency.value = 420;
        var fa = ctx.createBiquadFilter(); fa.type = 'lowpass'; fa.frequency.value = 900;
        oa.connect(fa); fa.connect(g);
        g.gain.setValueAtTime(0, t);
        for (var i = 0; i < 3; i++) {
          g.gain.linearRampToValueAtTime(gain, t + i * 0.7 + 0.05);
          g.gain.linearRampToValueAtTime(0.0001, t + i * 0.7 + 0.45);
        }
        oa.start(t); oa.stop(t + 2.3);
      }
    },

    scheduleEvents: function () {
      var self = this;
      clearInterval(this.timer);
      this.timer = setInterval(function () {
        if (!self.on || !self.profile) return;
        var p = self.profile;
        if (Math.random() < p.clang * 0.32) self.burst('clang', 0.05 + Math.random() * 0.09);
        if (Math.random() < p.drip * 0.42) self.burst('drip', 0.02 + Math.random() * 0.04);
        if (Math.random() < p.bell * 0.05) self.burst('bell', 0.035);
        if (Math.random() < p.alarm * 0.05) self.burst('alarm', 0.022);
      }, 700);
    },

    setDepth: function (city, d) {
      this.depth = d;
      var b = H.Data.blendAt(city, d);
      var A1 = this.PROFILES[b.a.id] || this.PROFILES.mid;
      var B1 = this.PROFILES[b.b.id] || A1;
      var p = {};
      for (var k in A1) p[k] = H.lerp(A1[k], B1[k] == null ? A1[k] : B1[k], b.t);
      this.profile = p;
      if (!this.ok || !this.on) return;
      var n = this.nodes, t = this.ctx.currentTime, R = 0.6;
      n.wGain.gain.setTargetAtTime(p.wind * 0.5, t, R);
      n.wFil.frequency.setTargetAtTime(p.windF, t, R);
      n.cGain.gain.setTargetAtTime(p.crowd * 0.25, t, R);
      n.dGain.gain.setTargetAtTime(p.drone * 0.4, t, R);
      n.o1.frequency.setTargetAtTime(p.droneF, t, R);
      n.o2.frequency.setTargetAtTime(p.droneF * 1.013, t, R);
      n.hGain.gain.setTargetAtTime(p.hum * 0.05, t, R);
    },

    resume: function () {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },

    toggle: function () {
      if (!this.ok && !this.start()) return false;
      this.resume();
      this.on = !this.on;
      this.master.gain.setTargetAtTime(this.on ? 0.5 : 0, this.ctx.currentTime, 0.4);
      if (this.on && this.profile) { var d = this.depth; this.setDepth(H.city, d); }
      return this.on;
    }
  };

  global.Hive.Audio = A;
})(window);
