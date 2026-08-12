/* Renders still frames of the cross-section straight from the real
   generators, so the architecture can be inspected without a browser.
      node tools/preview.js 0 2600 9800 17400 31500 41982
   Writes tools/preview/depth-<d>.png                                  */
const fs = require('fs'), path = require('path');
const { Resvg } = require('@resvg/resvg-js');   // npm i -D @resvg/resvg-js
const root = path.join(__dirname, '..');
const out = path.join(__dirname, 'preview');
fs.mkdirSync(out, { recursive: true });

// bootstrap the engine modules in a bare context
const vm = require('vm');
const sandbox = { window: {}, console, Math, Date, performance: { now: () => 0 } };
sandbox.window.Hive = {};
sandbox.global = sandbox;
vm.createContext(sandbox);
for (const f of ['js/rng.js', 'data/embedded.js', 'js/data.js', 'js/architecture.js', 'js/engraving.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const engManifest = sandbox.window.HIVE_EMBED['data/engravings.json'] || { plates: [] };
const H = sandbox.window.Hive;
const city = H.Data.prepare(JSON.parse(JSON.stringify(sandbox.window.HIVE_EMBED['data/terra.json'])));

const W = 1440, HGT = 900, SCALE = 1.45, ANCHOR = 0.44, CH = 220;
const PLANES = [['far', .80], ['mid', .93], ['mega', 1.0], ['near', 1.09]];

function mix(a, b, t) {
  const p = h => { h = h.replace('#', ''); const v = parseInt(h, 16); return [v >> 16 & 255, v >> 8 & 255, v & 255]; };
  const A = p(a), B = p(b), c = A.map((x, i) => Math.round(x + (B[i] - x) * t));
  return '#' + ((1 << 24) + (c[0] << 16) + (c[1] << 8) + c[2]).toString(16).slice(1);
}

function render(depth) {
  const b = H.Data.blendAt(city, depth);
  const A = b.a.palette, B = b.b.palette, t = b.t;
  const P = {};
  for (const k of Object.keys(A)) P[k] = mix(A[k], B[k], t);

  const halfWm = (W / 2) / SCALE;
  const xb = [-halfWm / 0.78 - 160, halfWm / 0.78 + 160];
  const top = depth - (ANCHOR * HGT) / (SCALE * 0.78) - 300;
  const bot = depth + ((1 - ANCHOR) * HGT) / (SCALE * 0.78) + 300;

  const acc = { far: '', mid: '', near: '' };
  for (let i = Math.floor(top / CH); i <= Math.ceil(bot / CH); i++) {
    const y0 = i * CH;
    if (y0 + CH < city.skyTop - 400 || y0 > city.maxDepth + 600) continue;
    const bb = H.Data.blendAt(city, y0 + CH / 2);
    const o = H.Arch.compose(city, bb.layer.id, y0, y0 + CH, xb[0], xb[1], bb.layer.env);
    acc.far += o.far; acc.mid += o.mid; acc.near += o.near;
  }
  let mega = '';
  city.structures.forEach(d => {
    if (d.depth + d.h < top - 400 || d.depth > bot + 400) return;
    const lim = Math.max(0, halfWm - d.w / 2 - 14);
    const x = Math.max(-lim, Math.min(lim, d.x));
    mega += `<g transform="translate(${x},${d.depth})">${H.Arch.drawStructure(d, city)}</g>`;
  });

  // procedural engravings on the backdrop plane
  let engs = '';
  for (const e of engManifest.plates || []) {
    const eTop = e.depth - e.h / 2, eBot = e.depth + e.h / 2;
    if (eBot < top - 200 || eTop > bot + 200) continue;
    const s = SCALE * (e.plane || 0.66);
    const body = H.Engraving.build(e.kind, e.w, e.h, city.seed, e.id);
    engs += `<g opacity="${e.opacity ?? 0.32}" transform="translate(${W / 2},${(HGT * ANCHOR - depth * s).toFixed(2)}) scale(${s.toFixed(4)})">` +
      `<g transform="translate(${e.x - e.w / 2},${eTop})">${body}</g></g>`;
  }

  const anchorPx = HGT * ANCHOR, cx = W / 2;
  /* NB: group opacity is applied per-plane in the live stylesheet. The
     still renderer skips it — an isolation layer whose bounding box is
     kilometres tall is fine for a browser compositor and fatal for a
     software rasteriser. */
  const g = (content, p, op) => {
    const s = SCALE * p;
    return `<g${op ? ' opacity="' + op + '"' : ''} transform="translate(${cx},${(anchorPx - depth * s).toFixed(2)}) scale(${s.toFixed(4)})">${content}</g>`;
  };

  const css = `
    .sA{fill:${P.structA}}.sB{fill:${P.structB}}.sC{fill:${P.structC}}
    .sF{fill:${P.far}}.sL{fill:${P.line}}
    .win{fill:${P.light};fill-opacity:.62}.winD{fill:${P.light};fill-opacity:.22}
    .orn{fill:${P.accent};fill-opacity:.45}
    .edge{fill:none;stroke:${P.line};stroke-width:1.2;stroke-opacity:.55}
    .pipe{fill:none;stroke:${P.structB}}.pipeH{fill:none;stroke:${P.structC}}
    .wire{fill:none;stroke:${P.line};stroke-width:.9;stroke-opacity:.5}
    .glow{fill:url(#gLamp)}.hot{fill:${P.light};fill-opacity:.9}
    .smokeS{fill:${P.haze};fill-opacity:.10}
    .anom{fill:none;stroke:${P.light};stroke-width:1.4;stroke-opacity:.5}
    .anomF{fill:${P.structC};fill-opacity:.9}
    .engraving path{fill:none;stroke:${mix(P.structA, P.light, 0.38)};stroke-linecap:round}
    .eL{stroke-opacity:.9}.eF{stroke-opacity:.6}.eH{stroke-opacity:.42}`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${HGT}" viewBox="0 0 ${W} ${HGT}">
<defs><radialGradient id="gLamp" cx=".5" cy=".5" r=".5">
<stop offset="0" stop-color="${P.light}" stop-opacity=".55"/>
<stop offset=".45" stop-color="${P.light}" stop-opacity=".13"/>
<stop offset="1" stop-color="${P.light}" stop-opacity="0"/></radialGradient>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${P.skyTop}"/><stop offset="1" stop-color="${P.skyBottom}"/></linearGradient></defs>
<style>${css}</style>
<rect width="${W}" height="${HGT}" fill="url(#sky)"/>
<g class="engraving">${engs}</g>
${g(acc.far, .80)}
${g(acc.mid, .93)}
${g(mega, 1.0)}
${g(acc.near, 1.09)}
</svg>`;

  const png = new Resvg(svg).render().asPng();
  const name = `depth-${depth}.png`;
  fs.writeFileSync(path.join(out, name), png);
  const nodes = (svg.match(/<(rect|path|circle|polygon|ellipse|line|g)\b/g) || []).length;
  console.log(name.padEnd(18), b.layer.name.padEnd(22), 'elements=' + nodes, 'svg=' + (svg.length / 1024).toFixed(0) + 'kB');
}

const args = process.argv.slice(2).map(Number);
(args.length ? args : [-600, 0, 900, 3400, 9800, 17400, 25900, 31500, 41982]).forEach(render);
