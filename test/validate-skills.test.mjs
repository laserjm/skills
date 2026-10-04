import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { validateSkills } from '../scripts/validate-skills.mjs';

const header = '---\nname: example\ndescription: Example skill.\n---\n';

async function fixture(t, contents = header) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'skills-validation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const skill = path.join(directory, 'example');
  await mkdir(skill);
  await writeFile(path.join(skill, 'SKILL.md'), contents);
  return { directory, skill };
}

test('accepts complete skills with nested references, YAML, images, and code examples', async (t) => {
  const { directory, skill } = await fixture(t, `${header}
[Reference](references/guide.md#usage)
![Image](assets/example.png)
[External](https://example.com)
[Section](#usage)
\`\`\`md
[Code example](missing.md)
\`\`\`
`);
  await mkdir(path.join(skill, 'references'));
  await mkdir(path.join(skill, 'assets'));
  await mkdir(path.join(skill, 'agents'));
  await writeFile(path.join(skill, 'references/guide.md'), '[Skill](../SKILL.md)\n');
  await writeFile(path.join(skill, 'assets/example.png'), 'image fixture');
  await writeFile(path.join(skill, 'agents/openai.yaml'), 'interface:\n  display_name: Example\n');
  assert.equal(await validateSkills(directory), 1);
});

test('rejects missing, invalid, mismatched, or empty skill metadata', async (t) => {
  const { directory, skill } = await fixture(t);
  for (const contents of [
    '# No frontmatter\n',
    '---\nname: [\n---\n',
    '---\n- example\n---\n',
    header.replace('name: example', 'name: another'),
    header.replace('description: Example skill.', 'description: " "'),
  ]) {
    await writeFile(path.join(skill, 'SKILL.md'), contents);
    await assert.rejects(validateSkills(directory));
  }
  await rm(path.join(skill, 'SKILL.md'));
  await assert.rejects(validateSkills(directory), { code: 'ENOENT' });
});

test('rejects broken references and links outside the skill directory', async (t) => {
  const { directory, skill } = await fixture(t);
  await mkdir(path.join(directory, 'another'));
  await writeFile(path.join(directory, 'another/SKILL.md'), header.replace('name: example', 'name: another'));
  for (const [destination, error] of [
    ['references/missing.md', /Broken local link/],
    ['../another/SKILL.md', /Link leaves the skill directory/],
    ['%2e%2e/another/SKILL.md', /Link leaves the skill directory/],
  ]) {
    await writeFile(path.join(skill, 'SKILL.md'), `${header}[Reference](${destination})\n`);
    await assert.rejects(validateSkills(directory), error);
  }
});

test('rejects malformed supporting YAML and symlinked skill content', async (t) => {
  const { directory, skill } = await fixture(t);
  const metadata = path.join(skill, 'openai.yaml');
  await writeFile(metadata, 'interface: [\n');
  await assert.rejects(validateSkills(directory));
  await rm(metadata);
  await symlink('SKILL.md', path.join(skill, 'linked.md'));
  await assert.rejects(validateSkills(directory), /Unsupported symlink/);
});

test('rejects empty skill collections and invalid directory names', async (t) => {
  const { directory, skill } = await fixture(t);
  await mkdir(path.join(directory, 'Invalid_Name'));
  await assert.rejects(validateSkills(directory), /valid name/);
  await rm(path.join(directory, 'Invalid_Name'), { recursive: true });
  await rm(skill, { recursive: true });
  await assert.rejects(validateSkills(directory), /at least one skill/);
});
