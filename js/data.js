/* ════════════════════════════════════════════════════════════════════
   data.js — archive access layer

   Lore and architecture live in data/*.json, entirely separate from
   rendering. Adding a new hive city means adding one JSON file and one
   registry line — no engine changes.

   Because browsers refuse fetch() on file:// URLs, every JSON file is
   also mirrored into data/embedded.js (generated from the JSON, never
   edited by hand). The loader tries the network first and falls back
   to the mirror, so the survey opens correctly either way.
   ════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var H = global.Hive;

  function fromMirror(path) {
    var m = global.HIVE_EMBED || {};
    return m[path] ? JSON.parse(JSON.stringify(m[path])) : null;
  }

  function loadJSON(path) {
    return new Promise(function (resolve, reject) {
      var done = false;
      function fallback(why) {
        if (done) return;
        var m = fromMirror(path);
        if (m) { done = true; resolve(m); }
        else { done = true; reject(new Error('ARCHIVE UNREADABLE: ' + path + ' (' + why + ')')); }
      }
      if (location.protocol === 'file:') { fallback('local access'); return; }
      try {
        fetch(path, { cache: 'no-cache' })
          .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
          .then(function (j) { if (!done) { done = true; resolve(j); } })
          .catch(function (e) { fallback(e.message); });
      } catch (e) { fallback('exception'); }
    });
  }

  /* ── normalisation ──────────────────────────────────────────────── */
  function prepare(city) {
    city.layers.forEach(function (L, i) {
      L.index = i;
      L.span = L.bottom - L.top;
    });
    city.structures.sort(function (a, b) { return a.depth - b.depth; });
    city.events.sort(function (a, b) { return a.depth - b.depth; });
    city.notes = (city.notes || []).sort(function (a, b) { return a.d - b.d; });
    city.structures.forEach(function (s, i) { s._i = i; s.layer = layerAt(city, s.depth).name; });
    city.events.forEach(function (e, i) { e._i = i; });
    return city;
  }

  function layerAt(city, d) {
    var L = city.layers;
    for (var i = 0; i < L.length; i++) if (d < L[i].bottom) return L[i];
    return L[L.length - 1];
  }

  /* Blend factor between the current layer and the next, over the last
     14% of a layer's span — this is what makes the environment slide
     instead of snapping. */
  function blendAt(city, d) {
    var L = city.layers, i;
    for (i = 0; i < L.length; i++) if (d < L[i].bottom) break;
    if (i >= L.length) return { a: L[L.length - 1], b: L[L.length - 1], t: 0, layer: L[L.length - 1] };
    var cur = L[i], nxt = L[Math.min(i + 1, L.length - 1)];
    var fadeStart = cur.bottom - Math.min(cur.span * 0.30, 2600);
    var t = d <= fadeStart ? 0 : H.smooth(H.clamp((d - fadeStart) / (cur.bottom - fadeStart), 0, 1));
    return { a: cur, b: nxt, t: t, layer: cur };
  }

  /* Instrument readings interpolate across the WHOLE of a layer toward
     the next layer's values, rather than snapping at boundaries like
     the palette does. That way the numbers tick continuously as you
     descend instead of jumping seven times in 45 km. */
  function readingsAt(city, d) {
    var L = city.layers, i;
    for (i = 0; i < L.length; i++) if (d < L[i].bottom) break;
    if (i >= L.length) i = L.length - 1;
    var cur = L[i], nxt = L[Math.min(i + 1, L.length - 1)];
    if (!cur.readings) return null;
    var t = H.clamp((d - cur.top) / Math.max(1, cur.bottom - cur.top), 0, 1);
    var A = cur.readings, B = nxt.readings || A, out = {};
    for (var k in A) {
      out[k] = (typeof A[k] === 'number' && typeof B[k] === 'number')
        ? H.lerp(A[k], B[k], t)
        : (t > 0.5 ? B[k] : A[k]);
    }
    return out;
  }

  /* The deepest field note at or above the given depth. */
  function noteAt(city, d) {
    var N = city.notes;
    if (!N || !N.length) return null;
    var lo = 0, hi = N.length - 1, best = null;
    if (d < N[0].d) return N[0];
    while (lo <= hi) {
      var m = (lo + hi) >> 1;
      if (N[m].d <= d) { best = N[m]; lo = m + 1; } else hi = m - 1;
    }
    return best;
  }

  global.Hive.Data = {
    loadJSON: loadJSON,
    prepare: prepare,
    layerAt: layerAt,
    blendAt: blendAt,
    readingsAt: readingsAt,
    noteAt: noteAt,
    loadCity: function (file) { return loadJSON(file).then(prepare); }
  };
})(window);
