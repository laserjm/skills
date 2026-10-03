// Read-only inventory of the shared protocol; never claim a slot while inspecting it.
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { basename, isAbsolute, join } from "node:path";
import { slotRegistry } from "./worktree-slots.mjs";
import { identity, readProcess } from "./worktree-process.mjs";

function output(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 10000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw new Error(`Cannot read ${file}: ${error.message}`);
  }
}

function validate(record, slot, version = false) {
  if (
    !record ||
    (version && record.version !== 1) ||
    record.slot !== slot ||
    typeof record.root !== "string" ||
    !isAbsolute(record.root) ||
    typeof record.project !== "string" ||
    !/^[a-zA-Z0-9_-]+$/.test(record.project) ||
    typeof record.origin !== "string" ||
    !/^http:\/\/[^/]+$/.test(record.origin)
  )
    throw new Error(`Invalid assignment for slot ${slot}`);
  return record;
}

function presence(path) {
  try {
    if (!statSync(path).isDirectory())
      throw new Error(`${path} is not a directory`);
    return "present";
  } catch (error) {
    if (error.code === "ENOENT") return "missing";
    throw error;
  }
}

function processStatus(file) {
  const record = readProcess(file);
  return record ? { state: "running", pid: record.pid } : { state: "stopped" };
}

function ownerDetails(record, registered) {
  const { root, slot, project, origin } = record;
  const stack = join(root, ".dev/geekom");
  const base = 60000 + slot * 1000;
  const owner = {
    root,
    slot,
    project,
    registered,
    worktree: presence(root),
    repository: null,
    branch: null,
    urls: {
      app: origin,
      api: `http://127.0.0.1:${base + 21}`,
      studio: `http://localhost:${base + 23}`,
      email: `http://localhost:${base + 24}`,
    },
    ports: { app: 3000 + slot, database: base + 22, browserTests: base + 30 },
    preview: { state: "unknown" },
    worker: { state: "unknown" },
    operation: { state: "unknown" },
    log: join(stack, "preview.log"),
    shutdown: `cd '${root.replaceAll("'", "'\\''")}' && node scripts/dev-worktree.mjs stop`,
    issues: [],
  };
  if (owner.worktree === "present") {
    try {
      const gitRoot = output("git", ["rev-parse", "--show-toplevel"], root);
      if (gitRoot !== root)
        throw new Error("Path is no longer a Git worktree root");
      owner.repository = basename(
        output(
          "git",
          ["rev-parse", "--path-format=absolute", "--git-common-dir"],
          root,
        ).replace(/\/.git$/, ""),
      );
      const branch = output("git", ["rev-parse", "--abbrev-ref", "HEAD"], root);
      owner.branch = branch === "HEAD" ? "(detached)" : branch;
    } catch {
      owner.issues.push("Cannot identify Git worktree/branch");
    }
    for (const name of ["preview", "worker", "operation"]) {
      try {
        owner[name] = processStatus(join(stack, `${name}.json`));
      } catch {
        owner.issues.push(`Cannot inspect ${name} record`);
      }
    }
  }
  return owner;
}

function dockerInventory() {
  try {
    const lines = (args) =>
      output("docker", args).split("\n").filter(Boolean).map(JSON.parse);
    const containers = lines(["ps", "-a", "--format", "{{json .}}"]).map(
      (row) => ({
        name: row.Names,
        state: row.State,
        status: row.Status,
        ports: row.Ports,
        labels: Object.fromEntries(
          (row.Labels || "")
            .split(",")
            .filter(Boolean)
            .map((label) => {
              const index = label.indexOf("=");
              return [label.slice(0, index), label.slice(index + 1)];
            }),
        ),
      }),
    );
    const volumes = lines(["volume", "ls", "--format", "{{json .}}"]).map(
      (row) => row.Name,
    );
    return { state: "available", containers, volumes };
  } catch {
    return {
      state: "unknown",
      containers: [],
      volumes: [],
      error: "Docker inspection failed; service state is unknown",
    };
  }
}

function projectSlot(project) {
  return Number(project?.match(/-g([123])-[a-f0-9]{12}$/)?.[1]) || null;
}
function containerProject(container) {
  return (
    container.labels["com.supabase.cli.project"] ||
    container.name.match(/^supabase_[a-z_]+_(.+-g[123]-[a-f0-9]{12})$/)?.[1]
  );
}

