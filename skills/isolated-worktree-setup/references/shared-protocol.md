# Shared Geekom slots, protocol v1

This protocol gives one Unix user three slots across participating repositories
on one Geekom. Every launcher must use the same registry and port map. It does
not coordinate another machine, another Unix account, or an older launcher that
has not been migrated. Three slots are a capacity policy, not a RAM guarantee;
check the machine's capacity for the services each app needs.

## Port map

Keep each app's ordinary local Supabase ports. Allocate this additional map to
isolated worktrees only after the user chooses it and the host audit passes.

For slot `s` in `1..3`, let `base = 60000 + s * 1000`.

| Service | Formula | Slot 1 | Slot 2 | Slot 3 |
| --- | --- | --- | --- | --- |
| Frontend and same-port HMR | `3000 + s` | 3001 | 3002 | 3003 |
| Shadow DB | `base + 20` | 61020 | 62020 | 63020 |
| API, Auth, Realtime, storage | `base + 21` | 61021 | 62021 | 63021 |
| PostgreSQL | `base + 22` | 61022 | 62022 | 63022 |
| Studio | `base + 23` | 61023 | 62023 | 63023 |
| Mail UI | `base + 24` | 61024 | 62024 | 63024 |
| Optional SMTP | `base + 25` | 61025 | 62025 | 63025 |
| Optional POP3 | `base + 26` | 61026 | 62026 | 63026 |
| Analytics | `base + 27` | 61027 | 62027 | 63027 |
| Edge inspector | `base + 28` | 61028 | 62028 | 63028 |
| Pooler | `base + 29` | 61029 | 62029 | 63029 |
| Browser-test server | `base + 30` | 61030 | 62030 | 63030 |

Reserve the entire `base + 20..30` block even when optional services are disabled.
If an app needs another published service or a separate HMR port, propose and
validate an extension across participants before using it. Do not silently assign
an arbitrary free port that the Mac tunnel does not forward.

One tunnel forwards each slot's frontend, API, Studio, and mail UI. Use SSH host
`geekom`, loopback bindings such as `-L 127.0.0.1:61021:127.0.0.1:61021`,
`-N`, `ExitOnForwardFailure=yes`, `ServerAliveInterval=30`, and
`ServerAliveCountMax=3`. PostgreSQL, debug, and test ports stay on Geekom unless
the user requests access. The frontend's HTTP and WebSocket traffic share its
forward. No `LocalForward` or hosts-file entries are needed for this convention.
Do not start another tunnel if a matching one already owns these ports.

## Reservation format

The default registry is `~/.local/state/geekom-worktrees/slots` on Geekom.
`GEEKOM_WORKTREE_STATE_DIR` overrides the parent directory with an absolute path;
all participating launchers must receive the same value. Leave it unset for
normal use. Tests must point it to a temporary directory. Do not use a repository
Git directory or let an app-specific env file redirect the registry.

A reservation is `slot-1.json`, `slot-2.json`, or `slot-3.json`:

```json
{
  "version": 1,
  "root": "/absolute/canonical/path/to/worktree",
  "slot": 1,
  "project": "app-g1-0123456789ab",
  "origin": "http://app-g1-0123456789ab.localhost:3001"
}
```

Use `realpath` for the worktree root. App ID plus a stable hash of the root makes
the project ID and hostname distinct across trees, including later slot reuse.
Store no credentials in this record. With the bundled Node module:

```js
import { claimSlot, releaseSlot, slotRegistry } from "./worktree-slots.mjs";
// Serialize commands for this worktree before claiming or releasing.
const claimed = claimSlot({ root, slot, project, origin });
// Only after this worktree's processes and Supabase containers have stopped:
releaseSlot({ root, slot });
```

Exclusive file creation reserves a slot. If creation loses a race, reuse is
allowed only when the complete version/root/slot/project/origin matches.
Malformed, partially written, unknown-version, and stale reservations count as
occupied. Do not automatically delete them because a PID or directory is missing.
Release validates the owner and deletes only its reservation. The caller must
serialize lifecycle commands per worktree and confirm services are stopped.
`slotRegistry()` gives the directory to inspect when all slots are occupied.

## Installing alongside existing launchers

Before introducing a launcher in another repository, inventory every known
worktree's assignment and every legacy per-repository reservation. This includes
stopped environments, which retain ownership. Detect duplicate slot claims and
resolve them with the affected owners; never choose a winner by overwriting files.

Update participating legacy launchers to use this protocol before allowing new
allocations. Adopt each existing assignment into the shared registry using its
own updated helper. Preserve its root, project, slot, origin, and DB volumes.
For Jigframe, run `prepare` in each assigned worktree using the updated helper;
if its generated config must change, stop its own services before retrying.
Verify the global record before setting up another repository. `prepare` respects
legacy assignments in the same Git repository, but cannot discover unknown
repositories automatically. A partially migrated machine must not allocate
across apps yet.

Don't copy or delete a live PID record to manufacture ownership. An old manual
preview needs its actual command, cwd, process start time, and process group
verified before the owner stops it and starts a managed preview. Treat old PID
files as evidence to inspect, not unconditional permission to signal that PID.
