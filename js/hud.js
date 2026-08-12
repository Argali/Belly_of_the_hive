/* ════════════════════════════════════════════════════════════════════
   hud.js — the archive terminal

   Depth readout, scale reference, structural records, narrative
   interrupts, city database, and the slow failure of all of the above.
   ════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var H = global.Hive, clamp = H.clamp;

  var State = {
    seen: {},          // structure id -> times opened
    events: {},        // event index -> fired
    eggs: {},
    sigilClicks: 0,
    keybuf: ''
  };

  var GLYPH = '█▓▒░▚▞◼◾╳§¤‡†';
  function corrupt(str, amount) {
    if (amount <= 0.001) return str;
    var out = '', p = amount * 0.34;
    for (var i = 0; i < str.length; i++) {
      var c = str[i];
      if (c !== ' ' && c !== '\n' && Math.random() < p) {
        out += GLYPH[(Math.random() * GLYPH.length) | 0];
      } else out += c;
    }
    return out;
  }

  function fmt(n) {
    var s = Math.abs(Math.round(n)).toString();
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  var HUD = {
    city: null,
    el: {},
    lastLayer: null,
    eventEl: null,
    eventTimer: null,
    lastDepthText: '',

    init: function (city) {
      this.city = city;
      var g = function (id) { return document.getElementById(id); };
      this.el = {
        dNum: g('d-num'), dLayer: g('d-layer'), dDesc: g('d-desc'),
        dFill: g('d-bar-fill'), dTicks: g('d-bar-ticks'), dPct: g('d-pct'),
        brandCity: g('brand-city'), brandCode: g('brand-code'),
        scaleList: g('scale-list'), scaleSpan: g('scale-span'), scale: g('scale'),
        panel: g('panel'), pTitle: g('panel-title'), pRows: g('panel-rows'),
        pNote: g('panel-note'), pKick: g('panel-kicker'), pStamp: g('panel-stamp'),
        event: g('event'), evTitle: g('ev-title'), evBody: g('ev-body'),
        indexList: g('index-list'), cityList: g('city-list'), cityFoot: g('city-foot'),
        hint: g('hint'),
        dossier: g('dossier'), dosStrat: g('dos-strat'), dosGrid: g('dos-grid'),
        dosNoteD: g('dos-note-d'), dosNoteT: g('dos-note-t'),
        dosPlate: g('dos-plate'), dosPlateT: g('dos-plate-t'),
        creditsList: g('credits-list'), creditsIntro: g('credits-intro')
      };
      this.el.brandCity.textContent = city.designation + ' — ' + city.world;
      this.el.brandCode.innerHTML = city.archiveCode + ' <span class="sep">/</span> CLEARANCE: PROVISIONAL';
      this.buildScale();
      this.buildTicks();
      this.buildIndex();
      this.buildDossier();
      this.bind();
    },

    /* ── scale reference ─────────────────────────────────────────── */
    buildScale: function () {
      var items = this.city.scaleLadder, html = '';
      var maxLog = Math.log10(items[items.length - 1].meters);
      var minLog = Math.log10(items[0].meters);
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var t = (Math.log10(it.meters) - minLog) / (maxLog - minLog);
        var hpx = 2 + t * 9;
        html += '<div class="s-row" data-m="' + it.meters + '">' +
          '<div class="s-bar"><i style="height:' + hpx.toFixed(1) + 'px"></i></div>' +
          '<div class="s-txt"><div class="s-name">' + it.label + '</div>' +
          '<div class="s-m">' + (it.meters >= 1000 ? fmt(it.meters) + ' m' : it.meters + ' m') + '</div></div></div>';
        if (i < items.length - 1) html += '<div class="s-arrow">↓</div>';
      }
      this.el.scaleList.innerHTML = html;
    },

    buildTicks: function () {
      var c = this.city, html = '';
      c.layers.forEach(function (L) {
        var t = (L.top - c.skyTop) / (c.maxDepth - c.skyTop);
        if (t <= 0 || t >= 1) return;
        html += '<i style="left:' + (t * 100).toFixed(2) + '%"></i>';
      });
      this.el.dTicks.innerHTML = html;
    },

    /* ── index ────────────────────────────────────────────────────── */
    buildIndex: function () {
      var c = this.city, html = '', lastLayer = '';
      c.structures.forEach(function (s) {
        if (s.secret && !State.seen[s.id]) return;
        if (s.layer !== lastLayer) {
          html += '<div class="ix-sep">' + s.layer + '</div>';
          lastLayer = s.layer;
        }
        var deep = s.depth > 30000;
        html += '<button class="ix' + (deep ? ' deep' : '') + (State.seen[s.id] ? ' found' : '') +
          '" data-goto="' + s.depth + '" data-id="' + s.id + '">' +
          '<span class="ix-d">' + (s.depth < 0 ? '+' : '-') + fmt(s.depth) + ' m</span>' +
          '<span class="ix-n">' + s.name + '</span>' +
          '<span class="ix-l">' + s.kind.toUpperCase() + '</span></button>';
      });
      var found = Object.keys(State.seen).length;
      html += '<div class="ix-sep">RECORDS OPENED: ' + found + ' / ' + c.structures.filter(function (s) { return !s.secret; }).length + '</div>';
      this.el.indexList.innerHTML = html;
    },

    /* ── plate credits ───────────────────────────────────────────────
       Generated from the same manifest the renderer uses, so the
       credits can never drift from what is actually on screen. */
    buildCredits: function (manifest, engManifest) {
      var plates = (manifest && manifest.plates) || [];
      var engs = (engManifest && engManifest.plates) || [];
      var installed = 0, html = '';

      /* what is actually on screen: original generated line art */
      if (engs.length) {
        var byKind = {};
        engs.forEach(function (e) { byKind[e.kind] = (byKind[e.kind] || 0) + 1; });
        var KIND_DESC = {
          vault: 'Receding barrel vault — a corridor continuing past the point where it should have ended',
          arcade: 'Tiered arcades — load-bearing substructure, endlessly repeated',
          stairs: 'Flights of stairs crossing a shaft, serving nothing in particular',
          windlass: 'Windlass, wheel and rope — the machinery of raising things',
          shaft: 'A timbered shaft with ladders and staging',
          cavern: 'Branching subterranean channels through rock',
          engine: 'Beam engine and gear train, purpose unstated',
          monument: 'A monument standing in an otherwise empty plate'
        };
        html += '<div class="ix-sep">PLATES ON SCREEN — ORIGINAL</div>';
        Object.keys(byKind).sort().forEach(function (k) {
          html += '<div class="cr">' +
            '<div class="cr-a">Generated line art<span>js/engraving.js</span></div>' +
            '<div class="cr-t">' + (KIND_DESC[k] || k) + '</div>' +
            '<div class="cr-m">Drawn procedurally from the archive seed. Not a reproduction of any existing work.</div>' +
            '<div class="cr-d">' + byKind[k] + ' PLATE' + (byKind[k] > 1 ? 'S' : '') + '</div></div>';
        });
        html += '<div class="cr"><div class="cr-m" style="opacity:.55">' +
          (engManifest._influences || '') + '</div></div>';
      }

      /* the optional historical layer, if anyone ever installs it */
      html += '<div class="ix-sep">HISTORICAL PLATES — OPTIONAL, NOT BUNDLED</div>';
      plates.slice().sort(function (a, b) { return a.depth - b.depth; }).forEach(function (p) {
        var ok = H.World.plateState[p.id] === 'ok';
        if (ok) installed++;
        html += '<div class="cr' + (ok ? '' : ' cr-miss') + '">' +
          '<div class="cr-a">' + p.author + '<span>' + p.life + '</span></div>' +
          '<div class="cr-t">' + p.title + '</div>' +
          '<div class="cr-m">' + p.year + ' · ' + p.holder + '<br>' + p.licence +
          (p.note ? '<br>' + p.note : '') + '</div>' +
          '<div class="cr-d">' + (p.depth < 0 ? '+' : '-') + fmt(p.depth) + ' m' +
          (ok ? '' : ' · NOT INSTALLED') + '</div></div>';
      });

      this.el.creditsList.innerHTML = html;
      this.el.creditsIntro.textContent = installed
        ? (installed + ' of ' + plates.length + ' historical plates installed, alongside ' + engs.length + ' generated plates.')
        : ('The ' + engs.length + ' plates behind the city are original line art, generated by this project — '
          + 'nothing is downloaded and nothing is reproduced. The historical works listed below are an optional '
          + 'extra: all are public domain, but the files are not bundled and require network access to fetch.');
    },

    buildCities: function (registry, currentId, onSelect) {
      var html = '';
      registry.forEach(function (c) {
        html += '<button class="cty' + (c.available ? '' : ' locked') + (c.id === currentId ? ' cur' : '') +
          '" data-city="' + c.id + '">' +
          '<div class="cty-n">' + c.label + '</div>' +
          '<div class="cty-d">' + c.designation + ' · ' + (c.available ? 'SURVEY AVAILABLE' : 'RESTRICTED') + '</div></button>' +
          '<div class="cty-deny" id="deny-' + c.id + '" hidden>' + (c.denial || []).join('\n') + '</div>';
      });
      this.el.cityList.innerHTML = html;
      var self = this;
      this.el.cityList.querySelectorAll('.cty').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-city');
          var rec = registry.filter(function (r) { return r.id === id; })[0];
          self.el.cityList.querySelectorAll('.cty-deny').forEach(function (d) { d.hidden = true; });
          if (rec.available) { onSelect(id); }
          else {
            var d = document.getElementById('deny-' + id);
            d.hidden = false;
            if (H.Audio.on) H.Audio.burst('alarm', 0.02);
          }
        });
      });
    },

    /* ── stratum dossier ─────────────────────────────────────────────
       Nine instrument readings that interpolate continuously with
       depth, plus the deepest field note passed so far.

       The degradation rule matters thematically: physical instruments
       keep working all the way down — temperature, pressure, mass are
       still read correctly at 45 km. It is the *records* that fail.
       So below the Forgotten Levels the bureaucratic rows go to NO
       DATA while the sensor rows carry on reporting.                 */
    DOS: [
      { k: 'density',  label: 'POP. DENSITY',   unit: 'M/km³', dp: 1, bureau: true },
      { k: 'lifespan', label: 'MEAN LIFESPAN',  unit: 'yrs',   dp: 0, bureau: true },
      { k: 'tithe',    label: 'TITHE COMPLIANCE', unit: '%',   dp: 0, bureau: true, low: 60 },
      { k: 'control',  label: 'ADMIN. CONTROL', unit: '',      str: true, bureau: true },
      { k: 'air',      label: 'BREATHABLE AIR', unit: '%',     dp: 0, low: 40 },
      { k: 'temp',     label: 'AMBIENT TEMP',   unit: '°C',    dp: 0, high: 45 },
      { k: 'lumen',    label: 'SURFACE LIGHT',  unit: '%',     dp: 1, low: 5 },
      { k: 'vox',      label: 'VOX INTEGRITY',  unit: '%',     dp: 0, low: 40 },
      { k: 'load',     label: 'LOAD BORNE',     unit: '×10¹² t', dp: 1 }
    ],

    dosLastNote: null,
    dosBuilt: false,

    buildDossier: function () {
      var html = '';
      this.DOS.forEach(function (r) {
        html += '<dt>' + r.label + '</dt><dd data-k="' + r.k + '">—</dd>';
      });
      this.el.dosGrid.innerHTML = html;
      this.dosCells = {};
      var self = this;
      this.el.dosGrid.querySelectorAll('dd').forEach(function (d) {
        self.dosCells[d.getAttribute('data-k')] = d;
      });
      this.dosBuilt = true;
    },

    updateDossier: function (d, glitch) {
      if (!this.dosBuilt || this.el.dossier.classList.contains('hidden')) return;
      var city = this.city;
      var R = H.Data.readingsAt(city, d);
      if (!R) return;
      var layer = H.Data.layerAt(city, d);

      var name = layer.name;
      if (glitch > 0.15 && Math.random() < glitch * 0.2) name = corrupt(name, glitch);
      if (this.el.dosStrat.textContent !== name) this.el.dosStrat.textContent = name;

      var lostRecords = d > 40000;
      var failing = d > 30000;

      for (var i = 0; i < this.DOS.length; i++) {
        var r = this.DOS[i], cell = this.dosCells[r.k], txt, cls = '';
        if (r.bureau && lostRecords) { txt = 'NO DATA'; cls = 'void'; }
        else if (r.bureau && failing && (r.k === 'density' || r.k === 'lifespan')) { txt = 'UNSURVEYED'; cls = 'void'; }
        else if (r.str) { txt = String(R[r.k]); if (/NONE|NO RECORD|—/.test(txt)) cls = 'void'; }
        else {
          var v = R[r.k];
          txt = v.toFixed(r.dp) + (r.unit ? '<u>' + r.unit + '</u>' : '');
          if (r.low != null && v < r.low) cls = 'bad';
          if (r.high != null && v > r.high) cls = 'bad';
        }
        if (failing && !lostRecords && Math.random() < glitch * 0.06) {
          txt = corrupt(txt.replace(/<[^>]+>/g, ''), glitch);
          cls = 'void';
        }
        if (cell.innerHTML !== txt) cell.innerHTML = txt;
        if (cell.className !== cls) cell.className = cls;
      }

      /* credit the plate while it is actually on screen */
      var pl = H.World.currentPlate;
      if (pl) {
        var line = '<b>' + pl.author + '</b> <span>' + pl.life + '</span><br><i>' + pl.title + '</i><br>' + pl.year;
        if (this.el.dosPlateT.innerHTML !== line) this.el.dosPlateT.innerHTML = line;
        this.el.dosPlate.hidden = false;
      } else {
        this.el.dosPlate.hidden = true;
      }

      var note = H.Data.noteAt(city, d);
      if (note && note !== this.dosLastNote) {
        this.dosLastNote = note;
        this.el.dosNoteD.textContent = (note.d < 0 ? '+' : '-') + fmt(note.d) + ' m';
        this.el.dosNoteT.textContent = glitch > 0.35 ? corrupt(note.t, glitch * 0.35) : note.t;
        var t = this.el.dosNoteT;
        t.classList.remove('swap'); void t.offsetWidth; t.classList.add('swap');
      }
    },

    /* ── per-frame readout ───────────────────────────────────────── */
    update: function (d, env, viewM) {
      var c = this.city;
      var b = H.Data.blendAt(c, d);
      var glitch = (env && env.glitch) || 0;

      var rd = Math.round(d);
      var shown = rd === 0 ? '0' : rd < 0 ? '+' + fmt(d) : '-' + fmt(d);
      if (d > 40000 && Math.random() < 0.16 + glitch * 0.4) {
        shown = shown.slice(0, -2) + GLYPH[(Math.random() * 4) | 0] + GLYPH[(Math.random() * 4) | 0];
      }
      if (shown !== this.lastDepthText) { this.el.dNum.textContent = shown; this.lastDepthText = shown; }

      var name = b.layer.name, desc = b.layer.descriptor;
      if (glitch > 0.15 && Math.random() < glitch * 0.25) { name = corrupt(name, glitch); desc = corrupt(desc, glitch); }
      if (this.el.dLayer.textContent !== name) this.el.dLayer.textContent = name;
      if (this.el.dDesc.textContent !== desc) this.el.dDesc.textContent = desc;

      var pct = clamp((d - c.skyTop) / (c.maxDepth - c.skyTop), 0, 1);
      this.el.dFill.style.width = (pct * 100).toFixed(2) + '%';
      this.el.dPct.textContent = (pct * 100).toFixed(1);

      /* scale reference: highlight the largest object that fits on screen */
      if (viewM) {
        var rows = this.el.scaleList.children, best = null;
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i];
          if (!r.dataset || !r.dataset.m) continue;
          r.classList.remove('cur');
          if (parseFloat(r.dataset.m) <= viewM) best = r;
        }
        if (best) best.classList.add('cur');
        this.el.scaleSpan.textContent = fmt(viewM) + ' m';
      }

      if (this.lastLayer !== b.layer.id) {
        var first = this.lastLayer === null;
        this.lastLayer = b.layer.id;
        if (!first) H.Atmo.surge();
      }
    },

    /* ── structural record ───────────────────────────────────────── */
    openStructure: function (def) {
      State.seen[def.id] = (State.seen[def.id] || 0) + 1;
      var view = def;
      if (def.revisit && State.seen[def.id] >= def.revisit.count) view = def.revisit;

      var deep = def.depth > 30000;
      var p = this.el.panel;
      p.classList.toggle('corrupt', deep);
      this.el.pKick.textContent = deep ? 'RECORD FRAGMENT — UNVERIFIED' : 'STRUCTURAL RECORD';
      this.el.pTitle.textContent = view.name || def.name;

      var rows = '';
      var info = view.info || def.info;
      for (var k in info) {
        var v = String(info[k]);
        var cls = /UNKNOWN|NO DATA|—|DISPUTED|NOT /.test(v) ? ' class="unk"'
          : /overdue|WARNING|FORBIDDEN|DENIED|DO NOT/.test(v) ? ' class="warn"' : '';
        rows += '<div class="r"><dt>' + k + '</dt><dd' + cls + '>' + v + '</dd></div>';
      }
      this.el.pRows.innerHTML = rows;
      this.el.pNote.textContent = view.note || '';
      this.el.pNote.style.display = view.note ? '' : 'none';
      this.el.pStamp.textContent = deep
        ? 'PROVENANCE UNCERTAIN · TRANSCRIBED FROM TRANSCRIPTION'
        : 'ADEPTUS ADMINISTRATUM · VERIFIED ' + (def.depth > 15000 ? 'M3█' : 'M41.994');
      p.hidden = false;
      p.scrollTop = 0;
      H.World.setActive(def.id);
      H.World.markFound(def.id);
      this.buildIndex();
      if (H.Audio.on) H.Audio.burst('clang', 0.045);

      if (def.id === 'below-the-floor') this.egg('THE SURVEY WAS NOT ALONE');
    },

    closePanel: function () {
      this.el.panel.hidden = true;
      H.World.setActive(null);
    },

    /* ── narrative interrupts ────────────────────────────────────── */
    showEvent: function (ev, glitch) {
      var e = this.el.event;
      clearTimeout(this.eventTimer);
      e.className = 'event' + (ev.depth > 40000 ? ' unknown' : ev.depth > 15000 ? ' severe' : '');
      e.hidden = false;
      e.classList.remove('out');
      var title = ev.title, body = ev.lines.join('\n');
      if (glitch > 0.1) { title = corrupt(title, glitch * 0.5); body = corrupt(body, glitch * 0.35); }
      this.el.evTitle.textContent = title;
      this.el.evBody.textContent = body;
      if (H.Audio.on) H.Audio.burst(ev.depth > 15000 ? 'alarm' : 'clang', 0.03);
      H.Atmo.pulse();
      var self = this;
      var dwell = 2600 + ev.lines.length * 340;
      this.eventTimer = setTimeout(function () {
        e.classList.add('out');
        setTimeout(function () { e.hidden = true; }, 650);
      }, dwell);
    },

    /* ── easter-egg notices ──────────────────────────────────────── */
    egg: function (text) {
      if (State.eggs[text]) return;
      State.eggs[text] = 1;
      this.showEvent({ depth: 41000, title: 'UNLOGGED', lines: [text] }, 0.3);
    },

    toast: function (title, lines, depth) {
      this.showEvent({ depth: depth || 0, title: title, lines: lines }, 0);
    },

    /* ── wiring ──────────────────────────────────────────────────── */
    bind: function () {
      var self = this;
      document.getElementById('panel-close').addEventListener('click', function () { self.closePanel(); });
      document.getElementById('dos-min').addEventListener('click', function () {
        self.el.dossier.classList.toggle('min');
        this.textContent = self.el.dossier.classList.contains('min') ? '+' : '—';
      });
      document.querySelectorAll('.sheet-close').forEach(function (b) {
        b.addEventListener('click', function () { document.getElementById(b.dataset.close).hidden = true; });
      });
      var credLink = document.getElementById('help-credits-link');
      if (credLink) credLink.addEventListener('click', function () { self.sheet('credits-panel'); });
      this.el.indexList.addEventListener('click', function (e) {
        var b = e.target.closest('.ix'); if (!b) return;
        document.getElementById('index-panel').hidden = true;
        if (self.onGoto) self.onGoto(parseFloat(b.dataset.goto) - 60, b.dataset.id);
      });
    },

    SHEETS: ['index-panel', 'city-panel', 'help-panel', 'credits-panel'],

    sheet: function (id) {
      var s = document.getElementById(id);
      this.SHEETS.forEach(function (o) {
        if (o !== id) document.getElementById(o).hidden = true;
      });
      s.hidden = !s.hidden;
      if (!s.hidden) {
        if (id === 'index-panel') this.buildIndex();
        if (id === 'credits-panel') this.buildCredits(H.plateManifest, H.engManifest);
      }
    },

    closeSheets: function () {
      this.SHEETS.forEach(function (o) {
        var el = document.getElementById(o); if (el) el.hidden = true;
      });
    }
  };

  global.Hive.HUD = HUD;
  global.Hive.State = State;
  global.Hive.corrupt = corrupt;
  global.Hive.fmt = fmt;
})(window);
