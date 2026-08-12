/* ════════════════════════════════════════════════════════════════════
   main.js — the descent

   Owns the scroll driver, the single requestAnimationFrame loop, and
   every input path into the survey.
   ════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var H = global.Hive, clamp = H.clamp;
  var World = H.World, HUD = H.HUD, Atmo = H.Atmo, Audio = H.Audio, State = H.State;

  var city = null;
  var registry = [];
  var SCROLL_LEN = 30000;
  var running = false;
  var lastT = 0, prevD = 0, lastEventD = null, lastAudioD = -1e9, lastDosT = 0;
  var tween = null;

  /* ── boot ───────────────────────────────────────────────────────── */
  var BOOT_LINES = [
    'ADEPTUS ADMINISTRATUM · COGITATOR NODE 4417',
    'AUTHENTICATION ................ <b>PROVISIONAL</b>',
    'LOADING ARCHITECTURAL RECORD ... <b>HIVE 001</b>',
    'STRATA INDEXED ................ <b>7</b>',
    'STRUCTURES RESOLVED ........... <b>PROCEDURAL</b>',
    'VERTICAL EXTENT ............... <b>45,200 m</b>',
    'RECORD INTEGRITY BELOW 30 km .. <b>DEGRADED</b>',
    'MACHINE SPIRIT ................ <b>APPEASED</b>'
  ];

  function bootSequence(cb) {
    var log = document.getElementById('boot-log');
    var enter = document.getElementById('boot-enter');
    var i = 0;
    (function step() {
      if (i >= BOOT_LINES.length) { enter.classList.add('ready'); if (cb) cb(); return; }
      log.innerHTML += BOOT_LINES[i++] + '<br>';
      log.scrollTop = log.scrollHeight;
      setTimeout(step, 150 + Math.random() * 190);
    })();
  }

  /* ── scroll driver ──────────────────────────────────────────────── */
  function span() { return city.maxDepth - city.skyTop; }

  function sizeScroller() {
    document.getElementById('scroller').style.height = (SCROLL_LEN + window.innerHeight) + 'px';
  }

  function depthFromScroll() {
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    return city.skyTop + clamp(y / SCROLL_LEN, 0, 1) * span();
  }

  function scrollForDepth(d) {
    return clamp((d - city.skyTop) / span(), 0, 1) * SCROLL_LEN;
  }

  function gotoDepth(d, id) {
    var from = window.pageYOffset, to = scrollForDepth(d);
    var dist = Math.abs(to - from);
    var dur = clamp(420 + dist * 0.16, 420, 1700);
    tween = { from: from, to: to, t0: performance.now(), dur: dur, id: id };
  }

  /* ── main loop ──────────────────────────────────────────────────── */
  function frame(now) {
    requestAnimationFrame(frame);
    if (!running) return;
    var dt = Math.min(now - lastT, 64) || 16;
    lastT = now;

    if (tween) {
      var p = clamp((now - tween.t0) / tween.dur, 0, 1);
      var e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      window.scrollTo(0, tween.from + (tween.to - tween.from) * e);
      if (p >= 1) {
        var id = tween.id; tween = null;
        if (id) {
          var def = city.structures.filter(function (s) { return s.id === id; })[0];
          if (def) setTimeout(function () { HUD.openStructure(def); }, 120);
        }
      }
    }

    World.targetD = depthFromScroll();
    var k = 1 - Math.pow(0.0016, dt / 1000);
    World.camD += (World.targetD - World.camD) * k;
    World.vel = (World.camD - prevD) / (dt / 1000);
    prevD = World.camD;

    World.updateChunks();
    World.updateStructures();
    World.updatePlates();
    World.updateEngravings();
    World.applyTransforms();
    var env = World.applyEnv(false) || World.env;

    Atmo.setEnv(env, World.colors, World.vel);
    Atmo.frame(dt);
    HUD.update(World.camD, env, Math.round(World.viewM));

    /* nine ticking readings do not need 60 Hz */
    if (now - lastDosT > 110) {
      lastDosT = now;
      HUD.updateDossier(World.camD, (env && env.glitch) || 0);
    }

    /* audio parameter ramps are not free — 10 Hz is plenty */
    if (Math.abs(World.camD - lastAudioD) > 30) {
      lastAudioD = World.camD;
      Audio.setDepth(city, World.camD);
    }

    checkEvents(World.camD, env);
    checkEggs(World.camD);
  }

  /* ── narrative triggers ─────────────────────────────────────────────
     Tested as a crossing of the interval travelled since the previous
     frame, not as "am I near it" — a fast fling can cover 400 m between
     frames and would otherwise skip the notice entirely.              */
  function checkEvents(d, env) {
    if (lastEventD === null) { lastEventD = d; return; }
    var from = lastEventD, to = d;
    lastEventD = d;
    for (var i = 0; i < city.events.length; i++) {
      var ev = city.events[i];
      if (State.events[i]) {
        if (Math.abs(d - ev.depth) > 3000) State.events[i] = 0;  // re-readable much later
        continue;
      }
      if (from < ev.depth && to >= ev.depth) {
        State.events[i] = 1;
        HUD.showEvent(ev, (env && env.glitch) || 0);
        break;
      }
    }
  }

  function checkEggs(d) {
    if (d > city.officialFloor && !State.eggs.floor) {
      State.eggs.floor = 1;
      HUD.buildIndex();
    }
    if (d > city.maxDepth - 40 && !State.eggs.bottom) {
      State.eggs.bottom = 1;
      setTimeout(function () {
        HUD.toast('SURVEY TERMINATED', [
          'THE INSTRUMENT HAS REACHED THE',
          'END OF ITS CABLE.',
          '',
          'THE CABLE IS 45.2 KILOMETRES.',
          '',
          'IT IS NOT TAUT.'
        ], 44000);
      }, 1400);
    }
  }

  /* ── input ──────────────────────────────────────────────────────── */
  function bindInput() {
    var byId = function (i) { return document.getElementById(i); };

    byId('btn-index').addEventListener('click', function () { HUD.sheet('index-panel'); });
    byId('btn-cities').addEventListener('click', function () { HUD.sheet('city-panel'); });
    byId('btn-credits').addEventListener('click', function () { HUD.sheet('credits-panel'); });
    byId('btn-help').addEventListener('click', function () { HUD.sheet('help-panel'); });
    byId('btn-scale').addEventListener('click', function () {
      var s = byId('scale'); s.classList.toggle('hidden');
      this.classList.toggle('on', !s.classList.contains('hidden'));
    });
    byId('btn-scale').classList.add('on');

    var dossier = byId('dossier');
    /* open by default on anything with room for it */
    if (window.innerWidth < 640) dossier.classList.add('hidden');
    byId('btn-dossier').classList.toggle('on', !dossier.classList.contains('hidden'));
    byId('btn-dossier').addEventListener('click', function () {
      dossier.classList.toggle('hidden');
      var open = !dossier.classList.contains('hidden');
      this.classList.toggle('on', open);
      if (open) HUD.updateDossier(World.camD, (World.env && World.env.glitch) || 0);
    });

    var ab = byId('btn-audio');
    ab.addEventListener('click', function () {
      var on = Audio.toggle();
      ab.classList.toggle('on', !!on);
      ab.querySelector('b').textContent = on ? 'VOX ON' : 'VOX OFF';
      if (on) Audio.setDepth(city, World.camD);
    });

    document.addEventListener('keydown', function (e) {
      var step = window.innerHeight;
      if (e.key === 'Escape') {
        HUD.closePanel();
        HUD.closeSheets();
        return;
      }
      if (e.key === 'i' || e.key === 'I') HUD.sheet('index-panel');
      if (e.key === 'c' || e.key === 'C') HUD.sheet('city-panel');
      if (e.key === 'p' || e.key === 'P') HUD.sheet('credits-panel');
      if (e.key === '?') HUD.sheet('help-panel');
      if (e.key === 's' || e.key === 'S') byId('btn-scale').click();
      if (e.key === 'd' || e.key === 'D') byId('btn-dossier').click();
      if (e.key === 'm' || e.key === 'M') ab.click();
      if (e.key === 'Home') { e.preventDefault(); gotoDepth(city.skyTop); }
      if (e.key === 'End') { e.preventDefault(); gotoDepth(city.maxDepth); }
      if (e.key === 'PageDown') { e.preventDefault(); window.scrollBy(0, step * 0.9); }
      if (e.key === 'PageUp') { e.preventDefault(); window.scrollBy(0, -step * 0.9); }
      if (e.key === 'ArrowDown') { e.preventDefault(); window.scrollBy(0, 90); }
      if (e.key === 'ArrowUp') { e.preventDefault(); window.scrollBy(0, -90); }

      /* litanies */
      if (/^[a-zA-Z]$/.test(e.key)) {
        State.keybuf = (State.keybuf + e.key.toUpperCase()).slice(-12);
        if (State.keybuf.indexOf('LITANY') >= 0 && !State.eggs.litany) {
          State.eggs.litany = 1;
          city.structures.forEach(function (s) { State.seen[s.id] = State.seen[s.id] || 0.5; });
          HUD.buildIndex();
          HUD.toast('LITANY OF ACCESS ACCEPTED', [
            'ALL STRUCTURAL DESIGNATIONS',
            'RELEASED TO THIS TERMINAL.',
            '',
            'INCLUDING THE ONES THAT',
            'SHOULD NOT BE INDEXED.'
          ], 0);
        }
        if (State.keybuf.indexOf('PURGE') >= 0) { Atmo.surge(); }
        if (State.keybuf.indexOf('EMPEROR') >= 0 && !State.eggs.emperor) {
          State.eggs.emperor = 1;
          HUD.toast('DEVOTIONAL RESPONSE LOGGED', ['THE EMPEROR PROTECTS.', '', 'HE HAS NOT VISITED THIS', 'STRATUM.'], 0);
        }
      }
    });

    /* drag to descend — mouse only; touch already has native scrolling
       and doubling it up makes the hive lurch */
    var drag = null;
    var svg = document.getElementById('hive');
    svg.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      drag = { y: e.clientY, s: window.pageYOffset, moved: 0 };
    });
    window.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dy = e.clientY - drag.y;
      drag.moved += Math.abs(dy);
      if (drag.moved > 5) World.suppressClick = true;
      window.scrollTo(0, drag.s - dy * 1.6);
    });
    window.addEventListener('pointerup', function () {
      drag = null;
      setTimeout(function () { World.suppressClick = false; }, 0);
    });

    /* depth readout: press it enough and the archive admits something */
    var dr = document.getElementById('depth-readout');
    dr.style.pointerEvents = 'auto';
    dr.style.cursor = 'pointer';
    dr.addEventListener('click', function () {
      State.sigilClicks++;
      if (State.sigilClicks === 7 && !State.eggs.census) {
        State.eggs.census = 1;
        HUD.toast('CENSUS RECONCILIATION', [
          'REGISTERED POPULATION OF',
          'HIVE CITY 001:',
          '',
          '        9,441,208,663',
          '',
          'POPULATION OF TERRA:',
          '',
          '        UNKNOWN',
          '',
          'THE SMALLER FIGURE IS THE',
          'ONE WE ARE CERTAIN OF.'
        ], 20000);
      }
    });

    var ro;
    window.addEventListener('resize', function () {
      clearTimeout(ro);
      ro = setTimeout(function () {
        sizeScroller();
        Atmo.resize();
        World.rebuild();
      }, 180);
    });

    window.addEventListener('scroll', function () {
      var h = document.getElementById('hint');
      if (window.pageYOffset > 260) h.classList.remove('show');
    }, { passive: true });
  }

  /* ── city switching ─────────────────────────────────────────────── */
  function loadCity(id) {
    var rec = registry.filter(function (r) { return r.id === id; })[0];
    if (!rec || !rec.available) return;
    document.getElementById('city-panel').hidden = true;
    H.Data.loadCity(rec.file).then(function (c) {
      city = H.city = c;
      State.seen = {}; State.events = {}; State.eggs = {};
      World.chunks.forEach(function (v) { for (var k in v) if (v[k].parentNode) v[k].parentNode.removeChild(v[k]); });
      World.chunks.clear();
      World.structs.forEach(function (g) { if (g.parentNode) g.parentNode.removeChild(g); });
      World.structs.clear();
      World.init(c);
      HUD.init(c);
      HUD.onGoto = gotoDepth;
      HUD.buildCities(registry, c.id, loadCity);
      window.scrollTo(0, 0);
      World.rebuild();
    });
  }

  /* ── start ──────────────────────────────────────────────────────── */
  function begin() {
    var b = document.getElementById('boot');
    b.classList.add('gone');
    document.documentElement.classList.remove('locked');
    sizeScroller();
    window.scrollTo(0, 0);
    running = true;
    lastT = performance.now();
    prevD = World.camD;
    setTimeout(function () { document.getElementById('hint').classList.add('show'); }, 900);
    setTimeout(function () { document.getElementById('hint').classList.remove('show'); }, 12000);
  }

  function fail(msg) {
    var log = document.getElementById('boot-log');
    log.innerHTML += '<b style="color:#e0703c">ARCHIVE FAULT: ' + msg + '</b><br>';
  }

  document.addEventListener('DOMContentLoaded', function () {
    bootSequence();
    Atmo.init();

    /* the plate manifest is optional in every sense: if it is missing,
       or the image files are not installed, the survey is unchanged */
    H.Data.loadJSON('data/plates.json')
      .then(function (m) { H.plateManifest = m; })
      .catch(function () { H.plateManifest = { plates: [] }; });
    H.Data.loadJSON('data/engravings.json')
      .then(function (m) { H.engManifest = m; })
      .catch(function () { H.engManifest = { plates: [] }; });

    H.Data.loadJSON('data/cities.json').then(function (reg) {
      registry = reg.registry;
      var terra = registry.filter(function (r) { return r.id === 'terra'; })[0];
      return H.Data.loadCity(terra.file);
    }).then(function (c) {
      city = H.city = c;
      World.init(c);
      HUD.init(c);
      HUD.onGoto = gotoDepth;
      HUD.buildCities(registry, c.id, loadCity);
      World.onStructureClick = function (id) {
        var def = c.structures.filter(function (s) { return s.id === id; })[0];
        if (def) HUD.openStructure(def);
      };
      World.initPlates(H.plateManifest || { plates: [] });
      World.initEngravings(H.engManifest || { plates: [] });
      sizeScroller();
      World.rebuild();
      bindInput();
      document.getElementById('boot-enter').addEventListener('click', begin);
      /* if the operator is impatient, Enter works too */
      document.addEventListener('keydown', function once(e) {
        if (e.key === 'Enter' && !running) { begin(); document.removeEventListener('keydown', once); }
      });
      requestAnimationFrame(frame);
    }).catch(function (e) {
      fail(e.message || 'UNREADABLE');
      console.error(e);
    });
  });
})(window);
