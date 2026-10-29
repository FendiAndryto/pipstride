// Guards the i18n contract: en/id key parity + every static t('key') resolves.
// Run: node scripts/check-i18n.cjs   (exits 1 on any violation)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src');
const tsrc = fs.readFileSync(path.join(root, 'constants', 'translations.js'), 'utf8');

const blocks = {};
let cur = null;
for (const l of tsrc.split('\n')) {
  const b = l.match(/^\s{2}(en|id):\s*\{/);
  if (b) { cur = b[1]; blocks[cur] = new Set(); continue; }
  const m = l.match(/^\s{4}([a-z0-9_]+):/);
  if (m && cur) blocks[cur].add(m[1]);
}

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(jsx|js)$/.test(e.name)) files.push(p);
  }
})(root);

const used = new Set();
for (const f of files) {
  if (f.includes('translations.js')) continue;
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\bt(?:Ref\.current)?\('([a-z0-9_]+)'/g)) used.add(m[1]);
}

const en = blocks.en;
const id = blocks.id;
const problems = [];
for (const k of en) if (!id.has(k)) problems.push('missing in id: ' + k);
for (const k of id) if (!en.has(k)) problems.push('missing in en: ' + k);
for (const k of used) if (!en.has(k)) problems.push('used but undefined: ' + k);

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`i18n OK — ${en.size} keys per language, ${used.size} static keys resolved.`);
