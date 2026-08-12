/* Headless sanity pass. Boots the survey in jsdom, drives the descent
   from the sky to the terminal stratum, and reports errors, DOM load
   and chunk churn.   Usage:  node tools/smoke-test.js               */
const { JSDOM, VirtualConsole } = require('jsdom');   // npm i -D jsdom
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('JSDOM: ' + (e.stack || e.message)));
vc.on('error', (...a) => errors.push('ERR: ' + a.join(' ')));
vc.on('warn', () => {});
vc.on('log', () => {});

const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
  runScripts: 'dangerously',
  resources: undefined,
  url: 'http://localhost/',
  pretendToBeVisual: true,
  virtualConsole: vc
});
const { window } = dom;

// minimal environment jsdom lacks
window.HTMLCanvasElement.prototype.getContext = function () {
  const noop = () => {};
  return {
    setTransform: noop, clearRect: noop, fillRect: noop, beginPath: noop,
    arc: noop, fill: noop, save: noop, restore: noop,
    set globalAlpha(v) {}, get globalAlpha() { return 1; },
    set fillStyle(v) {}, get fillStyle() { return '#000'; }
  };
};
window.matchMedia = window.matchMedia || (q => ({ matches: false, addListener() {}, removeListener() {} }));
Object.defineProperty(window, 'innerWidth', { value: 1440, writable: true });
Object.defineProperty(window, 'innerHeight', { value: 900, writable: true });

// inline the stylesheets so cascade bugs are testable
for (const css of ['css/main.css', 'css/hud.css']) {
  const s = window.document.createElement('style');
  s.textContent = fs.readFileSync(path.join(root, css), 'utf8');
  window.document.head.appendChild(s);
}

// load scripts in order, manually (jsdom won't fetch relative files here)
const order = [
  'js/rng.js', 'data/embedded.js', 'js/data.js', 'js/architecture.js', 'js/engraving.js',
  'js/world.js', 'js/atmosphere.js', 'js/audio.js', 'js/hud.js', 'js/main.js'
];
for (const f of order) {
  try { window.eval(fs.readFileSync(path.join(root, f), 'utf8')); }
  catch (e) { errors.push('LOAD ' + f + ': ' + e.message); }
}
window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

