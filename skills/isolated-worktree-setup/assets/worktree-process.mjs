// POSIX process groups keep a preview and its descendants together on Mac/Linux.
import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

export function identity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    return (
      execFileSync("ps", ["-p", String(pid), "-o", "lstart=", "-o", "pgid="], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || null
    );
  } catch {
    return null;
  }
}

export function readProcess(file) {
  if (!existsSync(file)) return null;
  const record = JSON.parse(readFileSync(file, "utf8"));
  return record.identity && identity(record.pid) === record.identity
    ? record
    : null;
}

function writeProcess(file, record) {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(record) + "\n", { mode: 0o600 });
  renameSync(temporary, file);
}

function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

export async function stopManaged(file) {
  const record = readProcess(file);
  if (record) {
    const group = execFileSync(
      "ps",
      ["-p", String(record.pid), "-o", "pgid="],
      { encoding: "utf8" },
    ).trim();
    if (Number(group) !== record.pid)
      throw new Error(`Refusing to stop an unowned process group: ${file}`);
    signalGroup(record.pid, "SIGTERM");
    const deadline = Date.now() + 5000;
    while (groupAlive(record.pid) && Date.now() < deadline) await delay(100);
    if (groupAlive(record.pid)) signalGroup(record.pid, "SIGKILL");
  }
  if (existsSync(file)) unlinkSync(file);
}

export async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(
        new Error(
          `Port ${port} is occupied. Stop its owner or choose another slot.`,
        ),
      ),
    );
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () =>
      server.close(resolve),
    );
  });
}

// Only a newly launched process is stopped if startup fails. An existing
// preview remains the caller's responsibility when a health check fails.
export async function startManaged({
  file,
  log,
  cwd,
  command,
  args,
  env,
  url,
  host,
  timeout = 120000,
}) {
  let record = readProcess(file);
  const fresh = !record;
  if (fresh) {
    await assertPortFree(Number(new URL(url).port));
    const fd = openSync(log, "a", 0o600);
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    closeSync(fd);
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    record = { pid: child.pid, identity: identity(child.pid) };
    try {
      writeProcess(file, record);
    } catch (error) {
      signalGroup(child.pid, "SIGTERM");
      throw error;
    }
    child.unref();
  }
  try {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (!readProcess(file)) throw new Error(`Preview exited. Read ${log}`);
      try {
        const response = await fetch(url, {
          headers: host ? { Host: host } : {},
          signal: AbortSignal.timeout(1000),
          redirect: "manual",
        });
        await response.body?.cancel();
        if (response.status === 200) return record;
      } catch {
        /* Server may still be compiling the login page. */
      }
      await delay(250);
    }
    throw new Error(`Preview did not become ready. Read ${log}`);
  } catch (error) {
    if (fresh) await stopManaged(file);
    throw error;
  }
}

export async function runCommand(
  command,
  args,
  { cwd, env, detached = true, processFile, onSpawn } = {},
) {
  const child = spawn(command, args, { cwd, env, detached, stdio: "inherit" });
  const forward = (signal) => {
    if (detached) signalGroup(child.pid, signal);
    else child.kill(signal);
  };
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  try {
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("spawn", () => {
        try {
          if (processFile)
            writeProcess(processFile, {
              pid: child.pid,
              identity: identity(child.pid),
            });
          onSpawn?.();
        } catch (error) {
          forward("SIGTERM");
          reject(error);
        }
      });
      child.once("exit", (code, signal) =>
        code === 0
          ? resolve()
          : reject(new Error(`${command} failed (${signal || code}).`)),
      );
    });
  } finally {
    process.off("SIGINT", forward);
    process.off("SIGTERM", forward);
    if (
      processFile &&
      existsSync(processFile) &&
      JSON.parse(readFileSync(processFile, "utf8")).pid === child.pid
    )
      unlinkSync(processFile);
  }
}
