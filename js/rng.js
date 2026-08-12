/* ════════════════════════════════════════════════════════════════════
   rng.js — deterministic pseudo-randomness
   The hive must be identical on every access. The Administratum
   does not tolerate a city that rearranges itself between surveys.
   ════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* 32-bit integer hash (xmur3-ish). Stable across engines. */
  function hash32(a, b, c) {
    var h = 2166136261 >>> 0;
    h = Math.imul(h ^ (a | 0), 16777619);
    h = Math.imul(h ^ (b | 0), 16777619);
    h = Math.imul(h ^ (c | 0), 16777619);
    h ^= h >>> 15; h = Math.imul(h, 2246822507);
    h ^= h >>> 13; h = Math.imul(h, 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }

  /* mulberry32 — small, fast, good enough for architecture */
  function RNG(seed) {
    this.s = (seed >>> 0) || 1;
  }
  RNG.prototype.next = function () {
    var t = (this.s += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  RNG.prototype.range = function (lo, hi) { return lo + this.next() * (hi - lo); };
  RNG.prototype.int = function (lo, hi) { return Math.floor(lo + this.next() * (hi - lo + 1)); };
  RNG.prototype.pick = function (arr) { return arr[Math.floor(this.next() * arr.length) % arr.length]; };
  RNG.prototype.chance = function (p) { return this.next() < p; };
  /* biased toward the low end when k>1, toward high when k<1 */
  RNG.prototype.bias = function (lo, hi, k) { return lo + Math.pow(this.next(), k) * (hi - lo); };

  /* Value noise over 1 dimension — used for skyline silhouettes,
     grime distribution, structural damage bands. */
  function noise1(x, seed) {
    var i = Math.floor(x), f = x - i;
    var a = (hash32(i, seed, 7) / 4294967296);
    var b = (hash32(i + 1, seed, 7) / 4294967296);
    var u = f * f * (3 - 2 * f);
    return a * (1 - u) + b * u;
  }

  function fbm1(x, seed, oct) {
    var v = 0, amp = 0.5, fr = 1;
    for (var i = 0; i < (oct || 3); i++) {
      v += amp * noise1(x * fr, seed + i * 977);
      fr *= 2.03; amp *= 0.5;
    }
    return v;
  }

  global.Hive = global.Hive || {};
  global.Hive.hash32 = hash32;
  global.Hive.RNG = RNG;
  global.Hive.rngFor = function (seed, a, b) { return new RNG(hash32(seed, a, b)); };
  global.Hive.noise1 = noise1;
  global.Hive.fbm1 = fbm1;
  global.Hive.clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  global.Hive.lerp = function (a, b, t) { return a + (b - a) * t; };
  global.Hive.smooth = function (t) { return t * t * (3 - 2 * t); };
})(window);
