// Shared protocol v1. Keep this path and record format compatible across apps.
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export function slotRegistry() {
  const state =
    process.env.GEEKOM_WORKTREE_STATE_DIR ||
    join(homedir(), ".local/state/geekom-worktrees");
  if (!isAbsolute(state))
    throw new Error("GEEKOM_WORKTREE_STATE_DIR must be absolute.");
  return join(state, "slots");
}

function slotFile(slot) {
  if (![1, 2, 3].includes(slot)) throw new Error("Choose slot 1, 2, or 3.");
  return join(slotRegistry(), `slot-${slot}.json`);
}

export function claimSlot({ root, slot, project, origin }) {
  if (!isAbsolute(root))
    throw new Error("Slot owner must be an absolute path.");
  const file = slotFile(slot);
  mkdirSync(slotRegistry(), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(
      file,
      JSON.stringify({ version: 1, root, slot, project, origin }) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    try {
      const owner = JSON.parse(readFileSync(file, "utf8"));
      return (
        owner.version === 1 &&
        owner.root === root &&
        owner.slot === slot &&
        owner.project === project &&
        owner.origin === origin
      );
    } catch {
      // Partial, malformed, or concurrently written records remain occupied.
      return false;
    }
  }
}

// Caller serializes operations for this root and verifies its services stopped.
export function releaseSlot({ root, slot }) {
  const file = slotFile(slot);
  try {
    const owner = JSON.parse(readFileSync(file, "utf8"));
    if (owner.version !== 1 || owner.root !== root || owner.slot !== slot)
      throw new Error(`Refusing to release another worktree's slot: ${file}`);
    unlinkSync(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
