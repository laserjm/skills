import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildCatalog } from '../lib/catalog.mjs';
import { hash, inventory, json, readJson, statOrNull } from '../lib/files.mjs';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
let temporary;
let gitRoot;
let baseline;
let firstCommit;
let secondCommit;

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function spec(commit) {
  return `git+${pathToFileURL(gitRoot).href}#${commit}`;
}

async function configure(project, skills = ['testing-policy', 'isolated-worktree-setup'], targets = ['.agents/skills', '.claude/skills'], repositoryRoot = '.') {
  await writeFile(path.join(project, 'skills.config.json'), json({ schemaVersion: 1, skills, targets, repositoryRoot }));
}

async function consumer() {
  const project = await mkdtemp(path.join(temporary, 'consumer-'));
  await cp(baseline, project, { recursive: true, verbatimSymlinks: true });
  return project;
}

async function snapshot(directory, prefix = '') {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, await snapshot(file, relative));
    else if (entry.isSymbolicLink()) result[relative] = { symlink: await readlink(file) };
    else result[relative] = { hash: hash(await readFile(file)), mode: (await statOrNull(file)).mode & 0o777 };
  }
  return result;
}

function cli(project, command, { from = project, args = [] } = {}) {
  return spawnSync(process.execPath, [path.join(project, 'node_modules/@laserjm/skills/bin/skills.mjs'), command, ...args], {
    cwd: from, encoding: 'utf8', timeout: 30_000,
  });
}

function succeeds(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function fails(result, pattern) {
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, pattern);
}

before(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'laserjm-skills-test-'));
  const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], sourceRoot))[0];
  assert(packed.files.some((file) => file.path === 'skills/isolated-worktree-setup/references/shared-protocol.md'));
  assert(!packed.files.some((file) => /^(?:\.agents\/|\.claude\/|test\/|scripts\/|examples\/|\.github\/)/.test(file.path)));
  const extraction = path.join(temporary, 'extracted');
  await mkdir(extraction);
  run('tar', ['-xzf', path.join(temporary, packed.filename), '-C', extraction], sourceRoot);
  gitRoot = path.join(extraction, 'package');
  run('git', ['init', '-b', 'main'], gitRoot);
  run('git', ['config', 'user.name', 'Skills test'], gitRoot);
  run('git', ['config', 'user.email', 'skills-test@example.invalid'], gitRoot);
  run('git', ['add', '.'], gitRoot);
  run('git', ['commit', '-m', 'First test release'], gitRoot);
  firstCommit = run('git', ['rev-parse', 'HEAD'], gitRoot);
  baseline = path.join(temporary, 'baseline');
  await mkdir(baseline);
  await writeFile(path.join(baseline, 'package.json'), json({
    name: 'skills-consumer', private: true,
    devDependencies: { '@laserjm/skills': spec(firstCommit) },
    scripts: { 'skills:sync': 'laserjm-skills sync', 'skills:check': 'laserjm-skills check' },
  }));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], baseline);
  await configure(baseline);
  const policy = path.join(gitRoot, 'skills/testing-policy/SKILL.md');
  await writeFile(policy, `${await readFile(policy, 'utf8')}\nUpdated release fixture.\n`);
  await writeFile(path.join(gitRoot, 'skills-manifest.json'), json(await buildCatalog(gitRoot)));
  run('git', ['add', '.'], gitRoot);
  run('git', ['commit', '-m', 'Second test release'], gitRoot);
  secondCommit = run('git', ['rev-parse', 'HEAD'], gitRoot);
});

after(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });

