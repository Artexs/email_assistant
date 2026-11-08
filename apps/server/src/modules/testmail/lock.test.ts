import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { acquireSendLock } from "./lock";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testmail-lock-"));
  file = join(dir, "runs", "send.lock");
  mkdirSync(join(dir, "runs"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("acquireSendLock", () => {
  test("a second acquire with a live pid throws", () => {
    const first = acquireSendLock(file, { pid: 111, isAlive: () => true });
    expect(() => acquireSendLock(file, { pid: 222, isAlive: () => true })).toThrow(
      "another testmail send runs (pid 111)"
    );
    first.release();
    expect(existsSync(file)).toBe(false);
  });

  test("a dead pid loses the lock", () => {
    acquireSendLock(file, { pid: 111, isAlive: () => true });
    acquireSendLock(file, { pid: 222, isAlive: () => false });
    expect(JSON.parse(readFileSync(file, "utf8")).pid).toBe(222);
  });

  test("a lock 25 h old is taken even with a live pid", () => {
    acquireSendLock(file, { pid: 111 });
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    writeFileSync(file, JSON.stringify({ pid: 111, at: old }));
    acquireSendLock(file, { pid: 222, isAlive: () => true });
    expect(JSON.parse(readFileSync(file, "utf8")).pid).toBe(222);
  });

  test("an unreadable lock is taken", () => {
    acquireSendLock(file, { pid: 111 });
    writeFileSync(file, "not json");
    acquireSendLock(file, { pid: 222, isAlive: () => true });
    expect(JSON.parse(readFileSync(file, "utf8")).pid).toBe(222);
  });

  test("release keeps a lock that another pid holds", () => {
    const first = acquireSendLock(file, { pid: 111 });
    writeFileSync(file, JSON.stringify({ pid: 222, at: new Date().toISOString() }));
    first.release();
    expect(JSON.parse(readFileSync(file, "utf8")).pid).toBe(222);
  });

  test("the real pid check: pid 1 counts as alive (EPERM)", () => {
    writeFileSync(file, JSON.stringify({ pid: 1, at: new Date().toISOString() }));
    expect(() => acquireSendLock(file, { pid: 222 })).toThrow("another testmail send runs (pid 1)");
  });

  test("the real pid check: our own pid counts as alive", () => {
    writeFileSync(file, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    expect(() => acquireSendLock(file, { pid: 222 })).toThrow(`(pid ${process.pid})`);
  });

  test("the real pid check: the pid of a finished process loses the lock", () => {
    const done = Bun.spawnSync(["true"]);
    writeFileSync(file, JSON.stringify({ pid: done.pid, at: new Date().toISOString() }));
    acquireSendLock(file, { pid: 222 });
    expect(JSON.parse(readFileSync(file, "utf8")).pid).toBe(222);
  });
});
