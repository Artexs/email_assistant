import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { acquireStateLock, appendLedgerLine, defaultLedgerPath, ledgerLine, monthSpend, runCap } from "./eval-ledger";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "f097-ledger-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("monthSpend", () => {
  test("sums the lines of the month and skips a broken line", () => {
    const text = [
      ledgerLine({ runId: "a", at: new Date("2026-11-03T10:00:00Z"), usd: 0.4, label: "lab-01-dev-m" }),
      "{ not json\n",
      ledgerLine({ runId: "b", at: new Date("2026-11-30T23:59:59Z"), usd: 0.5, label: "lab-01-dev-m" }),
      ledgerLine({ runId: "c", at: new Date("2026-10-31T23:59:59Z"), usd: 3, label: "lab-01-dev-m" }),
    ].join("");
    expect(monthSpend(text, "2026-11")).toBeCloseTo(0.9, 10);
  });

  test("a negative or non-finite usd never lowers the month spend", () => {
    const at = "2026-11-03T10:00:00Z";
    const text = [
      `{"runId":"a","at":"${at}","usd":0.4,"label":"l"}`,
      `{"runId":"b","at":"${at}","usd":-5,"label":"l"}`,
      `{"runId":"c","at":"${at}","usd":1e999,"label":"l"}`,
      `{"runId":"d","at":"${at}","usd":"NaN","label":"l"}`,
      `{"runId":"e","at":"${at}","usd":null,"label":"l"}`,
    ].join("\n");
    expect(monthSpend(text, "2026-11")).toBeCloseTo(0.4, 12);
  });

  test("a line has the run id, the ISO time, the dollars and the label", () => {
    const line = ledgerLine({ runId: "r1", at: new Date("2026-11-03T10:00:00Z"), usd: 0.25, label: "lab-01-dev-m" });
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual({ runId: "r1", at: "2026-11-03T10:00:00.000Z", usd: 0.25, label: "lab-01-dev-m" });
  });
});

describe("runCap", () => {
  test("the month rule lowers the cap, never below zero", () => {
    expect(runCap({ requested: 1, monthSpent: 19.5, monthCap: 20 })).toBe(0.5);
    expect(runCap({ requested: 1, monthSpent: 21, monthCap: 20 })).toBe(0);
    expect(runCap({ requested: 1, monthSpent: 2, monthCap: 20 })).toBe(1);
  });
});

describe("acquireStateLock", () => {
  const now = new Date("2026-11-14T12:00:00Z");

  test("a second lock on the same file throws with the lock path only; release frees it", () => {
    const state = join(dir, "run.jsonl");
    const release = acquireStateLock(state, now, { fresh: false });
    expect(() => acquireStateLock(state, now, { fresh: false })).toThrow(`${state}.lock`);
    try {
      acquireStateLock(state, now, { fresh: false });
    } catch (error) {
      expect((error as Error).message).toBe(`state file is locked by another run: ${state}.lock`);
    }
    release();
    acquireStateLock(state, now, { fresh: false })();
  });

  test("a lock older than 6 h is taken over only with fresh", () => {
    const state = join(dir, "old.jsonl");
    writeFileSync(`${state}.lock`, `${new Date(now.getTime() - 7 * 3_600_000).toISOString()}\n`);
    expect(() => acquireStateLock(state, now, { fresh: false })).toThrow(`${state}.lock`);
    const release = acquireStateLock(state, now, { fresh: true });
    expect(() => acquireStateLock(state, now, { fresh: true })).toThrow(`${state}.lock`);
    release();
  });

  test("a takeover leaves no parked lock behind and the new lock holds the new time", () => {
    const state = join(dir, "taken.jsonl");
    writeFileSync(`${state}.lock`, `${new Date(now.getTime() - 7 * 3_600_000).toISOString()}\n`);
    const release = acquireStateLock(state, now, { fresh: true });
    expect(readFileSync(`${state}.lock`, "utf8").trim()).toBe(now.toISOString());
    expect(readdirSync(dir).filter((name) => name.includes(".stale-"))).toEqual([]);
    release();
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a lock with unreadable content is never taken over", () => {
    const state = join(dir, "odd.jsonl");
    writeFileSync(`${state}.lock`, "garbage\n");
    expect(() => acquireStateLock(state, now, { fresh: true })).toThrow(`${state}.lock`);
  });

  test("a lock younger than 6 h is never taken over", () => {
    const state = join(dir, "young.jsonl");
    writeFileSync(`${state}.lock`, `${new Date(now.getTime() - 3_600_000).toISOString()}\n`);
    expect(() => acquireStateLock(state, now, { fresh: true })).toThrow(`${state}.lock`);
  });
});

describe("appendLedgerLine", () => {
  test("a file without a final newline gets one first; a new file and a clean file get none extra", () => {
    const path = join(dir, "deep", "spend.jsonl");
    const first = ledgerLine({ runId: "a", at: new Date("2026-11-03T10:00:00Z"), usd: 0.1, label: "l" });
    appendLedgerLine(path, first);
    expect(readFileSync(path, "utf8")).toBe(first);
    const second = ledgerLine({ runId: "b", at: new Date("2026-11-03T11:00:00Z"), usd: 0.2, label: "l" });
    appendLedgerLine(path, second);
    expect(readFileSync(path, "utf8")).toBe(`${first}${second}`);

    const cut = join(dir, "cut.jsonl");
    writeFileSync(cut, first.trimEnd());
    appendLedgerLine(cut, second);
    expect(readFileSync(cut, "utf8")).toBe(`${first}${second}`);
    expect(monthSpend(readFileSync(cut, "utf8"), "2026-11")).toBeCloseTo(0.3, 12);
  });
});

describe("defaultLedgerPath", () => {
  test("an empty XDG_STATE_HOME or HOME counts as unset", () => {
    expect(defaultLedgerPath({ XDG_STATE_HOME: "", HOME: "/home/x" })).toBe(
      "/home/x/.local/state/email-assistant/eval-spend.jsonl"
    );
    expect(defaultLedgerPath({ XDG_STATE_HOME: "  ", HOME: "/home/x" })).toBe(
      "/home/x/.local/state/email-assistant/eval-spend.jsonl"
    );
  });

  test("no usable HOME and no XDG_STATE_HOME refuses: never a relative path or /.local", () => {
    for (const env of [{}, { HOME: "" }, { XDG_STATE_HOME: "", HOME: "" }, { HOME: "relative/home" }]) {
      expect(() => defaultLedgerPath(env)).toThrow("no place for the spend ledger");
    }
  });

  test("HOME gives the .local/state path; XDG_STATE_HOME wins", () => {
    expect(defaultLedgerPath({ HOME: "/home/x" })).toBe("/home/x/.local/state/email-assistant/eval-spend.jsonl");
    expect(defaultLedgerPath({ HOME: "/home/x", XDG_STATE_HOME: "/s" })).toBe("/s/email-assistant/eval-spend.jsonl");
  });
});