test('Git-installed npm binary synchronizes both targets, verifies complete references, and repeats deterministically', async () => {
  const project = await consumer();
  run('npm', ['run', 'skills:sync'], project);
  const receipt = await readJson(path.join(project, 'skills-installed.json'));
  assert.equal(receipt.source.commit, firstCommit);
  assert.equal(receipt.installations.length, 4);
  const reference = 'isolated-worktree-setup/references/shared-protocol.md';
  assert.equal(await readFile(path.join(project, '.agents/skills', reference), 'utf8'), await readFile(path.join(sourceRoot, 'skills', reference), 'utf8'));
  const original = await snapshot(project);
  succeeds(cli(project, 'check'));
  assert.deepEqual(await snapshot(project), original, 'check must not mutate any consumer files');
  succeeds(cli(project, 'sync'));
  assert.deepEqual(await snapshot(project), original, 'sync must produce the same content and modes');
  run('npm', ['ci', '--include=dev', '--ignore-scripts', '--no-audit', '--no-fund'], project);
  run('npm', ['run', 'skills:check'], project);
});

test('changed, missing, unexpected, and non-executable files fail without healing drift', async () => {
  const project = await consumer();
  succeeds(cli(project, 'sync'));
  const policy = path.join(project, '.agents/skills/testing-policy/SKILL.md');
  await writeFile(policy, 'local edit\n');
  const changed = await snapshot(project);
  fails(cli(project, 'check'), /Changed file.*testing-policy\/SKILL.md/);
  assert.deepEqual(await snapshot(project), changed);
  succeeds(cli(project, 'sync'));
  await rm(policy);
  fails(cli(project, 'check'), /Missing file/);
  succeeds(cli(project, 'sync'));
  await writeFile(path.join(project, '.agents/skills/testing-policy/extra.md'), 'extra');
  fails(cli(project, 'check'), /Unexpected file/);
  succeeds(cli(project, 'sync'));
  await chmod(policy, 0o755);
  fails(cli(project, 'check'), /executable mode/);
  succeeds(cli(project, 'sync'));
  succeeds(cli(project, 'check'));
});

test('initial local collision aborts all writes and preserves local skills', async () => {
  const project = await consumer();
  const directory = path.join(project, '.claude/skills/testing-policy');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'SKILL.md'), 'repository-owned policy');
  const original = await snapshot(project);
  fails(cli(project, 'sync'), /Local skill collision/);
  assert.deepEqual(await snapshot(project), original);
  assert.equal(await statOrNull(path.join(project, 'skills-installed.json')), null);
});

test('deselection and target changes remove owned skills while preserving unrelated local skills', async () => {
  const project = await consumer();
  succeeds(cli(project, 'sync'));
  const local = path.join(project, '.agents/skills/local-workflow');
  await mkdir(local);
  await writeFile(path.join(local, 'SKILL.md'), 'local');
  await configure(project, ['testing-policy'], ['.agents/skills']);
  fails(cli(project, 'check'), /Stale managed skill/);
  succeeds(cli(project, 'sync'));
  succeeds(cli(project, 'check'));
  assert.equal(await readFile(path.join(local, 'SKILL.md'), 'utf8'), 'local');
  assert.equal(await statOrNull(path.join(project, '.agents/skills/isolated-worktree-setup')), null);
  assert.equal(await statOrNull(path.join(project, '.claude/skills/testing-policy')), null);
  await configure(project, [], ['.agents/skills']);
  succeeds(cli(project, 'sync'));
  succeeds(cli(project, 'check'));
  assert.equal(await statOrNull(path.join(project, '.agents/skills/testing-policy')), null);
  assert.equal(await readFile(path.join(local, 'SKILL.md'), 'utf8'), 'local');
});

