#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════
   fetch-plates.mjs — download the public-domain backdrop plates

     node tools/fetch-plates.mjs              download everything missing
     node tools/fetch-plates.mjs --force      re-download everything
     node tools/fetch-plates.mjs --width 1800 request a larger rendering
     node tools/fetch-plates.mjs --dry        resolve titles, download nothing

   For each entry in data/plates.json the script resolves a Wikimedia
   Commons file, downloads a scaled JPEG into art/, and writes
   art/CREDITS.txt using the licence metadata reported by Commons itself
   rather than anything hard-coded here — so the credits describe the
   file you actually got.

   Nothing else in the project depends on this. If you never run it, the
   survey renders with the generated engravings instead.
   ════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/plates.json'), 'utf8'));
const outDir = path.join(root, manifest.dir || 'art/');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY = args.includes('--dry');
const STRICT = args.includes('--strict');   // non-zero exit if anything failed
const WIDTH = (() => { const i = args.indexOf('--width'); return i >= 0 ? parseInt(args[i + 1], 10) : 1500; })();

const API = 'https://commons.wikimedia.org/w/api.php';
// Wikimedia asks that automated clients identify themselves.
const UA = 'BellyOfTheHive-PlateFetcher/1.0 (non-commercial hobby project)';

const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const bad = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