export function inspectSlots(root) {
  const registry = slotRegistry();
  const slots = [1, 2, 3].map((slot) => ({
    slot,
    state: "free",
    owners: [],
    containers: [],
    volumes: [],
    issues: [],
  }));
  const warnings = [];
  const roots = new Set([root]);
  function add(record, registered) {
    const slot = slots[record.slot - 1];
    const existing = slot.owners.find(
      (owner) => owner.root === record.root && owner.project === record.project,
    );
    if (existing) {
      if (existing.urls.app !== record.origin)
        slot.issues.push("Assignment URL disagrees with reservation");
      return;
    }
    const owner = ownerDetails(record, registered);
    slot.owners.push(owner);
    slot.issues.push(...owner.issues);
    if (owner.worktree === "present") roots.add(owner.root);
  }
  for (const slot of slots) {
    try {
      const record = readJson(join(registry, `slot-${slot.slot}.json`));
      if (record !== undefined) add(validate(record, slot.slot, true), true);
    } catch (error) {
      slot.issues.push(error.message);
    }
  }
  const docker = dockerInventory();
  if (docker.error) warnings.push(docker.error);
  // Labels allow discovery of active legacy stacks from other participating repos.
  for (const container of docker.containers) {
    const workdir = container.labels["com.supabase.cli.workdir"];
    if (workdir?.endsWith("/.dev/geekom")) roots.add(workdir.slice(0, -12));
  }
  const inspected = new Set();
  for (const repository of roots) {
    let fields;
    try {
      if (presence(repository) === "missing") continue;
      fields = output(
        "git",
        ["worktree", "list", "--porcelain", "-z"],
        repository,
      ).split("\0");
    } catch {
      warnings.push(`Cannot discover worktrees from ${repository}`);
      continue;
    }
    for (const field of fields) {
      if (!field.startsWith("worktree ")) continue;
      const path = field.slice(9);
      if (inspected.has(path)) continue;
      inspected.add(path);
      try {
        const record = readJson(join(path, ".dev/geekom/worktree.json"));
        if (record === undefined) continue;
        if (!record || ![1, 2, 3].includes(record.slot) || record.root !== path)
          throw new Error(`Invalid worktree assignment at ${path}`);
        add(validate(record, record.slot), false);
      } catch (error) {
        warnings.push(error.message);
      }
    }
  }
  for (const slot of slots) {
    slot.stale = slot.owners.some(
      (owner) => owner.registered && owner.worktree === "missing",
    );
    const projects = slot.owners.map((owner) => owner.project);
    slot.containers = docker.containers
      .filter((container) => {
        const project = containerProject(container);
        return projects.includes(project) || projectSlot(project) === slot.slot;
      })
      .map(({ labels, ...container }) => ({
        ...container,
        project: containerProject({ ...container, labels }),
      }));
    slot.volumes = docker.volumes.filter(
      (name) =>
        projects.some((project) => name.endsWith(`_${project}`)) ||
        projectSlot(name) === slot.slot,
    );
    if (
      slot.owners.length > 1 ||
      slot.containers.some(
        (c) => projects.length && !projects.includes(c.project),
      )
    )
      slot.state = "conflict";
    else if (
      slot.issues.length ||
      docker.state === "unknown" ||
      warnings.length
    )
      slot.state = "unknown";
    else if (slot.owners.length) {
      const owner = slot.owners[0];
      slot.state =
        owner.worktree === "missing"
          ? "stale"
          : owner.registered
            ? "reserved"
            : "legacy";
    } else if (slot.containers.length) slot.state = "unregistered";
    const live = slot.containers.filter(
      (c) => !["exited", "created", "dead"].includes(c.state),
    );
    slot.stack =
      docker.state === "unknown"
        ? "unknown"
        : live.length
          ? live.length === slot.containers.length
            ? "running"
            : "partial"
          : "stopped";
  }
  return { registry, docker: docker.state, warnings, slots };
}

