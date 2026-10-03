# Repository implementation contract

## Commands and persistence

Install `@laserjm/geekom-worktrees` at an immutable Git commit and use its
`geekom-worktrees` executable, typically through `npm run worktree -- <command>`.
Read the selected revision’s README for `geekom-worktrees.config.mjs`. The package
resolves the current directory’s canonical Git root. Update older branches with
the dependency and configuration before using the new commands; do not retain
local implementation helpers or script wrappers.
Store generated config, assignment metadata, PID records, and logs under an
ignored directory such as `.dev/geekom`. Never copy this directory between trees.

| Command                           | Contract                                                                                                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prepare [slot]`                  | Reuse the worktree's assignment or atomically claim a free shared slot; derive isolated config without starting services.                                              |
| `setup [slot]`                    | Prepare, start this stack, seed only a new database or retry interrupted initial seeding.                                                                              |
| `start`                           | Start the assigned stack, preserving existing data.                                                                                                                    |
| `seed`                            | Explicitly restore fixtures only in the assigned local stack.                                                                                                          |
| `supabase ...`                    | Invoke the repository's pinned CLI with the generated workdir; reject a caller-supplied workdir override.                                                              |
| `test`, `test:browser`            | Inject the assigned stack's endpoints and credentials; use the slot's separate browser-test port.                                                                      |
| `preview`                         | Start or reuse an owned detached preview, wait for readiness, and print its exact URL, status, log, and shutdown command.                                              |
| `preview:stop`                    | Stop only this worktree's managed preview.                                                                                                                             |
| `dev`                             | Optional foreground preview using the same stack and process tracking.                                                                                                 |
| `worker`                          | Optional, separately tracked worker using the same stack.                                                                                                              |
| `info`                            | Show assignment, URLs, process status, and cleanup command without exposing keys.                                                                                      |
| `status [slot] [--json]`          | Read-only inventory of shared reservations, worktrees, branches, stack/container state, volumes, managed processes, URLs, and logs. Works from an unassigned checkout. |
| `find-stale [--json]`             | List reservations whose worktree is missing, including remaining services and inspection warnings. Stopped worktrees are not stale.                                    |
| `remove-stale <slot> [--dry-run]` | Explicitly remove one valid missing-owner reservation only after successful service/process/port checks; retain containers and volumes.                                |
| `stop`                            | Stop owned preview/worker process groups and this stack, retaining database volumes.                                                                                   |
| `release`                         | Free the global reservation only after owned and unowned local processes and stack containers have stopped; keep DB volumes.                                           |
| `tunnel`                          | On the Mac, forward the shared slot ports through the configured SSH host.                                                                                             |

Serialize lifecycle operations per worktree using exclusive filesystem creation.
A foreground server or worker must release the startup lock after its process
record is written, so a separate `stop` command can work. Verify process identity
before treating a lock as live or reclaiming it after a crash.

Detect a new database by its exact project's persistent volume, before starting
Supabase. Write a pending-initial-seed marker first, then remove it only after a
successful seed. This allows retry after failure without overwriting review data
on every resume. A pre-existing volume without a marker is preserved, including
legacy manually seeded volumes. Do not use `db reset` in automatic setup.

Seed scripts must use the assigned stack and development fixtures. Disable paid
or outbound processing during fixture creation. Explicitly apply migrations
through the pinned CLI. Changes to maintained Supabase configuration require
stopping this stack before regenerating its config.

## Slot inspection and stale cleanup

The package owns the status/cleanup implementation. Consumers configure the
application and use `status`, `find-stale` and `remove-stale` through the CLI.
These commands do not require an assigned caller or application configuration.
The shared layout is `.dev/geekom/worktree.json` with sibling process records.
Shutdown output points to the installed package executable. Keep credentials
out of status output; never dump Docker environments or Supabase status keys.

Combine the shared registry with Git worktrees in known repositories and Docker
project/workdir labels. Show legacy/unregistered stacks and conflicts rather
than inventing an owner. Stopped unregistered worktrees in unknown repositories
cannot be discovered; document this limit and require legacy migration before
cross-repository allocation. A failed Docker/Git/filesystem inspection is
unknown, not evidence of availability. Distinguish retained volumes from active
services. Managed PID status does not account for untracked legacy servers.

Cleanup removes only a well-formed protocol-v1 reservation whose root is missing.
Refuse an existing owner, conflicting evidence, active containers, failed
inspection, surviving worktree processes, or occupied ports anywhere in the
slot's IPv4/IPv6 map. The package cleanup runs on Linux/Geekom and uses `/proc`
to inspect unprivileged host processes for matching cwd or inherited stack
selection, including processes whose cwd was deleted. Privileged system
services are outside the launcher process model; container processes are checked
through Docker. Other platforms must refuse cleanup until an equivalent process
inspection is implemented. Never kill an unverified PID or stop services as a
side effect of removing a reservation.

Serialize concurrent cleanup with an exclusive per-slot lock, and recheck the
reservation and missing root after asynchronous checks before unlinking. A
crashed cleanup can leave `slot-N.cleanup.json`; report its path and require PID
identity inspection before manual lock removal. `--dry-run` performs the same
checks without removing the reservation. It may briefly create the cleanup lock
and bind slot ports for availability probes. There is no automatic cleanup from
setup and no force-delete mode for malformed records. Use the owning worktree's
stop/release flow when it still exists.

## Supabase and application wiring

Derive the generated config from the repository's maintained `supabase/config.toml`.
Use a TOML-aware transformation or a constrained transformation that fails on
missing or unsupported settings; do not silently ignore changed layouts.
Set a unique project ID from the app ID, slot, and canonical worktree-path hash.
Persist that identity and keep it stable on resume. Its Docker volumes must not
share another worktree's project ID.

Override every published port using the agreed map, including optional pooler,
mail, analytics, and inspector ports. Preserve service enablement unless the
app's requirements justify changing it. Preserve/link the current worktree's
migrations, templates, SQL seeds, Edge Functions, import maps, and other relative
config paths that the app actually uses. Inspect the pinned CLI's config shape;
mail sections and optional services differ across versions.

Read credentials and internal endpoints from the pinned CLI's status output for
this workdir. Inject them into frontend, server, seed, test, and worker processes.
Reject a hosted Supabase URL in automatic local seed/test tooling. Copied env files
must not override these selected local endpoints. Never print the full status
JSON, service keys, database passwords, or signed asset URLs in the handoff.
Only public keys may enter browser bundles.

Use browser-reachable API/storage/WebSocket URLs through the matching Mac forwards.
Keep server-only endpoints reachable on Geekom. Preserve signed URL host/path
semantics. Ensure frontend and test builds receive the correct public variables;
build-time embedding can retain the wrong backend even if runtime env is correct.
Inspect Vite or Next host checks, CORS, HMR sockets, auth site URL, OAuth/recovery
redirects, storage CORS, and Realtime. Configure the exact worktree origin.

Use a unique hostname per worktree, such as
`http://<app>-g<slot>-<path-hash>.localhost:<web-port>`.
Cookies ignore ports, so different ports on `localhost` alone are insufficient.
Use host-only cookies and inspect explicit cookie domains, names, and browser
storage keys. Never share `.localhost` domain cookies. The app must use its exact
printed hostname even when another worktree reuses the same slot later.