test('an upgrade to another commit with the same package version requires sync; rollback restores old bytes', async () => {
  const project = await consumer();
  succeeds(cli(project, 'sync'));
  const original = await readFile(path.join(project, '.agents/skills/testing-policy/SKILL.md'), 'utf8');
  run('npm', ['install', '--save-dev', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund', `@laserjm/skills@${spec(secondCommit)}`], project);
  fails(cli(project, 'check'), /differs from.*pinned commit/);
  succeeds(cli(project, 'sync'));
  succeeds(cli(project, 'check'));
  assert.match(await readFile(path.join(project, '.agents/skills/testing-policy/SKILL.md'), 'utf8'), /Updated release fixture/);
  assert.equal((await readJson(path.join(project, 'skills-installed.json'))).source.commit, secondCommit);
  run('npm', ['install', '--save-dev', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund', `@laserjm/skills@${spec(firstCommit)}`], project);
  succeeds(cli(project, 'sync'));
  succeeds(cli(project, 'check'));
  assert.equal(await readFile(path.join(project, '.agents/skills/testing-policy/SKILL.md'), 'utf8'), original);
});

test('floating pins and lockfile mismatches fail before synchronization', async () => {
  const project = await consumer();
  const manifestFile = path.join(project, 'package.json');
  const manifest = await readJson(manifestFile);
  manifest.devDependencies['@laserjm/skills'] = 'github:laserjm/skills#main';
  await writeFile(manifestFile, json(manifest));
  fails(cli(project, 'sync'), /full lowercase 40-character/);
  manifest.devDependencies['@laserjm/skills'] = spec(firstCommit);
  await writeFile(manifestFile, json(manifest));
  const lockFile = path.join(project, 'package-lock.json');
  const lock = await readJson(lockFile);
  lock.packages['node_modules/@laserjm/skills'].resolved = spec(secondCommit);
  await writeFile(lockFile, json(lock));
  fails(cli(project, 'sync'), /different repository or commit/);
  lock.packages['node_modules/@laserjm/skills'].resolved = spec(firstCommit);
  lock.packages[''].devDependencies['@laserjm/skills'] = spec(secondCommit);
  await writeFile(lockFile, json(lock));
  fails(cli(project, 'check'), /does not match/);
  assert.equal(await statOrNull(path.join(project, '.agents')), null);
});

test('editing both manifest and lockfile to a new SHA without reinstalling cannot relabel old installed skills', async () => {
  const project = await consumer();
  succeeds(cli(project, 'sync'));
  const manifestFile = path.join(project, 'package.json');
  const manifest = await readJson(manifestFile);
  manifest.devDependencies['@laserjm/skills'] = spec(secondCommit);
  await writeFile(manifestFile, json(manifest));
  const lockFile = path.join(project, 'package-lock.json');
  const lock = await readJson(lockFile);
  lock.packages[''].devDependencies['@laserjm/skills'] = spec(secondCommit);
  lock.packages['node_modules/@laserjm/skills'].resolved = spec(secondCommit);
  await writeFile(lockFile, json(lock));
  const original = await snapshot(project);
  fails(cli(project, 'sync'), /Installed skills dependency is stale/);
  fails(cli(project, 'check'), /Installed skills dependency is stale/);
  assert.deepEqual(await snapshot(project), original);
});

test('receipt hashes cannot conceal modified content and removed receipt entries cannot conceal stale skills', async () => {
  const project = await consumer();
  succeeds(cli(project, 'sync'));
  const file = path.join(project, '.agents/skills/testing-policy/SKILL.md');
  await writeFile(file, 'tampered');
  const receiptFile = path.join(project, 'skills-installed.json');
  const receipt = await readJson(receiptFile);
  receipt.installations.find((entry) => entry.name === 'testing-policy' && entry.target === '.agents/skills').files = await inventory(path.dirname(file));
  await writeFile(receiptFile, json(receipt));
  fails(cli(project, 'check'), /Changed file/);
  succeeds(cli(project, 'sync'));
  const valid = await readJson(receiptFile);
  valid.installations = valid.installations.filter((entry) => entry.name !== 'isolated-worktree-setup');
  await writeFile(receiptFile, json(valid));
  await configure(project, ['testing-policy']);
  fails(cli(project, 'check'), /Stale managed skill/);
  fails(cli(project, 'sync'), /no receipt entry/);
});

test('missing receipt fails check and prevents adopting existing installations', async () => {
  const project = await consumer();
  fails(cli(project, 'check'), /missing or differs/);
  succeeds(cli(project, 'sync'));
  await rm(path.join(project, 'skills-installed.json'));
  fails(cli(project, 'check'), /missing or differs/);
  fails(cli(project, 'sync'), /no receipt entry/);
});

test('symlinked target directories, skills, and managed files are rejected without touching their targets', async () => {
  const project = await consumer();
  const external = await mkdtemp(path.join(temporary, 'external-'));
  await writeFile(path.join(external, 'sentinel'), 'preserve');
  await mkdir(path.join(project, '.agents'));
  await symlink(external, path.join(project, '.agents/skills'));
  fails(cli(project, 'sync'), /not a symlink/);
  await rm(path.join(project, '.agents/skills'));
  succeeds(cli(project, 'sync'));
  const directory = path.join(project, '.agents/skills/testing-policy');
  await rm(directory, { recursive: true });
  await symlink(external, directory);
  fails(cli(project, 'check'), /not a symlink/);
  fails(cli(project, 'sync'), /not a symlink/);
  await rm(directory);
  succeeds(cli(project, 'sync'));
  await symlink(path.join(external, 'sentinel'), path.join(directory, 'extra'));
  fails(cli(project, 'check'), /Unsupported symlink/);
  fails(cli(project, 'sync'), /Unsupported symlink/);
  assert.equal(await readFile(path.join(external, 'sentinel'), 'utf8'), 'preserve');
});

test('a separate tooling project installs into its repository root and supports --project', async () => {
  const root = await mkdtemp(path.join(temporary, 'non-node-repo-'));
  const project = path.join(root, '.tooling/skills');
  await mkdir(path.dirname(project), { recursive: true });
  await cp(baseline, project, { recursive: true, verbatimSymlinks: true });
  await configure(project, ['testing-policy'], ['.agents/skills'], '../..');
  succeeds(cli(project, 'sync', { from: root, args: ['--project', '.tooling/skills'] }));
  succeeds(cli(project, 'check', { from: root, args: ['--project', '.tooling/skills'] }));
  assert(await statOrNull(path.join(root, '.agents/skills/testing-policy/SKILL.md')));
  assert(await statOrNull(path.join(project, 'skills-installed.json')));
  assert.equal(await statOrNull(path.join(project, '.agents')), null);
});

test('invalid configuration, unknown skills, and unsafe receipt paths fail without writes', async () => {
  const project = await consumer();
  await configure(project, ['testing-policy'], ['../outside']);
  fails(cli(project, 'sync'), /targets must select/);
  await configure(project, ['testing-policy'], ['.agents/skills'], '/');
  fails(cli(project, 'sync'), /repositoryRoot must/);
  await configure(project, ['unknown-skill']);
  fails(cli(project, 'sync'), /Unknown selected/);
  await configure(project, ['testing-policy', 'testing-policy']);
  fails(cli(project, 'sync'), /unique skill names/);
  await configure(project, ['testing-policy']);
  succeeds(cli(project, 'sync'));
  const receiptFile = path.join(project, 'skills-installed.json');
  const receipt = await readJson(receiptFile);
  receipt.installations[0].name = '../local';
  await writeFile(receiptFile, json(receipt));
  fails(cli(project, 'sync'), /Invalid managed paths/);
});

test('installed catalog rejects missing references and modified package files', async () => {
  const project = await consumer();
  const root = path.join(project, 'node_modules/@laserjm/skills');
  await rm(path.join(root, 'skills/isolated-worktree-setup/references/shared-protocol.md'));
  fails(cli(project, 'list'), /Broken local link/);
  await cp(path.join(baseline, 'node_modules/@laserjm/skills/skills'), path.join(root, 'skills'), { recursive: true });
  await writeFile(path.join(root, 'skills/testing-policy/SKILL.md'), `${await readFile(path.join(root, 'skills/testing-policy/SKILL.md'), 'utf8')}\nchanged\n`);
  fails(cli(project, 'sync'), /differ from skills-manifest/);
});

test('global or another project’s CLI cannot claim to verify this project’s dependency', async () => {
  const first = await consumer();
  const second = await consumer();
  fails(cli(first, 'sync', { from: second }), /CLI installed in this project/);
});

test('CLI reports invalid commands and supports help and available skill listing', async () => {
  const project = await consumer();
  fails(cli(project, 'invalid'), /Usage:/);
  fails(cli(project, 'sync', { args: ['--unknown'] }), /Usage:/);
  succeeds(cli(project, '--help'));
  const listing = cli(project, 'list');
  succeeds(listing);
  assert.match(listing.stdout, /issue-solution-path:/);
  assert(!listing.stdout.includes('writing-for-agents:'));
});

test('an active or interrupted synchronization lock prevents another sync and a misleading check', async () => {
  const project = await consumer();
  succeeds(cli(project, 'sync'));
  const lock = path.join(project, '.laserjm-skills.lock');
  await writeFile(lock, 'another sync owns this lock');
  const original = await snapshot(project);
  fails(cli(project, 'sync'), /synchronization lock exists/);
  fails(cli(project, 'check'), /synchronization lock exists/);
  assert.deepEqual(await snapshot(project), original);
  await rm(lock);
  succeeds(cli(project, 'check'));
});

test('a failed final receipt write restores every prior skill directory and the previous receipt', async () => {
  const project = await consumer();
  succeeds(cli(project, 'sync'));
  run('npm', ['install', '--save-dev', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund', `@laserjm/skills@${spec(secondCommit)}`], project);
  const original = await snapshot(project);
  const preload = path.join(temporary, 'fail-receipt-rename.mjs');
  await writeFile(preload, `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const rename = fs.promises.rename;
    fs.promises.rename = async (source, destination) => {
      if (destination.endsWith('/skills-installed.json')) throw new Error('Injected final receipt write failure');
      return rename(source, destination);
    };
    syncBuiltinESMExports();
  `);
  const result = spawnSync(process.execPath, ['--import', preload, path.join(project, 'node_modules/@laserjm/skills/bin/skills.mjs'), 'sync'], {
    cwd: project, encoding: 'utf8', timeout: 30_000,
  });
  fails(result, /Injected final receipt write failure/);
  assert.deepEqual(await snapshot(project), original);
  succeeds(cli(project, 'sync'));
  succeeds(cli(project, 'check'));
});

test('a failed rollback retains the backup instead of deleting the last original copy', async () => {
  const project = await consumer();
  succeeds(cli(project, 'sync'));
  const original = await readFile(path.join(project, '.agents/skills/testing-policy/SKILL.md'), 'utf8');
  const preload = path.join(temporary, 'fail-rollback.mjs');
  await writeFile(preload, `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const rename = fs.promises.rename;
    fs.promises.rename = async (source, destination) => {
      if (destination.endsWith('/skills-installed.json')) throw new Error('Injected final receipt write failure');
      if (source.includes('/old/.agents/skills/testing-policy')) throw new Error('Injected backup restore failure');
      return rename(source, destination);
    };
    syncBuiltinESMExports();
  `);
  const result = spawnSync(process.execPath, ['--import', preload, path.join(project, 'node_modules/@laserjm/skills/bin/skills.mjs'), 'sync'], {
    cwd: project, encoding: 'utf8', timeout: 30_000,
  });
  fails(result, /Backups preserved in/);
  const stage = (await readdir(project)).find((name) => name.startsWith('.laserjm-skills-'));
  assert(stage, 'recovery directory must remain');
  assert.equal(await readFile(path.join(project, stage, 'old/.agents/skills/testing-policy/SKILL.md'), 'utf8'), original);
  assert.equal(await statOrNull(path.join(project, '.laserjm-skills.lock')), null);
});