export function printSlots(report, json = false) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Registry: ${report.registry}\nDocker: ${report.docker}`);
  for (const warning of report.warnings) console.log(`Warning: ${warning}`);
  for (const slot of report.slots) {
    console.log(
      `\nSlot ${slot.slot}: ${slot.state}\n  Supabase: ${slot.stack}`,
    );
    for (const owner of slot.owners) {
      console.log(
        `  Worktree: ${owner.root} (${owner.worktree})\n  Repository: ${owner.repository || "unknown"}\n  Branch: ${owner.branch || "unknown"}\n  Project: ${owner.project}\n  Reservation: ${owner.registered ? "registered" : "legacy/unregistered"}`,
      );
      for (const [name, url] of Object.entries(owner.urls))
        console.log(`  ${name}: ${url}`);
      console.log(
        `  Database port: ${owner.ports.database}; browser-test port: ${owner.ports.browserTests}`,
      );
      for (const name of ["preview", "worker", "operation"])
        console.log(
          `  Managed ${name}: ${owner[name].state}${owner[name].pid ? ` (PID ${owner[name].pid})` : ""}`,
        );
      console.log(`  Log: ${owner.log}\n  Stop: ${owner.shutdown}`);
    }
    for (const container of slot.containers)
      console.log(
        `  Container: ${container.name} | ${container.status} | ${container.ports}`,
      );
    for (const volume of slot.volumes) console.log(`  Volume: ${volume}`);
    for (const issue of slot.issues) console.log(`  Warning: ${issue}`);
  }
}

function assertNoOwnerProcesses(root) {
  // The cleanup target is Geekom. Missing PID files cannot prove that a deleted
  // worktree's worker exited. Inspect cwd and inherited stack selection instead.
  if (process.platform !== "linux")
    throw new Error(
      "Stale cleanup requires Linux /proc inspection; run it on Geekom.",
    );
  const stackVariable = `JIGFRAME_LOCAL_STACK_DIR=${join(root, ".dev/geekom")}`;
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const directory = join("/proc", entry);
    try {
      if (statSync(directory).uid !== process.getuid()) continue;
      // Privileged services such as sshd keep root-owned process details after
      // switching uid. They are not user-owned launcher children.
      if (statSync(join(directory, "environ")).uid !== process.getuid())
        continue;
      // Container processes are inspected through Docker, not host cwd access.
      const status = readFileSync(join(directory, "status"), "utf8");
      if (/^CapPrm:\s*0*[1-9a-f][0-9a-f]*$/m.test(status)) continue;
      const namespaces = status
        .match(/^NSpid:\s*(.+)$/m)?.[1]
        .trim()
        .split(/\s+/);
      if (namespaces?.length > 1) continue;
      const cwd = readlinkSync(join(directory, "cwd")).replace(
        / \(deleted\)$/,
        "",
      );
      const env = readFileSync(join(directory, "environ"), "utf8").split("\0");
      if (
        cwd === root ||
        cwd.startsWith(`${root}/`) ||
        env.includes(stackVariable)
      )
        throw new Error(
          `Process ${entry} still belongs to the missing worktree; inspect and stop it first.`,
        );
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ESRCH") continue;
      throw new Error(
        `Cannot prove worktree processes stopped: ${error.message}`,
      );
    }
  }
}

async function assertSlotPortsFree(slot) {
  const base = 60000 + slot * 1000;
  const ports = [
    3000 + slot,
    ...Array.from({ length: 11 }, (_, i) => base + 20 + i),
  ];
  for (const port of ports) {
    for (const host of ["0.0.0.0", "::"]) {
      await new Promise((resolve, reject) => {
        const server = createServer();
        server.once("error", (error) => {
          if (
            host === "::" &&
            ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code)
          )
            resolve();
          else
            reject(
              new Error(
                `Port ${port} cannot be verified free (${error.code}); inspect its owner first.`,
              ),
            );
        });
        server.listen(
          { host, port, ipv6Only: host === "::", exclusive: true },
          () => server.close(resolve),
        );
      });
    }
  }
}

export async function removeStaleSlot(root, slot, dryRun = false) {
  const registry = slotRegistry();
  const file = join(registry, `slot-${slot}.json`);
  const before = readFileSync(file, "utf8");
  const record = validate(JSON.parse(before), slot, true);
  if (presence(record.root) !== "missing")
    throw new Error(
      "The worktree still exists. Run stop and release from its owner.",
    );
  mkdirSync(registry, { recursive: true, mode: 0o700 });
  // Serialize explicit cleanup callers. Existing launchers still reserve with wx;
  // this operation never removes an occupied owner's record to make capacity.
  const lock = join(registry, `slot-${slot}.cleanup.json`);
  try {
    writeFileSync(
      lock,
      JSON.stringify({ pid: process.pid, identity: identity(process.pid) }),
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        `Cleanup already locked: ${lock}. Inspect its PID identity before manually removing an abandoned lock.`,
      );
    throw error;
  }
  try {
    const report = inspectSlots(root);
    const target = report.slots[slot - 1];
    if (target.state !== "stale" || report.warnings.length)
      throw new Error(
        `Cannot remove slot ${slot}: ${target.state}; resolve inspection warnings/conflicts first.`,
      );
    if (
      target.containers.some(
        (container) => !["exited", "created", "dead"].includes(container.state),
      )
    )
      throw new Error(
        "Stack containers are still active. Inspect and stop the orphaned stack first.",
      );
    assertNoOwnerProcesses(record.root);
    await assertSlotPortsFree(slot);
    // Recheck after asynchronous probes; never unlink a replacement reservation.
    if (
      presence(record.root) !== "missing" ||
      readFileSync(file, "utf8") !== before
    )
      throw new Error(
        "Slot ownership changed during inspection; nothing was removed.",
      );
    if (!dryRun) unlinkSync(file);
    console.log(
      `${dryRun ? "Would remove" : "Removed"} stale reservation for slot ${slot}: ${record.project}. Database volumes and containers were preserved.`,
    );
  } finally {
    unlinkSync(lock);
  }
}