Bind frontend listeners to `127.0.0.1` and fail on occupied ports; disable frontend
CLIs' automatic next-port fallback. For Supabase, inspect the pinned CLI's actual
Docker publications and local exposure controls rather than assuming frontend
binding controls the containers too. Don't change machine-wide firewall policy
as part of repository setup without a separate request.

## Managed previews

The package owns process identity, foreground signal forwarding, detached
supervision, readiness checks and shutdown. Configure a stable HTTP readiness
route and, where applicable, a repository-relative JSON PID lock file. Frontend
commands must bind loopback, fail on occupied ports and leave their descendants
in the process group the launcher manages. Do not add a second process manager.
The package sends the exact preview Host header and waits for HTTP 200. A failed
new preview is stopped and must not be reported as ready.

Stop the preview and worker before fixture-mutating tests or explicit seeding.
Use a distinct browser-test port, with the selected backend injected into both
test runner and temporary server. Avoid a shared build directory when the target
framework cannot run build and dev safely together.

## Agent and human instructions

The creation hook copies only missing ignored env files from the main checkout.
It preserves existing values and starts no services. Agents install dependencies
using committed lockfiles, run setup before development, implement the feature,
apply migrations, validate, file the requested PR, then run preview. They may
start dev servers. They leave the preview and database running for review and
report failures honestly. Workers require task-specific need and authorization
for any provider usage.

The user runs one tunnel on the Mac, opens the exact reported URL, and later
runs stop and release from the owning worktree. Capacity covers development and
review. When all slots are reserved, the agent reports the owners and waits for
a slot; it never evicts another worktree. Document how to update old branches,
migrate old ownership records, and recover stale reservations through inspection.

## Evidence to include

Run the package’s shared suite on Linux when editing the implementation; macOS
must refuse Linux-only stale cleanup. Consumer coverage uses the installed CLI
and actual repository configuration to verify generated settings and assignment
reuse with a disposable registry. Keep consumer coverage focused on application
wiring rather than duplicating allocation and process-management tests.

Use a live preview to verify browser-specific behavior when authorized and
available. Record which app, stack, hostnames, browser, and paths were tested.
Keep unverified services or cross-app combinations explicit; simulated command
success is not a live Supabase integration test.