async function api(params) {
  const url = API + '?' + new URLSearchParams({ format: 'json', origin: '*', ...params });
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

const IMG = /\.(jpg|jpeg|png|tif|tiff)$/i;
const JUNK = /detail|crop|thumb|icon|stamp|coin|logo|signature|sketch of/i;

/* ── how each plate is found on Commons ───────────────────────────────
   Kept here rather than in data/plates.json so that improving the
   lookup never means touching the manifest. Keyed by plate id:
       [ Commons category, keywords identifying the plate inside it ]
   A first attempt used only full-text search with the plate's whole
   description; requiring eight terms to co-occur resolved just 3 of 18.
   Listing a category and ranking its files is far more reliable.      */
const CAT = {
  'boullee-newton':       ['Étienne-Louis Boullée',      ['newton', 'cénotaphe', 'cenotaph']],
  'meryon-stryge':        ['Charles Meryon',             ['stryge', 'vampire']],
  'santelia-citta-nuova': ["Antonio Sant'Elia",          ['città nuova', 'citta nuova', 'stazione']],
  'dore-over-london':     ['London by Gustave Doré',     ['over london', 'by rail']],
  'dore-wentworth':       ['London by Gustave Doré',     ['wentworth', 'whitechapel']],
  'dore-dudley':          ['London by Gustave Doré',     ['dudley', 'seven dials']],
  'dore-newgate':         ['London by Gustave Doré',     ['newgate', 'exercise yard']],
  'agricola-waterwheel':  ['De re metallica',            ['stamp', 'mill', 'ore']],
  'agricola-bellows':     ['De re metallica',            ['ventilat', 'bellows', 'air']],
  'agricola-ladders':     ['De re metallica',            ['ladder', 'shaft']],
  'martin-pandemonium':   ['John Martin (painter)',      ['pandemonium']],
  'piranesi-carceri-11':  ["Le Carceri d'Invenzione",    ['11', 'shell']],
  'piranesi-carceri-07':  ["Le Carceri d'Invenzione",    ['07', 'drawbridge']],
  'piranesi-carceri-14':  ["Le Carceri d'Invenzione",    ['14', 'gothic arch']],
  'piranesi-carceri-03':  ["Le Carceri d'Invenzione",    ['03', 'round tower']],
  'piranesi-antichita':   ['Le Antichità Romane',        ['sostruzione', 'substruction', 'fondamenta', 'avanzi']],
  'kircher-hydro':        ['Mundus subterraneus',        ['hydrophyla', 'hydrophila']],
  'kircher-pyro':         ['Mundus subterraneus',        ['pyrophyla', 'pyrophila']]
};

/* Exact Commons titles, where one is known for certain — no guessing. */
const EXACT = {
  'piranesi-carceri-07':
    "File:Giovanni Battista Piranesi - Le Carceri d'Invenzione - Second Edition - 1761 - 07 - The Drawbridge.jpg"
};

/** Rank candidate File: titles against a set of keywords. */
function pick(titles, match) {
  const terms = (match || []).map(m => m.toLowerCase());
  const scored = titles
    .filter(t => IMG.test(t))
    .map(t => {
      const low = t.toLowerCase();
      let s = terms.reduce((acc, m) => acc + (low.includes(m) ? 3 : 0), 0);
      if (JUNK.test(low)) s -= 6;
      s -= low.length / 400;               // prefer the plainer title
      return { t, s };
    })
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return null;
  // require at least one keyword hit when keywords were supplied
  if (terms.length && scored[0].s < 3) return null;
  return scored[0].t;
}

/** Every file in a category, following subcategories one level down. */
async function categoryFiles(cat) {
  const title = cat.startsWith('Category:') ? cat : 'Category:' + cat;
  const out = [];
  const list = async (t) => {
    const j = await api({
      action: 'query', list: 'categorymembers', cmtitle: t,
      cmtype: 'file|subcat', cmlimit: '500'
    });
    return j?.query?.categorymembers ?? [];
  };
  const top = await list(title);
  for (const m of top) {
    if (m.ns === 6) out.push(m.title);
    else if (m.ns === 14) {
      const sub = await list(m.title);
      sub.filter(x => x.ns === 6).forEach(x => out.push(x.title));
    }
  }
  return out;
}

/** Full-text search, retried with progressively fewer required terms. */
async function searchFiles(query) {
  const words = query.split(/\s+/).filter(Boolean);
  for (let n = words.length; n >= 2; n--) {
    const q = words.slice(0, n).join(' ');
    for (const prefix of ['filetype:bitmap ', '']) {
      const j = await api({
        action: 'query', list: 'search', srsearch: prefix + q,
        srnamespace: '6', srlimit: '20'
      });
      const hits = (j?.query?.search ?? []).map(h => h.title);
      if (hits.length) return { hits, used: q };
    }
  }
  return { hits: [], used: null };
}

/**
 * Resolve one plate to a Commons File: title.
 * Strategies in order of reliability:
 *   1. exact title   — no guessing at all
 *   2. category      — list a known category and rank its files
 *   3. search        — full-text, shortened until something hits
 */
async function resolvePlate(p) {
  const exact = p.commonsFile || EXACT[p.id];
  if (exact) {
    return { title: exact.startsWith('File:') ? exact : 'File:' + exact, via: 'exact' };
  }
  const cat = p.category || (CAT[p.id] && CAT[p.id][0]);
  const match = p.match || (CAT[p.id] && CAT[p.id][1]);
  if (cat) {
    try {
      const files = await categoryFiles(cat);
      const hit = pick(files, match || p.query.split(/\s+/).slice(0, 4));
      if (hit) return { title: hit, via: `category "${cat}" (${files.length} files)` };
      console.log(dim(`\n${' '.repeat(28)}category "${cat}" had ${files.length} files, none matched`));
    } catch (e) { /* fall through to search */ }
  }
  const { hits, used } = await searchFiles(p.query);
  const hit = pick(hits, match) || hits[0] || null;
  return hit ? { title: hit, via: `search "${used}"` } : { title: null, via: 'no match' };
}

/** Licence + author metadata as Commons itself reports it. */
async function meta(title) {
  const j = await api({
    action: 'query', prop: 'imageinfo', iiprop: 'url|extmetadata|size', titles: title
  });
  const pages = j?.query?.pages ?? {};
  const page = Object.values(pages)[0];
  const ii = page?.imageinfo?.[0];
  if (!ii) return null;
  const em = ii.extmetadata || {};
  const strip = (v) => v ? String(v.value).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '';
  return {
    descUrl: ii.descriptionurl,
    width: ii.width, height: ii.height,
    artist: strip(em.Artist),
    licence: strip(em.LicenseShortName),
    usage: strip(em.UsageTerms)
  };
}

async function download(title, dest) {
  const file = title.replace(/^File:/, '').replace(/ /g, '_');
  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${WIDTH}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`download ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const credits = [];
  let got = 0, skipped = 0, failed = 0;

  console.log(`\nFetching ${manifest.plates.length} public-domain plates into ${path.relative(root, outDir)}/`);
  console.log(dim(`width ${WIDTH}px · source: Wikimedia Commons\n`));

  for (const p of manifest.plates) {
    const dest = path.join(outDir, p.file);
    process.stdout.write(`  ${p.id.padEnd(26)}`);

    if (fs.existsSync(dest) && !FORCE) { console.log(dim('already present')); skipped++; continue; }

    try {
      const { title, via } = await resolvePlate(p);
      if (!title) { console.log(bad('NO MATCH') + dim(`  query: ${p.query}`)); failed++; continue; }

      if (DRY) {
        console.log(dim(`via ${via}`));
        console.log(`${' '.repeat(28)}${ok(title.replace(/^File:/, ''))}`);
        continue;
      }

      const m = await meta(title);
      const bytes = await download(title, dest);
      console.log(ok(`${(bytes / 1024).toFixed(0)} kB`) + dim(`  via ${via}`));
      console.log(`${' '.repeat(28)}${dim(title.replace(/^File:/, ''))}`);
      got++;

      credits.push([
        `${p.author} (${p.life})`,
        `  ${p.title}`,
        `  ${p.year}`,
        `  appears at ${p.depth < 0 ? '+' : '-'}${Math.abs(p.depth)} m`,
        `  file: ${p.file}`,
        `  commons: ${title}`,
        `  page: ${m?.descUrl || 'n/a'}`,
        `  licence as reported by Commons: ${m?.licence || 'n/a'}${m?.usage ? ` (${m.usage})` : ''}`,
        m?.artist ? `  artist field: ${m.artist}` : null,
        p.note ? `  note: ${p.note}` : null,
        ''
      ].filter(Boolean).join('\n'));

      await sleep(400);   // be polite to Commons
    } catch (e) {
      console.log(bad(e.message));
      failed++;
    }
  }

  if (!DRY && credits.length) {
    fs.writeFileSync(path.join(outDir, 'CREDITS.txt'),
      'BACKDROP PLATES — SOURCES AND AUTHORS\n' +
      '=====================================\n\n' +
      'Every work listed here is in the public domain: each artist died well over\n' +
      '70 years ago, and the works were published between 1556 and 1914. The\n' +
      'digitisations are hosted by Wikimedia Commons. Licence strings below are\n' +
      'as reported by Commons at download time, not asserted by this project.\n\n' +
      `Downloaded ${new Date().toISOString().slice(0, 10)} at width ${WIDTH}px.\n\n` +
      credits.join('\n'));
    console.log(dim(`\n  CREDITS.txt written`));
  }

  console.log(`\n${got} downloaded · ${skipped} already present · ${failed} failed\n`);
  if (failed) {
    console.log(dim('For any that failed, search commons.wikimedia.org yourself, save the'));
    console.log(dim('image into art/ under the "file" name from data/plates.json, and it'));
    console.log(dim('will be picked up on the next reload.\n'));
    if (STRICT) {
      console.error(bad(`--strict: ${failed} plate(s) failed, refusing to report success.`));
      process.exit(1);
    }
  }
})();
