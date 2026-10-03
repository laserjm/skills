---
name: isolated-worktree-setup
description: Set up isolated Supabase worktrees on Geekom with three shared slots across repositories, Mac SSH access, and a running preview at PR handoff. Use when installing or adapting this development workflow in a repository.
---

# Isolated worktree setup

Install the versioned `@laserjm/geekom-worktrees` development package and a
repository-specific configuration for this workflow: the user creates a
worktree in T3 Code; the coding agent prepares its database and initial data,
develops and validates the feature, files the requested PR, and leaves a
running preview with its exact URL. The user keeps one SSH tunnel running on
the Mac and opens the preview in Chrome.

Each worktree gets its own Supabase project, persistent database, storage,
and browser hostname. Three slots are shared across participating repositories
on Geekom under the same Unix user. A stopped but unreleased slot still counts.

## Establish the port plan before writing scripts

Read the target repository's instructions and local development tooling.
Ask which repositories participate, where their Geekom checkouts live, and
which existing Supabase port allocations must remain. Inspect what is available
first; ask only for missing information. Present the discovered port table and
proposed shared preview ranges. Obtain the user's choice before writing or
modifying launcher scripts. An earlier explicit choice in the conversation is
sufficient; don't ask again.

Read [the shared protocol](references/shared-protocol.md). Validate the chosen
plan against every participating repository's config, existing worktree
assignments, Docker port publications, and listening ports on Geekom and the
Mac. Include enabled optional services, debug ports, frontend/HMR, browser-test
servers, and any app-specific services. An absent listener does not mean an
already reserved port is free. An existing matching SSH tunnel is expected.
If SSH or a repository is unavailable, report that part as unverified and
keep the port decision pending; don't claim cross-app isolation is validated.

Keep the ordinary checkout's existing Supabase range unchanged unless the user
requests otherwise. Resolve collisions before installing scripts. Do not stop
services, delete reservations, or reset databases to make the plan fit.

## Adapt the repository

Read [the implementation contract](references/implementation.md), then map the
repository's actual package manager, Supabase CLI version, frontend, seed
command, auth flows, and workers to that contract. Do not assume Next.js, npm,
the Jigframe directory layout, or its fixture commands.

Install a tested immutable commit from the private
[laserjm/geekom-worktrees](https://github.com/laserjm/geekom-worktrees) repository
using the target's package manager. Commit its dependency manifest and lockfile.
Read the README and configuration interface at that selected revision before
writing `geekom-worktrees.config.mjs`. Add a repository command such as
`npm run worktree -- <command>`. Do not copy or fork the package implementation.

Configure the stable app ID, frontend, seed, test and optional worker commands,
readiness route, environment mappings and Supabase relative paths. The package
owns allocation, process management, shared ports and status/cleanup. Application
settings must not override the shared port map. Keep the ordinary checkout's
ports unchanged. For existing Jigframe environments, preserve `appId: "jigframe"`,
canonical worktree paths, assignment metadata and database identities.

Verify package read access on each developer machine and in CI. Private Git
installation needs its own CI credential; use a repository-scoped read-only
deploy key or an existing authorized credential. Report an access limitation
rather than silently switching to a public or floating dependency.

Preserve required Supabase services. In particular, an app using Edge Functions
needs its functions, imports, and environment available in the generated stack;
do not copy another app's disabled edge runtime. Inspect all relative paths in
the maintained config, including SQL seeds, templates, and storage fixtures.
Keep application builds and deployment independent of this development tooling.

Update repository guidance to authorize agent preparation and running previews.
Remove contradictory bans on agents starting dev servers. Keep the T3 creation
hook limited to copying missing ignored env files; preparation runs when the
agent starts work. Add a concise `isolated-worktree.md` covering the human and
agent commands, URL discovery, tunnel, resume, stop, and release.
Include `status [slot] [--json]`, `find-stale [--json]`, and
`remove-stale <slot> [--dry-run]`. A stale reservation has a missing worktree;
stopped worktrees retain ownership. Cleanup is explicit and removes only the
reservation after verifying services have stopped; it never creates capacity
by evicting an existing owner.

## Validate and hand off

Run the shared package’s contract suite when changing its implementation. For
a consumer installation, test its actual configuration through the installed
CLI using a disposable checkout and registry. Do not duplicate the shared suite
in each consumer. The package suite protects competing claims across repositories,
process ownership and persistence. Run the target's relevant checks and ensure CI installs its development
dependency with the appropriate private-repository access. Shared tests use
external-command stand-ins and disposable processes; they do not replace live
validation of the target's auth, storage, Realtime or required Edge Functions.

When live validation is in scope and capacity is available, start an isolated
stack, seed it, and verify its preview through the Mac tunnel. Check login and
logout independently in two preview hostnames, auth redirects, API and storage
requests, WebSocket/HMR, and any required workers or Edge Functions. Keep test
secrets out of logs and the handoff. If services cannot be exercised, state the
specific untested paths. A successful HTTP health check alone is not proof of
cookie, Realtime, or storage isolation.

Roll out package updates through dependency and lockfile PRs. Changing the skill
or releasing the package does not upgrade existing consumers or feature branches.
Update configuration only when the selected release requires it.

File a PR only when requested by the user or established repository workflow.
Return changed files, the port plan, validation results, and any rollout steps
for existing worktrees. For a running application preview, include the PR link,
worktree path, branch, slot, exact URL, worker status, log path, and stop command.
Installing this skill does not authorize changing every other repository or
launching workers that call paid providers.
