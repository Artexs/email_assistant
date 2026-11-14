import { describe, expect, test } from "bun:test";

import type { Batch } from "./batch";
import { KEY_REUSE_MS, planSends } from "./plan";
import type { CaseState } from "./send-log";

const now = new Date("2026-11-08T12:00:00Z");
const batchId = "2026-11-08-a";
const mk = (id: string, replyTo?: string) => ({
  id,
  persona: "boss",
  lang: "pl" as const,
  subject: "S",
  body: "B",
  expected: { category: "info" as const },
  ...(replyTo === undefined ? {} : { replyTo }),
});
const batch: Batch = { batch: batchId, writer: "w", delegatesActive: false, cases: [mk("a"), mk("b", "a"), mk("c")] };
const due: CaseState = { kind: "due" };
const sent: CaseState = { kind: "sent", attempt: 1, messageId: "<m@x>", threadId: "t", inbox: "i", at: now };
const open = (at: string, hash = "h1"): CaseState => ({
  kind: "open",
  attempt: 1,
  key: `ea-${batchId}-a-a1`,
  hash,
  at: new Date(at),
});

function run(
  states: Record<string, CaseState>,
  extra: { hashes?: Record<string, string>; sentInLast24h?: number; dailyCap?: number; limit?: number | null } = {},
  b: Batch = batch
) {
  const plan = planSends({
    batch: b,
    states: new Map(b.cases.map((c) => [c.id, states[c.id] ?? due])),
    hashes: new Map(Object.entries(extra.hashes ?? {})),
    now,
    sentInLast24h: extra.sentInLast24h ?? 0,
    dailyCap: extra.dailyCap ?? 50,
    limit: extra.limit === undefined ? null : extra.limit,
  });
  const ids = [...plan.actions.map((x) => x.caseId), ...plan.skipped.map((x) => x.caseId)];
  expect([...ids].sort()).toEqual(b.cases.map((c) => c.id).sort());
  return plan;
}

describe("planSends", () => {
  test("all due: parent first, child waits", () => {
    const plan = run({});
    expect(plan.actions).toEqual([
      { kind: "send", caseId: "a", attempt: 1, key: `ea-${batchId}-a-a1`, reuse: false },
      { kind: "send", caseId: "c", attempt: 1, key: `ea-${batchId}-c-a1`, reuse: false },
    ]);
    expect(plan.skipped).toEqual([{ caseId: "b", reason: "waiting_parent" }]);
  });

  test("sent parent frees the child", () => {
    const plan = run({ a: sent });
    expect(plan.actions.map((x) => x.caseId)).toEqual(["b", "c"]);
    expect(plan.skipped).toEqual([{ caseId: "a", reason: "sent" }]);
  });

  test("failed parent blocks the child", () => {
    const plan = run({ a: { kind: "failed", attempt: 1, code: "x" } });
    expect(plan.actions.map((x) => x.caseId)).toEqual(["c"]);
    expect(plan.skipped).toEqual([
      { caseId: "a", reason: "failed" },
      { caseId: "b", reason: "blocked" },
    ]);
  });

  test("open intent younger than 12 h reuses the key", () => {
    const plan = run({ a: open("2026-11-08T11:00:00Z") }, { hashes: { a: "h1" } });
    expect(plan.actions[0]).toEqual({ kind: "send", caseId: "a", attempt: 1, key: `ea-${batchId}-a-a1`, reuse: true });
  });

  test("open intent of exactly 12 h recovers; one second younger reuses", () => {
    const edge = new Date(now.getTime() - KEY_REUSE_MS).toISOString();
    expect(edge).toBe("2026-11-08T00:00:00.000Z");
    const old = run({ a: open("2026-11-08T00:00:00Z") }, { hashes: { a: "h1" } });
    expect(old.actions[0]).toEqual({ kind: "recover", caseId: "a", attempt: 1, key: `ea-${batchId}-a-a1` });
    const fresh = run({ a: open("2026-11-08T00:00:01Z") }, { hashes: { a: "h1" } });
    expect(fresh.actions[0]).toMatchObject({ kind: "send", caseId: "a", reuse: true });
  });

  test("changed hash skips the case and blocks the child", () => {
    const plan = run({ a: open("2026-11-08T11:00:00Z") }, { hashes: { a: "h2" } });
    expect(plan.skipped).toEqual([
      { caseId: "a", reason: "changed" },
      { caseId: "b", reason: "blocked" },
    ]);
    expect(plan.actions.map((x) => x.caseId)).toEqual(["c"]);
  });

  test("daily cap skips the next action", () => {
    const plan = run({}, { sentInLast24h: 49 });
    expect(plan.actions.map((x) => x.caseId)).toEqual(["a"]);
    expect(plan.skipped).toEqual([
      { caseId: "b", reason: "waiting_parent" },
      { caseId: "c", reason: "cap" },
    ]);
  });

  test("limit skips the next action", () => {
    const one = run({}, { limit: 1 });
    expect(one.actions.map((x) => x.caseId)).toEqual(["a"]);
    expect(one.skipped).toContainEqual({ caseId: "b", reason: "waiting_parent" });
    expect(one.skipped).toContainEqual({ caseId: "c", reason: "limit" });
    const zero = run({}, { limit: 0 });
    expect(zero.actions).toEqual([]);
    expect(zero.skipped).toContainEqual({ caseId: "a", reason: "limit" });
  });

  test("cap is checked before limit", () => {
    const plan = run({}, { sentInLast24h: 50, limit: 0 });
    expect(plan.skipped).toContainEqual({ caseId: "a", reason: "cap" });
  });

  test("failed root blocks a 3-level chain, each case exactly once", () => {
    const chain: Batch = {
      batch: batchId,
      writer: "w",
      delegatesActive: false,
      cases: [mk("a"), mk("b", "a"), mk("d", "b")],
    };
    const plan = run({ a: { kind: "failed", attempt: 1, code: "x" } }, {}, chain);
    expect(plan.actions).toEqual([]);
    expect(plan.skipped).toEqual([
      { caseId: "a", reason: "failed" },
      { caseId: "b", reason: "blocked" },
      { caseId: "d", reason: "blocked" },
    ]);
  });
});
