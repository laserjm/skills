---
name: isolated-worktree-setup
description: Set up isolated Supabase worktrees on Geekom with three shared slots across repositories, Mac SSH access, and a running preview at PR handoff. Use when installing or adapting this development workflow in a repository.
---

# Isolated worktree setup

Install a repository-specific launcher for this workflow: the user creates a
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

Use the bundled `assets/worktree-slots.mjs` for the shared reservation protocol
and `assets/worktree-process.mjs` for POSIX preview lifecycle management when
the target uses Node. Read their interfaces before copying them. Keep slot
ownership compatible across apps; adapt application commands separately.
The process helper checks for HTTP 200 at a caller-supplied readiness URL.
Choose a stable route and set its Host header to the exact preview hostname.

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

## Validate and hand off

Test competing claims from separate Git repositories using a temporary shared
registry. Demonstrate three successful reservations, a rejected fourth, reuse
by the owner, and reuse after the owner stops and releases. Test that setup
preserves existing review data and that preview shutdown stops owned descendants
without signalling an unrelated process. Run the target's relevant checks.

When live validation is in scope and capacity is available, start an isolated
stack, seed it, and verify its preview through the Mac tunnel. Check login and
logout independently in two preview hostnames, auth redirects, API and storage
requests, WebSocket/HMR, and any required workers or Edge Functions. Keep test
secrets out of logs and the handoff. If services cannot be exercised, state the
specific untested paths. A successful HTTP health check alone is not proof of
cookie, Realtime, or storage isolation.

File a PR only when requested by the user or established repository workflow.
Return changed files, the port plan, validation results, and any rollout steps
for existing worktrees. For a running application preview, include the PR link,
worktree path, branch, slot, exact URL, worker status, log path, and stop command.
Installing this skill does not authorize changing every other repository or
launching workers that call paid providers.
