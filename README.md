# Shared agent skills

Reusable agent skills installed directly from this repository with the
[Skills CLI](https://github.com/vercel-labs/skills). Run the following command
from the repository where you want to use the skill:

```sh
npx skills add https://github.com/laserjm/skills --skill isolated-worktree-setup
```

The CLI installs the skill and its supporting files for your selected agents.
Project installation is the default; add `--global` for a user-wide installation.
Commit project skill files and `skills-lock.json` to share them with your team.

## Available skills

| Skill | Purpose |
| --- | --- |
| [isolated-worktree-setup](skills/isolated-worktree-setup/SKILL.md) | Set up isolated Supabase worktrees on Geekom with shared slots and running previews. |
| [issue-solution-path](skills/issue-solution-path/SKILL.md) | Audit an issue or idea and develop a clear solution path. |
| [testing-policy](skills/testing-policy/SKILL.md) | Choose contract tests for critical workflows and interfaces. |

List the available skills:

```sh
npx skills add https://github.com/laserjm/skills --list
```

To install a skill for Codex and Claude Code as independent copies without
interactive prompts:

```sh
npx skills add https://github.com/laserjm/skills --skill isolated-worktree-setup --agent codex claude-code --copy --yes
```

`isolated-worktree-setup` contains instructions for installing and configuring
the separate `@laserjm/geekom-worktrees` runtime package. Installing the skill
makes those instructions available to your agent; adapting the application's
worktree tooling is a subsequent task.

## Update skills

```sh
npx skills update
```

Review and commit the resulting changes. For a specific tested release, use
`https://github.com/laserjm/skills/tree/<tag>` as the installation source; find
tags in [GitHub Releases](https://github.com/laserjm/skills/releases).

Make shared changes in this repository's `skills/` directory. Keep
repository-specific guidance in local skills or `AGENTS.md` / `CLAUDE.md`.

## Migrate from the npm installation

If a downstream repository uses the previous `@laserjm/skills` setup:

1. Review and back up local edits, then remove only the managed skill directories
   listed in its `skills-installed.json`. Preserve unrelated local skills.
2. Run `npm uninstall --save-dev @laserjm/skills` and remove the `skills:sync` and
   `skills:check` scripts, `skills.config.json`, and `skills-installed.json`.
   Remove downstream CI checks and updater jobs that invoke the old tooling.
3. Install the desired skills with `npx skills add` and commit the resulting
   skill files, `skills-lock.json`, and cleanup changes.

## Develop and validate

The authoritative skill sources live under `skills/<name>/`. Each contains a
`SKILL.md` with YAML `name` and `description`, plus any references, assets,
scripts, or agent metadata it needs. The `.agents/skills/writing-for-agents`
installation and `skills-lock.json` are this repository's authoring tools.

The npm files are development tooling for this repository. Node 22 or newer
is required to run validation:

```sh
npm ci
npm run check
```

Validation checks skill names and descriptions, supporting YAML, and local inline
Markdown links in skill documents. It rejects symlinks and links outside the
skill directory. Checks run in CI; there is no generated catalog to maintain.

To create a release, tag a validated commit on `main` with a stable version such
as `v1.1.0` and push the tag. The release workflow runs the checks and creates a
GitHub release with installation instructions and generated change notes.
