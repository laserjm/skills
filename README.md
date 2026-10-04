# Shared agent skills

`@laserjm/skills` is an npm development package installed directly from this
GitHub repository at a full commit SHA. It provides selected, repository-scoped
skills plus explicit synchronization and read-only drift checks. No package
registry or install-time build is needed. Node 22 or newer is required.

## Install in a downstream repository

Choose a tested release from [GitHub Releases](https://github.com/laserjm/skills/releases)
and copy its full commit pin. The dependency looks like this; replace the
placeholder with the release's actual 40-character SHA:

```json
{
  "devDependencies": {
    "@laserjm/skills": "github:laserjm/skills#<full-40-character-commit-sha>"
  },
  "scripts": {
    "skills:sync": "laserjm-skills sync",
    "skills:check": "laserjm-skills check"
  }
}
```

Install the selected commit using npm, then create `skills.config.json` at the
npm project root:

```sh
npm install --save-dev --save-exact '@laserjm/skills@github:laserjm/skills#<full-40-character-commit-sha>'
```

```json
{
  "schemaVersion": 1,
  "skills": ["issue-solution-path", "testing-policy"],
  "targets": [".agents/skills"]
}
```

List available skills with `npm exec --no -- laserjm-skills list` after installing
the dependency. Include `isolated-worktree-setup` when that rollout workflow is
relevant. Add `.claude/skills` to `targets` when Claude Code also needs the selected
skills. Both targets receive complete independent copies, including references,
assets, scripts, and agent metadata. Targets are intentionally limited to these
two discovery directories. Selection is explicit: a new skill in a release is
available without being installed automatically.

```sh
npm run skills:sync
npm run skills:check
```

Commit the dependency manifest, `package-lock.json`, configuration, generated
`skills-installed.json` receipt, and selected skill directories. The receipt and
per-directory `.laserjm-skill.json` markers record ownership and commit provenance.
They are distinct from the third-party installer format in `skills-lock.json`.
Committed skills are available to agents immediately after checkout, before npm
installation. For stable checkout bytes, add these rules to the consumer's
`.gitattributes`:

```gitattributes
.agents/skills/** text=auto eol=lf
.claude/skills/** text=auto eol=lf
skills-installed.json text eol=lf
```

The verifier currently supports npm projects with lockfile version 2 or 3 and a
direct dependency installed in the selected project's `node_modules`. It also
accepts full-SHA `git+https://`, `git+ssh://`, and `git+file://` dependencies; the
GitHub shorthand above is the standard downstream form. Run from the project
root or pass `--project <directory>` to the CLI. pnpm, Yarn, Bun, and hoisted
workspace dependencies need their own lockfile adapters before use.

## Synchronization and local changes

`skills:check` verifies the declared Git pin, lockfile repository and commit,
installed Git provenance from npm's hidden lockfile, packaged catalog, receipt, every managed file's
bytes and executable bit, and stale ownership markers. It fails on missing,
changed, or unexpected files and makes no changes. Receipt hashes cannot conceal
edits because the expected content comes from the installed package.

`skills:sync` deliberately replaces whole owned skill directories, including
local edits and extra files, and removes deselected owned directories. Review the
diff before committing. An empty `skills` array removes all owned installations.
Local skills with other names are preserved. A selected name that collides with
an unowned local directory stops synchronization before any replacement; move
that local skill to a distinct name or remove the old copy explicitly. Existing
copies from another installer are also collisions, even if their content matches.

Keep repository-specific instructions in local skills or `AGENTS.md`/`CLAUDE.md`.
A useful agent instruction is: “Shared skill directories are generated from the
pinned `@laserjm/skills` dependency. Make shared changes in the skills source
repository; keep repository-specific guidance in local instructions.”

The CLI rejects symlinked managed paths and serializes synchronization with a
repository-root `.laserjm-skills.lock`. Replacement is staged with backups and
rolls back on an ordinary write failure. If a process is interrupted, inspect
the lock's PID, restore any partial changes from Git or the retained
`.laserjm-skills-*` staging directory, and remove the lock only after confirming
no synchronization is running. Restore a missing or damaged receipt/ownership
marker from Git before syncing; the CLI does not silently adopt directories.

## Downstream CI

Copy [the drift workflow](examples/skills-check.yml) into the consumer's
`.github/workflows/` and make its **Skills drift** check required in repository
settings. Run it on every PR, including dependency and instruction changes:

```sh
npm ci --include=dev
npm run skills:check
```

Run verification against the checked-in files; running synchronization first
would conceal drift. The example pins Node 24.13.1 and npm 11.8.0. Adapt it to the
consumer's supported versions while keeping developer and CI tooling consistent.
With npm 12, enable Git dependencies explicitly with `allow-git=root` in the
consumer's `.npmrc`; npm 11.8 does not recognize that setting.

This repository is currently public. If the source becomes private, configure
Git read access before installation on each developer machine and in CI. Use a
read-only deploy key for this repository or an existing authorized credential.
Use an explicit `git+ssh://git@github.com/laserjm/skills.git#<sha>` pin with SSH
credentials, or configure Git's HTTPS credential helper with a token that can
read the source. A downstream repository's ordinary `GITHUB_TOKEN` does not
automatically have access to another private repository. Never put credentials
in the dependency URL or lockfile. This is Git access, not GitHub Packages access.

## Upgrade and rollback

Install a tested release commit, run synchronization and verification, and open
one PR containing the new dependency SHA, lockfile, installed files, and receipt.
Review the skill diffs and release notes for behavior changes. Rollback uses the
same commands with the previous SHA. The commit is authoritative; two commits
with the same package version remain distinct installations.

A newly released upstream commit leaves existing consumers and feature branches
on their chosen pins. Required CI detects divergence from that pin, while a
scheduled updater handles adoption of newer releases.

[The optional updater workflow](examples/update-skills.yml) runs weekly or on
manual dispatch. It resolves the latest stable GitHub release tag to its full
commit SHA, verifies the current installation before updating, synchronizes and
checks the new package, and opens a PR with all generated files. It reuses an
existing open PR for that commit and never force-pushes a branch. Enable it only
after the first stable release exists. Configure `SKILLS_UPDATE_TOKEN` with a bot
PAT or GitHub App token that can read the skills repository and write contents
and PRs in the consumer. Using a bot token lets the resulting PR trigger normal
CI; PRs created with `GITHUB_TOKEN` ordinarily do not trigger those workflows.
The example assumes npm tooling at the repository root; adapt its working
directory, cache path, receipt location, and staged paths for separate tooling.

`isolated-worktree-setup` remains instructions for installing the independently
pinned `@laserjm/geekom-worktrees` package. Installing or updating skills does
not install that package, modify its configuration, or start development services.

## Repositories without a Node application

Put the npm manifest, lockfile, configuration, and receipt under `.tooling/skills/`
and set `"repositoryRoot": "../.."` in that configuration. Keep targets relative
to the repository root. Install and run npm scripts inside `.tooling/skills`, or
call its installed CLI with `--project .tooling/skills`. Adapt the CI cache's
`cache-dependency-path` and working directory accordingly. This adds isolated
development tooling rather than an application dependency.

## Maintain and release this package

The authoritative distribution source is `skills/`. The installed
`.agents/skills/writing-for-agents` authoring dependency and its lockfile remain
repository tooling and are excluded from the package. Workflow examples and
tests are also excluded. The package's explicit file allowlist includes the
CLI, supporting library, complete skill directories, and generated catalog;
`private: true` prevents accidental npm registry publication.

```sh
npm ci --ignore-scripts
# After editing a shared skill or the package version:
npm run catalog:write
npm run check
```

Catalog validation parses YAML, requires a matching skill name and nonempty
description, rejects symlinks, and checks local inline Markdown links stay inside
each packaged skill and resolve. The contract suite installs the actual npm
tarball from a local Git repository at a commit SHA. It exercises both discovery
targets, drift, collisions, upgrades between equal versions, rollback, deselection,
read-only checks, frozen reinstall, and separate tooling projects.

Use semantic versions for release communication: patch for repairs that preserve
behavior, minor for optional additions and compatible tooling, and major for
changed mandatory workflows, permissions, removed/renamed skills, or incompatible
configuration. Release PRs should describe affected skills and downstream
migrations. After the release commit has merged into `main`, create and push a
stable tag matching `package.json`, for example `v1.0.0`. The tag-triggered release
workflow verifies main ancestry, runs package checks, and creates a GitHub release
with generated PR notes and the full installation SHA. It never publishes to a
registry. Keep previous release commits reachable through their tags; corrections
get new commits and releases rather than retargeting an existing tag.
