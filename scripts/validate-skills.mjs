import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(file));
    else if (entry.isFile()) files.push(file);
    else throw new Error(`Unsupported symlink or special file: ${file}`);
  }
  return files;
}

function frontmatter(contents, file) {
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`Missing YAML frontmatter: ${file}`);
  const data = parse(match[1]);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Expected YAML frontmatter mapping: ${file}`);
  }
  return data;
}

async function validateLinks(contents, file, skillRoot) {
  // Ignore fenced code examples, external URLs, and anchors.
  const prose = contents.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  for (const match of prose.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const link = match[1].replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(link)) continue;
    const destination = decodeURIComponent(link.split(/[?#]/)[0]);
    const resolved = path.resolve(path.dirname(file), destination);
    const relative = path.relative(skillRoot, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Link leaves the skill directory: ${file} -> ${link}`);
    }
    try {
      await lstat(resolved);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      throw new Error(`Broken local link: ${file} -> ${link}`);
    }
  }
}

export async function validateSkills(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  if (!entries.length) throw new Error('Expected at least one skill.');
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name) || entry.name.length > 64) {
      throw new Error(`Expected a skill directory with a valid name: ${entry.name}`);
    }
    const root = path.join(directory, entry.name);
    const files = await filesIn(root);
    const file = path.join(root, 'SKILL.md');
    const data = frontmatter(await readFile(file, 'utf8'), file);
    if (data.name !== entry.name || typeof data.description !== 'string' || !data.description.trim()) {
      throw new Error(`Skill name must match its directory and description must be nonempty: ${file}`);
    }
    for (const file of files) {
      if (file.endsWith('.md')) await validateLinks(await readFile(file, 'utf8'), file, root);
      if (/\.ya?ml$/.test(file)) parse(await readFile(file, 'utf8'));
    }
  }
  return entries.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const count = await validateSkills(fileURLToPath(new URL('../skills', import.meta.url)));
    console.log(`Validated ${count} skills and their local references.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
