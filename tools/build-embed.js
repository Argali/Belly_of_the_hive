#!/usr/bin/env node
/* Regenerates data/embedded.js from every data/*.json file.
   Run after editing any city data:   node tools/build-embed.js        */
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'data');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
const out = {};
for (const f of files) {
  out['data/' + f] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
}
const body =
`/* AUTO-GENERATED — do not edit. Source of truth is data/*.json.
   Regenerate with:  node tools/build-embed.js
   ${files.length} archive file(s) mirrored. */
window.HIVE_EMBED = ${JSON.stringify(out)};
`;
fs.writeFileSync(path.join(dir, 'embedded.js'), body);
console.log('embedded.js written —', files.join(', '));