setTimeout(() => {
  const H = window.Hive;
  if (!H || !H.city) { report(['city never loaded']); return; }
  const W = H.World, city = H.city;
  console.log('city:', city.designation, '| layers', city.layers.length,
    '| structures', city.structures.length, '| events', city.events.length);

  // snapshot the untouched boot state before the test opens anything
  const hideable = ['panel', 'event', 'index-panel', 'city-panel', 'help-panel', 'credits-panel', 'dos-plate'];
  const bootClosed = {};
  hideable.forEach(id => {
    const el = window.document.getElementById(id);
    bootClosed[id] = !!(el && el.hidden);
  });

  // drive a full descent
  let maxNodes = 0, maxChunks = 0, samples = [];
  const steps = 240;
  for (let i = 0; i <= steps; i++) {
    const d = city.skyTop + (city.maxDepth - city.skyTop) * (i / steps);
    W.camD = W.targetD = d;
    try {
      W.updateChunks(); W.updateChunks(); W.updateChunks(); // burn the per-frame budget
      W.updateStructures();
      W.applyTransforms();
      const env = W.applyEnv(false) || W.env;
      H.HUD.update(d, env, Math.round(W.viewM));
    } catch (e) { errors.push('FRAME @' + Math.round(d) + ': ' + (e.stack || e.message)); break; }
    try { H.HUD.updateDossier(d, (W.env && W.env.glitch) || 0); }
    catch (e) { errors.push('DOSSIER @' + Math.round(d) + ': ' + e.message); break; }
    const nodes = window.document.getElementById('hive').getElementsByTagName('*').length;
    maxNodes = Math.max(maxNodes, nodes);
    maxChunks = Math.max(maxChunks, W.chunks.size);
    if (i % 40 === 0) samples.push(`  -${Math.round(d)}m  ${H.Data.layerAt(city, d).name.padEnd(22)} nodes=${nodes} chunks=${W.chunks.size} structs=${W.structs.size}`);
  }
  console.log(samples.join('\n'));
  console.log('peak SVG nodes:', maxNodes, '| peak chunks:', maxChunks);

  // open every structural record
  city.structures.forEach(s => {
    try { H.HUD.openStructure(s); } catch (e) { errors.push('PANEL ' + s.id + ': ' + e.message); }
  });
  console.log('records opened:', Object.keys(H.State.seen).length);

  // fire every narrative event
  city.events.forEach(ev => {
    try { H.HUD.showEvent(ev, 0.4); } catch (e) { errors.push('EVENT ' + ev.depth + ': ' + e.message); }
  });
  console.log('events rendered:', city.events.length);

  // Dismissability. This has to be a static check on the CSS text, not
  // a getComputedStyle assertion: jsdom does not model UA-stylesheet
  // specificity, so it reports display:none for a hidden element even
  // when a class rule would really override [hidden] in a browser.
  // A panel is closed by setting the attribute, so the override must
  // exist for every class that also sets `display`.
  const cssText = ['css/main.css', 'css/hud.css']
    .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  const hasOverride = /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/.test(cssText);
  hideable.forEach(id => {
    const el = window.document.getElementById(id);
    if (!el) { errors.push('missing panel #' + id); return; }
    if (!bootClosed[id]) errors.push(`#${id} is open at boot`);
    // `(?![\w-])` so `.panel` does not match the rule for `.panel-rows`
    const risky = [...el.classList].filter(c =>
      new RegExp('\\.' + c + '(?![\\w-])[^{}]*\\{[^}]*display\\s*:').test(cssText));
    if (risky.length && !hasOverride) {
      errors.push(`#${id} cannot be closed: .${risky[0]} sets display and [hidden] is not forced`);
    }
  });
  console.log('panel dismissal:', hasOverride ? '[hidden] override present' : 'NO OVERRIDE', '· checked', hideable.length);

  // every close control must resolve to a real element
  window.document.querySelectorAll('.sheet-close').forEach(b => {
    if (!window.document.getElementById(b.dataset.close)) errors.push('dead close button: ' + b.dataset.close);
  });

  // field notes must be ordered, in range, and reachable
  const N = city.notes || [];
  let noteErr = 0;
  N.forEach((nt, i) => {
    if (i && nt.d <= N[i - 1].d) { errors.push('notes out of order at ' + nt.d); noteErr++; }
    if (nt.d < city.skyTop || nt.d > city.maxDepth) { errors.push('note out of range: ' + nt.d); noteErr++; }
    if (!nt.t || nt.t.length < 20) { errors.push('note too short at ' + nt.d); noteErr++; }
  });
  const hit = new Set();
  for (let d = city.skyTop; d <= city.maxDepth; d += 50) {
    const nt = H.Data.noteAt(city, d);
    if (nt) hit.add(nt.d);
  }
  if (hit.size !== N.length) errors.push(`only ${hit.size}/${N.length} field notes are reachable while descending`);
  // biggest gap between notes — a long silent stretch is a content hole
  let gap = 0, gapAt = 0;
  N.forEach((nt, i) => { if (i && nt.d - N[i - 1].d > gap) { gap = nt.d - N[i - 1].d; gapAt = nt.d; } });
  console.log(`field notes: ${N.length}, all reachable=${hit.size === N.length}, largest gap ${gap} m (before -${gapAt})`);

  // readings must interpolate and stay finite the whole way down
  let badRead = 0;
  for (let d = city.skyTop; d <= city.maxDepth; d += 100) {
    const R = H.Data.readingsAt(city, d);
    if (!R) { badRead++; continue; }
    for (const k in R) if (typeof R[k] === 'number' && !isFinite(R[k])) badRead++;
  }
  if (badRead) errors.push(badRead + ' bad reading samples');
  const surf = H.Data.readingsAt(city, 0), deep = H.Data.readingsAt(city, 44000);
  console.log(`readings: surface air ${surf.air.toFixed(0)}% temp ${surf.temp.toFixed(0)}°C -> deep air ${deep.air.toFixed(0)}% temp ${deep.temp.toFixed(0)}°C`);
  if (!(deep.temp > surf.temp && deep.air < surf.air)) errors.push('readings do not trend with depth');

  // plate manifest: complete attribution on every entry, sane geometry,
  // and the renderer must survive the files being absent (they are, here)
  const pm = JSON.parse(fs.readFileSync(path.join(root, 'data/plates.json'), 'utf8'));
  const need = ['id', 'file', 'query', 'title', 'author', 'life', 'year', 'holder', 'licence', 'depth', 'x', 'w'];
  const seenId = new Set(), seenFile = new Set();
  pm.plates.forEach(p => {
    need.forEach(k => { if (p[k] === undefined || p[k] === '') errors.push(`plate ${p.id || '?'} missing ${k}`); });
    if (seenId.has(p.id)) errors.push('duplicate plate id ' + p.id);
    if (seenFile.has(p.file)) errors.push('duplicate plate file ' + p.file);
    seenId.add(p.id); seenFile.add(p.file);
    if (p.depth < city.skyTop || p.depth > city.maxDepth) errors.push(`plate ${p.id} outside the survey`);
    if (!/died|published/.test(p.licence)) errors.push(`plate ${p.id} licence gives no basis`);
    const death = parseInt(String(p.life).split('–')[1], 10);
    if (death && death > 1955) errors.push(`plate ${p.id}: author died ${death}, too recent to assume PD`);
  });
  H.World.initPlates(pm);
  H.World.updatePlates();          // no art/ folder present — must be a no-op
  if (H.World.plateNodes.size) errors.push('plates rendered without image files');

  // procedural engravings: the layer that must work with no network
  const em = JSON.parse(fs.readFileSync(path.join(root, 'data/engravings.json'), 'utf8'));
  const kinds = new Set(H.Engraving.kinds);
  em.plates.forEach(e => {
    if (!kinds.has(e.kind)) errors.push(`engraving ${e.id}: unknown kind "${e.kind}"`);
    if (e.depth < city.skyTop || e.depth > city.maxDepth) errors.push(`engraving ${e.id} outside the survey`);
    if (!(e.w > 0 && e.h > 0)) errors.push(`engraving ${e.id} has no size`);
  });
  // every kind must produce finite geometry at a range of sizes
  let engNodes = 0, engBad = 0;
  H.Engraving.kinds.forEach(k => {
    [[600, 900], [1700, 1000], [900, 1300]].forEach(([w2, h2], i) => {
      const svg = H.Engraving.build(k, w2, h2, city.seed, k + i);
      if (/NaN|Infinity|undefined/.test(svg)) { errors.push(`engraving ${k} emits bad numbers`); engBad++; }
      if (svg.length < 400) { errors.push(`engraving ${k} is nearly empty`); engBad++; }
      engNodes = Math.max(engNodes, (svg.match(/<path/g) || []).length);
    });
  });
  // determinism
  if (H.Engraving.build('vault', 1500, 1000, 40001, 'x') !== H.Engraving.build('vault', 1500, 1000, 40001, 'x'))
    errors.push('engravings are not deterministic');
  H.World.initEngravings(em);
  H.World.camD = 27000; H.World.updateEngravings();
  const shown = H.World.engNodes.size;
  if (!shown) errors.push('no engravings rendered at -27,000 m');
  console.log(`engravings: ${em.plates.length} placed, ${H.Engraving.kinds.length} kinds, max ${engNodes} paths per plate, ${shown} live at -27,000 m`);

  H.HUD.buildCredits(pm, em);
  const crHtml = window.document.getElementById('credits-list').innerHTML;
  pm.plates.forEach(p => {
    if (crHtml.indexOf(p.author) < 0) errors.push('author not credited in UI: ' + p.author);
    if (crHtml.indexOf(p.title) < 0) errors.push('title not credited in UI: ' + p.title);
  });
  const authors = [...new Set(pm.plates.map(p => p.author))];
  console.log(`plates: ${pm.plates.length} across ${authors.length} authors, all credited, absent-file fallback clean`);

  // determinism: the same seed must produce the same city
  const a = H.Arch.compose(city, 'mid', 3000, 3220, -600, 600, {});
  const b = H.Arch.compose(city, 'mid', 3000, 3220, -600, 600, {});
  console.log('deterministic:', a.near === b.near && a.mid === b.mid && a.far === b.far);

  report(errors, maxNodes);
}, 900);

function report(errs, maxNodes) {
  console.log('\n' + '─'.repeat(58));
  if (errs.length) { console.log('FAILURES (' + errs.length + '):'); errs.slice(0, 12).forEach(e => console.log(' •', e)); }
  else console.log('NO ERRORS. Peak DOM inside <svg>: ' + maxNodes + ' nodes.');
  console.log('─'.repeat(58));
  finish(errs.length ? 1 : 0);
}

/* Exit deliberately. jsdom's pretendToBeVisual installs its own
   requestAnimationFrame loop, and main.js re-registers its frame
   callback unconditionally, so the event loop never drains: node hangs
   forever *after* the survey has already finished and reported. Tear
   the window down and quit rather than idling until CI's own limit. */
function finish(code) {
  clearTimeout(watchdog);
  try { window.close(); } catch (e) { /* already torn down */ }
  process.exit(code);
}

/* If anything wedges before report() is reached, fail loudly. */
const watchdog = setTimeout(() => {
  console.error('\nTIMEOUT: the survey did not finish within 120 s.');
  finish(1);
}, 120000);
