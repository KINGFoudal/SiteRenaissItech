/*
 * Ajoute une empreinte aux fichiers CSS et JS dans toutes les pages HTML
 * (style.css?v=abc123) : à chaque modification, les navigateurs chargent
 * la nouvelle version au lieu de celle gardée en cache.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = ['assets/css/style.css', 'assets/js/main.js', 'assets/js/espaces.js'];
const IGNORE = new Set(['node_modules', '.git', '.wrangler', 'content', 'scripts', 'worker', 'migrations']);

const hash = Object.fromEntries(ASSETS.map((a) => [a, createHash('sha256').update(readFileSync(join(ROOT, a))).digest('hex').slice(0, 10)]));

const pages = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (IGNORE.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.html')) pages.push(p);
  }
})(ROOT);

let changed = 0;
for (const page of pages) {
  const src = readFileSync(page, 'utf8');
  let out = src;
  for (const a of ASSETS) {
    const re = new RegExp(`((?:href|src)="/?${a.replace(/[.]/g, '\\.')})(\\?v=[0-9a-f]+)?"`, 'g');
    out = out.replace(re, `$1?v=${hash[a]}"`);
  }
  if (out !== src) { writeFileSync(page, out); changed++; }
}
console.log(`✓ Versions des fichiers CSS/JS : ${pages.length} page(s) vérifiée(s), ${changed} mise(s) à jour.`);
