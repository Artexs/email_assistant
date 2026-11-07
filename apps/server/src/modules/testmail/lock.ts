import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { HardError } from "../../platform/errors";

const MAX_LOCK_AGE_MS = 24 * 60 * 60 * 1000;

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLock(path: string): { pid: number; at: number } | null {
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as { pid?: unknown; at?: unknown };
    if (typeof data.pid !== "number" || typeof data.at !== "string") return null;
    const at = Date.parse(data.at);
    return Number.isNaN(at) ? null : { pid: data.pid, at };
  } catch {
    return null;
  }
}

// The lock appears with its content: write a temp file, then hard-link it (atomic, EEXIST on conflict).
function tryCreate(path: string, pid: number): boolean {
  const tmp = `${path}.${pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ pid, at: new Date().toISOString() }), { mode: 0o600 });
  try {
    linkSync(tmp, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    unlinkSync(tmp);
  }
}

export function acquireSendLock(
  path: string,
  opts: { pid?: number; isAlive?: (pid: number) => boolean } = {}
): { release(): void } {
  const pid = opts.pid ?? process.pid;
  const isAlive = opts.isAlive ?? pidIsAlive;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

  if (!tryCreate(path, pid)) {
    const held = readLock(path);
    if (held !== null && isAlive(held.pid) && Date.now() - held.at < MAX_LOCK_AGE_MS) {
      throw new HardError(`another testmail send runs (pid ${held.pid})`);
    }
    // Two processes may remove the same stale lock; the D3 keys bound the harm.
    try {
      unlinkSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!tryCreate(path, pid)) throw new HardError("another testmail send runs");
  }

  return {
    release() {
      if (readLock(path)?.pid !== pid) return;
      try {
        unlinkSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
  };
}
