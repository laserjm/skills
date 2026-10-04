import { cp, mkdir, mkdtemp, open, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { loadCatalog, validName } from './catalog.mjs';
import { assertSafePath, hash, inventory, json, readJson, statOrNull } from './files.mjs';

const packageName = '@laserjm/skills';
const targets = ['.agents/skills', '.claude/skills'];
const markerName = '.laserjm-skill.json';
const receiptName = 'skills-installed.json';
const lockName = '.laserjm-skills.lock';

export function gitPin(spec) {
  if (typeof spec !== 'string') throw new Error('Missing @laserjm/skills devDependency.');
  const match = spec.match(/^(github:[\w.-]+\/[\w.-]+|git\+(?:ssh|https|file):\/\/[^\s#]+)#([a-f0-9]{40})$/);
  if (!match) throw new Error('@laserjm/skills must be a Git devDependency pinned to a full lowercase 40-character commit SHA.');
  const [, remote, commit] = match;
  let repository;
  if (remote.startsWith('github:')) {
    repository = `github.com/${remote.slice(7).replace(/\.git$/, '').toLowerCase()}`;
  } else {
    const url = new URL(remote.slice(4));
    repository = `${url.host}${url.pathname.replace(/\.git$/, '')}`;
    if (url.hostname === 'github.com') repository = repository.toLowerCase();
  }
  return { commit, repository };
}

function selection(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || config.schemaVersion !== 1 || Object.keys(config).some((key) => !['schemaVersion', 'skills', 'targets', 'repositoryRoot'].includes(key))) {
    throw new Error('skills.config.json requires schemaVersion: 1 and only skills, targets, and optional repositoryRoot.');
  }
  if (!Array.isArray(config.skills) || config.skills.some((name) => !validName(name)) || new Set(config.skills).size !== config.skills.length) {
    throw new Error('skills must be an array of unique skill names. Use [] to remove all managed skills.');
  }
  if (!Array.isArray(config.targets) || !config.targets.length || config.targets.some((target) => !targets.includes(target)) || new Set(config.targets).size !== config.targets.length) {
    throw new Error('targets must select unique .agents/skills and/or .claude/skills directories.');
  }
  const repositoryRoot = config.repositoryRoot ?? '.';
  if (typeof repositoryRoot !== 'string' || !/^(?:\.|\.\.(?:\/\.\.)*)$/.test(repositoryRoot)) {
    throw new Error('repositoryRoot must be . or an ancestor such as ../.., relative to the package project.');
  }
  return { ...config, repositoryRoot };
}

function validateReceipt(receipt, config) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || receipt.schemaVersion !== 1 || receipt.repositoryRoot !== config.repositoryRoot || !Array.isArray(receipt.installations)) {
    throw new Error('Invalid installation receipt or changed repositoryRoot. Restore skills-installed.json before syncing.');
  }
  const previousPin = gitPin(receipt.source?.dependency);
  if (receipt.source.commit !== previousPin.commit) throw new Error('Installation receipt has inconsistent commit provenance.');
  const seen = new Set();
  for (const entry of receipt.installations) {
    const key = `${entry.target}/${entry.name}`;
    if (!targets.includes(entry.target) || !validName(entry.name) || seen.has(key) || !entry.files || typeof entry.files !== 'object' || Array.isArray(entry.files)) {
      throw new Error('Invalid managed paths in skills-installed.json.');
    }
    seen.add(key);
  }
}

function marker(name, commit) {
  return { schemaVersion: 1, package: packageName, skill: name, commit };
}

async function context(projectDirectory, packageDirectory) {
  const project = await realpath(projectDirectory);
  const config = selection(await readJson(path.join(project, 'skills.config.json')));
  const root = await realpath(path.resolve(project, config.repositoryRoot));
  const manifest = await readJson(path.join(project, 'package.json'));
  const dependency = manifest.devDependencies?.[packageName];
  const pin = gitPin(dependency);
  if (manifest.dependencies?.[packageName]) throw new Error('@laserjm/skills belongs only in devDependencies.');
  const lock = await readJson(path.join(project, 'package-lock.json'));
  const locked = lock.packages?.[`node_modules/${packageName}`];
  if (![2, 3].includes(lock.lockfileVersion) || lock.packages?.['']?.devDependencies?.[packageName] !== dependency || !locked) {
    throw new Error('package-lock.json does not match the skills devDependency. Run npm install and commit the lockfile.');
  }
  const lockedPin = gitPin(locked.resolved);
  if (!isDeepStrictEqual(pin, lockedPin)) {
    throw new Error('package-lock.json resolves @laserjm/skills to a different repository or commit.');
  }
  const installed = await realpath(path.join(project, 'node_modules', packageName));
  if (installed !== await realpath(packageDirectory)) {
    throw new Error('Run the CLI installed in this project, using npm run skills:sync or skills:check.');
  }
  const installedLock = await readJson(path.join(project, 'node_modules', '.package-lock.json'));
  const installedEntry = installedLock.packages?.[`node_modules/${packageName}`];
  if (!installedEntry || !isDeepStrictEqual(gitPin(installedEntry.resolved), pin) || installedEntry.version !== locked.version) {
    throw new Error('Installed skills dependency is stale relative to the pinned commit. Run npm ci before syncing or checking.');
  }
  const catalog = await loadCatalog(installed);
  if (catalog.package !== packageName || catalog.version !== locked.version) {
    throw new Error('Installed package identity/version disagrees with package-lock.json. Run npm ci.');
  }
  const unknown = config.skills.filter((name) => !Object.hasOwn(catalog.skills, name));
  if (unknown.length) throw new Error(`Unknown selected skills: ${unknown.join(', ')}. Run laserjm-skills list.`);
  const receiptFile = path.join(project, receiptName);
  const receiptStat = await statOrNull(receiptFile);
  if (receiptStat && (!receiptStat.isFile() || receiptStat.isSymbolicLink())) {
    throw new Error(`${receiptName} must be a regular file.`);
  }
  const previous = receiptStat ? await readJson(receiptFile) : null;
  if (receiptStat) validateReceipt(previous, config);
  const source = { dependency, commit: pin.commit, version: catalog.version };
  const installations = [];
  for (const target of [...config.targets].sort()) {
    await assertSafePath(root, target);
    for (const name of [...config.skills].sort()) {
      const files = { ...catalog.skills[name].files };
      files[markerName] = { sha256: hash(json(marker(name, pin.commit))), executable: false };
      installations.push({ target, name, files });
    }
  }
  for (const entry of previous?.installations ?? []) await assertSafePath(root, entry.target);
  const expected = { schemaVersion: 1, repositoryRoot: config.repositoryRoot, source, installations };
  return { project, root, installed, previous, expected, receiptFile };
}

// Ownership markers also catch stale installations when somebody removes a
// managed entry from the receipt. Unmarked, unrelated local skills are ignored.
async function markedDirectories(root) {
  const found = [];
  for (const target of targets) {
    try {
      await assertSafePath(root, target);
    } catch {
      continue; // An unselected local target may legitimately be a symlink.
    }
    if (!await statOrNull(path.join(root, target))) continue;
    for (const entry of await readdir(path.join(root, target), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(root, target, entry.name, markerName);
      const stat = await statOrNull(file);
      if (!stat?.isFile() || stat.isSymbolicLink()) continue;
      let data;
      try { data = await readJson(file); } catch { continue; }
      if (data?.package === packageName) found.push(`${target}/${entry.name}`);
    }
  }
  return found.sort();
}

export async function check(project, packageDirectory) {
  const state = await context(project, packageDirectory);
  if (await statOrNull(path.join(state.root, lockName))) {
    throw new Error('A skills synchronization lock exists. Finish the active sync, or recover an interrupted sync before checking.');
  }
  const errors = [];
  if (!isDeepStrictEqual(state.previous, state.expected)) {
    errors.push(`${receiptName} is missing or differs from the selected skills and pinned commit.`);
  }
  const wanted = new Set(state.expected.installations.map((entry) => `${entry.target}/${entry.name}`));
  for (const relative of await markedDirectories(state.root)) {
    if (!wanted.has(relative)) errors.push(`Stale managed skill: ${relative}`);
  }
  for (const entry of state.previous?.installations ?? []) {
    const relative = `${entry.target}/${entry.name}`;
    if (!wanted.has(relative) && await statOrNull(path.join(state.root, relative))) {
      errors.push(`Deselected skill still exists: ${relative}`);
    }
  }
  for (const entry of state.expected.installations) {
    const relative = `${entry.target}/${entry.name}`;
    const directory = path.join(state.root, relative);
    try {
      await assertSafePath(state.root, relative);
      if (!await statOrNull(directory)) {
        errors.push(`Missing skill: ${relative}`);
        continue;
      }
      const actual = await inventory(directory);
      for (const file of new Set([...Object.keys(entry.files), ...Object.keys(actual)])) {
        if (!Object.hasOwn(actual, file)) errors.push(`Missing file: ${relative}/${file}`);
        else if (!Object.hasOwn(entry.files, file)) errors.push(`Unexpected file: ${relative}/${file}`);
        else if (!isDeepStrictEqual(entry.files[file], actual[file])) errors.push(`Changed file or executable mode: ${relative}/${file}`);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (errors.length) throw new Error(`${errors.join('\n')}\nRun npm run skills:sync deliberately, review the diff, and commit the installed files and receipt.`);
  return state.expected;
}

async function synchronize(project, packageDirectory) {
  const state = await context(project, packageDirectory);
  const previous = new Map((state.previous?.installations ?? []).map((entry) => [`${entry.target}/${entry.name}`, entry]));
  const desired = new Map(state.expected.installations.map((entry) => [`${entry.target}/${entry.name}`, entry]));
  for (const relative of await markedDirectories(state.root)) {
    if (!previous.has(relative)) throw new Error(`Managed skill has no receipt entry: ${relative}. Restore ${receiptName} before syncing.`);
  }
  const paths = [...new Set([...previous.keys(), ...desired.keys()])].sort();
  // Preflight every path before replacing anything, including deselected skills.
  for (const relative of paths) {
    await assertSafePath(state.root, relative);
    if (!await statOrNull(path.join(state.root, relative))) continue;
    if (!previous.has(relative)) {
      throw new Error(`Local skill collision: ${relative}. Move the local skill to a distinct name, or remove the old copy explicitly before syncing.`);
    }
    const ownership = await readJson(path.join(state.root, relative, markerName));
    if (!isDeepStrictEqual(ownership, marker(previous.get(relative).name, state.previous.source.commit))) {
      throw new Error(`Ownership marker differs from the receipt: ${relative}. Restore the marker before syncing.`);
    }
    await inventory(path.join(state.root, relative));
  }
  const stage = await mkdtemp(path.join(state.root, '.laserjm-skills-'));
  const changes = [];
  let preserveStage = false;
  const stagedReceipt = path.join(state.project, `.skills-installed-${path.basename(stage)}.json`);
  try {
    for (const [relative, entry] of desired) {
      const directory = path.join(stage, 'new', relative);
      await mkdir(path.dirname(directory), { recursive: true });
      await cp(path.join(state.installed, 'skills', entry.name), directory, { recursive: true });
      await writeFile(path.join(directory, markerName), json(marker(entry.name, state.expected.source.commit)), { mode: 0o644 });
    }
    await writeFile(stagedReceipt, json(state.expected), { mode: 0o644 });
    for (const relative of paths) {
      const destination = path.join(state.root, relative);
      const backup = path.join(stage, 'old', relative);
      const change = { destination, backup, hadPrevious: false, hasNew: false };
      changes.push(change);
      await mkdir(path.dirname(destination), { recursive: true });
      if (await statOrNull(destination)) {
        await mkdir(path.dirname(backup), { recursive: true });
        await rename(destination, backup);
        change.hadPrevious = true;
      }
      if (desired.has(relative)) {
        await rename(path.join(stage, 'new', relative), destination);
        change.hasNew = true;
      }
    }
    await rename(stagedReceipt, state.receiptFile);
  } catch (error) {
    const rollbackErrors = [];
    for (const change of changes.reverse()) {
      try {
        if (change.hasNew) await rm(change.destination, { recursive: true, force: true });
        if (change.hadPrevious) await rename(change.backup, change.destination);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    }
    if (rollbackErrors.length) {
      preserveStage = true;
      throw new Error(`Sync failed: ${error.message}\nRollback needs recovery: ${rollbackErrors.join('; ')}\nBackups preserved in ${stage}`, { cause: error });
    }
    throw error;
  } finally {
    await rm(stagedReceipt, { force: true });
    if (!preserveStage) await rm(stage, { recursive: true, force: true });
  }
  return state.expected;
}

export async function sync(projectDirectory, packageDirectory) {
  const project = await realpath(projectDirectory);
  const config = selection(await readJson(path.join(project, 'skills.config.json')));
  const root = await realpath(path.resolve(project, config.repositoryRoot));
  const lockFile = path.join(root, lockName);
  let lock;
  try {
    lock = await open(lockFile, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('A skills synchronization lock exists. Finish the active sync, or recover an interrupted sync before syncing.');
    throw error;
  }
  try {
    await lock.writeFile(json({ pid: process.pid, project }));
    return await synchronize(project, packageDirectory);
  } finally {
    await lock.close();
    await rm(lockFile);
  }
}
