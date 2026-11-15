import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { readServeStatus, SERVE_LOCK_STALE_MS, takeServeLock, writeServeStatus } from "./serve-files";

let dir = "";
const children: { kill: () => void }[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "f113-s11-lock-"));
});
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
  rmSync(dir, { recursive: true, force: true });
});

const HELPER = join(import.meta.dir, "serve-lock-holder.test-helper.ts");
const lockPath = (): string => join(dir, "locks", "serve.lock");

// Starts a child process that takes the lock; resolves with its first output line.
async function child(mode?: string) {
  const proc = Bun.spawn([process.execPath, HELPER, dir, ...(mode === undefined ? [] : [mode])], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  children.push({ kill: () => proc.kill() });
  const reader = proc.stdout.getReader();
  const first = new TextDecoder().decode((await reader.read()).value).trim();
  return { proc, first };
}

describe("the serve lock", () => {
  test("two processes: the second one cannot take the lock while the first lives; it can after the first exits", async () => {
    const holder = await child();
    expect(holder.first).toBe("HELD");
    expect(takeServeLock(dir)).toBeUndefined();
    const second = await child();
    expect(second.first).toBe("REFUSED");
    holder.proc.stdin.end();
    await holder.proc.exited;
    const lock = takeServeLock(dir);
    expect(lock).toBeDefined();
    lock?.release();
  });

  test("a crashed holder (the process is gone, the file stays) is taken over at once", async () => {
    const crashed = await child("crash");
    expect(crashed.first).toBe("HELD");
    await crashed.proc.exited;
    expect(readFileSync(lockPath(), "utf8")).toContain("pid");
    const lock = takeServeLock(dir);
    expect(lock).toBeDefined();
    lock?.release();
  });

  test("the same process cannot take the lock twice; release frees it", () => {
    const first = takeServeLock(dir);
    expect(first).toBeDefined();
    expect(takeServeLock(dir)).toBeUndefined();
    first?.release();
    const again = takeServeLock(dir);
    expect(again).toBeDefined();
    again?.release();
  });

  test("a lock of another container is held while fresh and stale after the heartbeat time", () => {
    mkdirSync(join(dir, "locks"), { recursive: true });
    writeFileSync(lockPath(), `${JSON.stringify({ host: `${hostname()}-other`, pid: 1, token: "t" })}\n`);
    expect(takeServeLock(dir)).toBeUndefined();
    const old = new Date(Date.now() - SERVE_LOCK_STALE_MS - 5000);
    utimesSync(lockPath(), old, old);
    const lock = takeServeLock(dir);
    expect(lock).toBeDefined();
    lock?.release();
  });

  test("a fresh touch keeps a lock of another container alive", () => {
    mkdirSync(join(dir, "locks"), { recursive: true });
    writeFileSync(lockPath(), `${JSON.stringify({ host: "other", pid: 1, token: "t" })}\n`);
    const old = new Date(Date.now() - SERVE_LOCK_STALE_MS - 5000);
    utimesSync(lockPath(), old, old);
    utimesSync(lockPath(), new Date(), new Date());
    expect(takeServeLock(dir)).toBeUndefined();
  });

  test("the same container restarted (same host and process id, token not held here) takes over at once", () => {
    mkdirSync(join(dir, "locks"), { recursive: true });
    writeFileSync(lockPath(), `${JSON.stringify({ host: hostname(), pid: process.pid, token: "old" })}\n`);
    const lock = takeServeLock(dir);
    expect(lock).toBeDefined();
    lock?.release();
  });

  test("release leaves a lock that another process took over", () => {
    const first = takeServeLock(dir);
    writeFileSync(lockPath(), `${JSON.stringify({ host: "other", pid: 1, token: "theirs" })}\n`);
    first?.release();
    expect(readFileSync(lockPath(), "utf8")).toContain("theirs");
  });
});

describe("serve.json", () => {
  test("is absent before the first tick, then holds what the last tick wrote", () => {
    expect(readServeStatus(dir)).toBeUndefined();
    writeServeStatus(dir, { tickAt: "2026-11-23T09:00:00.000Z", runs: { "day-1": { injector: 2 } } });
    expect(readServeStatus(dir)).toEqual({ tickAt: "2026-11-23T09:00:00.000Z", runs: { "day-1": { injector: 2 } } });
  });
});
