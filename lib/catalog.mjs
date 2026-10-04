import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse } from 'yaml';
import { inventory, readJson, statOrNull } from './files.mjs';

export const validName = (name) => typeof name === 'string'
  && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && name.length <= 64;

function frontmatter(contents, file) {
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`Missing YAML frontmatter: ${file}`);
  const data = parse(match[1]);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Expected YAML frontmatter mapping: ${file}`);
  }
  return data;
}

async function validateLinks(file, skillRoot) {
  const contents = await readFile(file, 'utf8');
  // Validate local Markdown links and images; external URLs and anchors have
  // no packaged file to verify. Code samples do not define document links.
  const prose = contents.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  for (const match of prose.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const link = match[1].replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(link)) continue;
    const destination = decodeURIComponent(link.split(/[?#]/)[0]);
    const resolved = path.resolve(path.dirname(file), destination);
    const relative = path.relative(skillRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Link leaves the packaged skill: ${file} -> ${link}`);
    }
    if (!await statOrNull(resolved)) throw new Error(`Broken local link: ${file} -> ${link}`);
  }
}

export async function buildCatalog(packageRoot) {
  const manifest = await readJson(path.join(packageRoot, 'package.json'));
  const skills = {};
  const directories = await readdir(path.join(packageRoot, 'skills'), { withFileTypes: true });
  directories.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const directory of directories) {
    if (!directory.isDirectory() || !validName(directory.name)) {
      throw new Error(`Expected a skill directory with a valid name: ${directory.name}`);
    }
    const root = path.join(packageRoot, 'skills', directory.name);
    const file = path.join(root, 'SKILL.md');
    const data = frontmatter(await readFile(file, 'utf8'), file);
    if (data.name !== directory.name || typeof data.description !== 'string' || !data.description.trim()) {
      throw new Error(`Skill name must match its directory and description must be nonempty: ${file}`);
    }
    const files = await inventory(root);
    if (Object.hasOwn(files, '.laserjm-skill.json')) {
      throw new Error(`.laserjm-skill.json is reserved for installation ownership: ${root}`);
    }
    for (const relative of Object.keys(files)) {
      if (relative.endsWith('.md')) await validateLinks(path.join(root, relative), root);
      if (/\.ya?ml$/.test(relative)) parse(await readFile(path.join(root, relative), 'utf8'));
    }
    skills[data.name] = { description: data.description, files };
  }
  if (!Object.keys(skills).length) throw new Error('The package must contain at least one skill.');
  return { schemaVersion: 1, package: manifest.name, version: manifest.version, skills };
}

export async function loadCatalog(packageRoot) {
  const expected = await buildCatalog(packageRoot);
  const actual = await readJson(path.join(packageRoot, 'skills-manifest.json'));
  if (!isDeepStrictEqual(expected, actual)) {
    throw new Error('Packaged skills differ from skills-manifest.json. Regenerate the catalog in the source repository.');
  }
  return actual;
}
