import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
export const hash = (value) => createHash('sha256').update(value).digest('hex');

export async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${error.message}`);
  }
}

export async function statOrNull(file) {
  try {
    return await lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// A managed tree consists entirely of regular files and directories. Following
// links here would let sync change a local skill or a path outside the target.
export async function inventory(directory, prefix = '') {
  const files = new Map();
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [file, metadata] of Object.entries(await inventory(absolute, relative))) files.set(file, metadata);
    } else if (entry.isFile()) {
      const stat = await lstat(absolute);
      files.set(relative, {
        sha256: hash(await readFile(absolute)),
        executable: Boolean(stat.mode & 0o111),
      });
    } else {
      throw new Error(`Unsupported symlink or special file: ${absolute}`);
    }
  }
  return Object.fromEntries(files);
}

export async function assertSafePath(root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const stat = await statOrNull(current);
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) {
      throw new Error(`Expected a real directory, not a symlink or file: ${current}`);
    }
  }
}
