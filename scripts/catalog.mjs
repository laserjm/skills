import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildCatalog, loadCatalog } from '../lib/catalog.mjs';
import { json } from '../lib/files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  if (process.argv.slice(2).length === 1 && process.argv[2] === '--write') {
    await writeFile(new URL('../skills-manifest.json', import.meta.url), json(await buildCatalog(root)));
    console.log('Wrote skills-manifest.json');
  } else if (process.argv.length === 2) {
    await loadCatalog(root);
    console.log('Skill catalog and local references are valid.');
  } else {
    throw new Error('Usage: node scripts/catalog.mjs [--write]');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
