#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════
   fetch-plates.mjs — download the public-domain backdrop plates

     node tools/fetch-plates.mjs              download everything missing
     node tools/fetch-plates.mjs --force      re-download everything
     node tools/fetch-plates.mjs --width 1800 request a larger rendering
     node tools/fetch-plates.mjs --dry        resolve titles, download nothing

   For each entry in data/plates.json the script searches Wikimedia
   Commons, takes the best match, downloads a scaled JPEG rendering into
   art/, and writes art/CREDITS.txt using the licence metadata reported
   by Commons itself rather than anything hard-coded here — so the
   credits describe the file you actually got.

   Nothing else in the project depends on this. If you never run it, the
   survey renders without plates.
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
const WIDTH = (() => { const i = args.indexOf('--width'); return i >= 0 ? parseInt(args[i + 1], 10) : 1500; })();

const API = 'https://commons.wikimedia.org/w/api.php';
// Wikimedia asks that automated clients identify themselves.
const UA = 'BellyOfTheHive-PlateFetcher/1.0 (local hobby project; contact: local user)';

const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const bad = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

async function api(params) {
  const url = API + '?' + new URLSearchParams({ format: 'json', origin: '*', ...params });
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

/** Find the best File: page on Commons for a free-text query. */
async function resolve(query) {
  const j = await api({
    action: 'query', list: 'search', srsearch: `filetype:bitmap ${query}`,
    srnamespace: '6', srlimit: '5'
  });
  const hits = j?.query?.search ?? [];
  if (!hits.length) return null;
  // prefer results that are not obviously details/crops/thumbnails
  const scored = hits.map(h => {
    let s = 0;
    const t = h.title.toLowerCase();
    if (/detail|crop|thumb|icon|stamp|coin/.test(t)) s -= 5;
    if (/\.(jpg|jpeg|png|tif|tiff)$/.test(t)) s += 1;
    return { ...h, s };
  }).sort((a, b) => b.s - a.s);
  return scored[0].title;
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
    credit: strip(em.Credit),
    licence: strip(em.LicenseShortName),
    usage: strip(em.UsageTerms),
    date: strip(em.DateTimeOriginal)
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
      const title = await resolve(p.query);
      if (!title) { console.log(bad('no match')); failed++; continue; }
      const m = await meta(title);

      if (DRY) {
        console.log(dim(`→ ${title}`));
        if (m) console.log(`${' '.repeat(28)}${dim(m.licence || '?')} ${dim(m.descUrl || '')}`);
        continue;
      }

      const bytes = await download(title, dest);
      console.log(ok(`${(bytes / 1024).toFixed(0)} kB`) + dim(`  ${title.replace(/^File:/, '')}`));
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
  }
})();
