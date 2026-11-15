import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LiveRunPlan } from "@ea/core";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { ledgerLine } from "../../platform/eval-ledger";

import { createLabState, injectErrorCounts, slotsToInject, type LabRun } from "./state";

const NOW = new Date("2026-11-23T08:00:00.000Z");

function planOf(runId: string): LiveRunPlan {
  return {
    runId,
    mode: "day",
    startDate: "2026-11-23",
    offsetDays: 0,
    scenarioDays: [1],
    items: [],
    endsAt: "2026-11-24T00:00:00.000Z",
    tailEndsAt: "2026-11-25T00:00:00.000Z",
    deadlines: [],
  };
}

const runOf = (runId: string, org: "lab" | "demo" = "lab", capUsd = 1): LabRun => ({
  plan: planOf(runId),
  org,
  capUsd,
});

describe("lab state", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "f113-s04-state-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const open = () => createLabState(dir, () => NOW);

  test("1: events come back in order; a cut last line is skipped and counted", () => {
    const state = open();
    expect(state.startRun(runOf("day-20261123-0001"))).toBe("ok");
    const id = "day-20261123-0001";
    state.append(id, { t: "inject_intent", slotId: "w-1-001", messageId: "<a>" });
    state.append(id, { t: "inject_done", slotId: "w-1-001", messageId: "<a>" });
    state.append(id, {
      t: "bot_planned",
      key: "k",
      at: "2026-11-23T09:00:00.000Z",
      reply: { kind: "done", from: "self", at: "2026-11-23T09:00:00.000Z" },
      delegate: "dorota",
      uid: 1,
    });
    expect(state.events(id).map((event) => event.t)).toEqual(["inject_intent", "inject_done", "bot_planned"]);
    expect(state.events(id)[2]).toMatchObject({ at: "2026-11-23T09:00:00.000Z" });
    expect(state.events(id)[0]?.loggedAt).toBe(NOW.toISOString());
    expect(state.brokenLines(id)).toBe(0);
    appendFileSync(join(dir, "runs", id, "events.jsonl"), '{"t":"inject_do');
    expect(state.events(id)).toHaveLength(3);
    expect(state.brokenLines(id)).toBe(1);
  });

  test("2: a second start for the same org is refused and leaves no second run (review B4)", () => {
    const state = open();
    expect(state.startRun(runOf("day-20261123-0001"))).toBe("ok");
    expect(state.startRun(runOf("day-20261123-0002"))).toBe("run_active");
    expect(readdirSync(join(dir, "runs"))).toEqual(["day-20261123-0001"]);
    expect(state.activeRuns()).toEqual(["day-20261123-0001"]);
    expect(state.listRuns()).toEqual(["day-20261123-0001"]);
  });

  test("2b: two start calls on two handles give one active run", () => {
    const a = open();
    const b = open();
    const results = [a.startRun(runOf("day-20261123-000a")), b.startRun(runOf("day-20261123-000b"))];
    expect(results.sort()).toEqual(["ok", "run_active"]);
    expect(open().activeRuns()).toHaveLength(1);
  });

  test("2c: the lock is taken before the run folder is written", () => {
    const state = open();
    // A lock that names a run with no folder and is fresh holds the org: the second start must not write a folder.
    expect(state.startRun(runOf("day-20261123-0001"))).toBe("ok");
    rmSync(join(dir, "runs", "day-20261123-0001"), { recursive: true });
    expect(state.startRun(runOf("day-20261123-0002"))).toBe("run_active");
    expect(existsSync(join(dir, "runs", "day-20261123-0002"))).toBe(false);
  });

  test("3: after stopRun the org starts again", () => {
    const state = open();
    state.startRun(runOf("day-20261123-0001"));
    state.stopRun("day-20261123-0001", "done");
    expect(state.activeRuns()).toEqual([]);
    expect(state.startRun(runOf("day-20261123-0002"))).toBe("ok");
    expect(state.activeRuns()).toEqual(["day-20261123-0002"]);
  });

  test("3b: a lock of a stopped run is replaced after a crash between the stop and the unlock", () => {
    const state = open();
    state.startRun(runOf("day-20261123-0001"));
    appendFileSync(
      join(dir, "runs", "day-20261123-0001", "events.jsonl"),
      `${JSON.stringify({ t: "stopped", reason: "done" })}\n`
    );
    expect(existsSync(join(dir, "locks", "lab.lock"))).toBe(true);
    expect(state.activeRuns()).toEqual([]);
    expect(state.startRun(runOf("day-20261123-0002"))).toBe("ok");
    expect(readFileSync(join(dir, "locks", "lab.lock"), "utf8").trim()).toBe("day-20261123-0002");
  });

  test("4: stopRun twice writes one stopped event", () => {
    const state = open();
    state.startRun(runOf("day-20261123-0001"));
    state.stopRun("day-20261123-0001", "budget");
    state.stopRun("day-20261123-0001", "operator");
    const stopped = state.events("day-20261123-0001").filter((event) => event.t === "stopped");
    expect(stopped).toHaveLength(1);
    expect(stopped[0]).toMatchObject({ reason: "budget" });
  });

  test("5: two orgs run at once", () => {
    const state = open();
    expect(state.startRun(runOf("day-20261123-0001", "lab"))).toBe("ok");
    expect(state.startRun(runOf("week-20261123-0002", "demo"))).toBe("ok");
    expect(state.activeRuns()).toEqual(["day-20261123-0001", "week-20261123-0002"]);
  });

  test("orgs and runs survive a new handle", () => {
    const state = open();
    expect(state.readOrgs()).toEqual({});
    const org = { orgId: "o", mailboxId: "m", address: "a@kordelan.test", chatId: 7 };
    state.writeOrgs({ lab: org });
    state.startRun({ ...runOf("day-20261123-0001"), modePlan: { assistFromDay: 4 } });
    const again = open();
    expect(again.readOrgs()).toEqual({ lab: org });
    expect(again.readRun("day-20261123-0001")).toMatchObject({ org: "lab", capUsd: 1, modePlan: { assistFromDay: 4 } });
    expect(again.readRun("day-20261123-0001").plan.runId).toBe("day-20261123-0001");
  });

  test("a bad run id never reaches the file system", () => {
    expect(() => open().startRun(runOf("../evil"))).toThrow();
  });

  test("ledgerPath is in the state directory", () => {
    expect(open().ledgerPath()).toBe(join(dir, "eval-spend.jsonl"));
  });

  test("B5: the cap is min(request, 20 - month spend - caps of active runs)", () => {
    const state = open();
    expect(state.capFor(5)).toBe(5);
    writeFileSync(
      state.ledgerPath(),
      `${ledgerLine({ runId: "old", at: NOW, usd: 12, label: "x" })}${ledgerLine({ runId: "last-month", at: new Date("2026-10-30T00:00:00Z"), usd: 50, label: "x" })}`
    );
    expect(state.capFor(5)).toBe(5);
    state.startRun(runOf("week-20261123-0001", "lab", 5));
    expect(state.capFor(5)).toBe(3);
    state.startRun(runOf("week-20261123-0002", "demo", 3));
    expect(state.capFor(5)).toBe(0);
    state.stopRun("week-20261123-0001", "done");
    expect(state.capFor(5)).toBe(5);
  });

  test("T7: errors and skips survive a restart; a skipped slot is not selected again", () => {
    const state = open();
    state.startRun(runOf("day-20261123-0001"));
    const id = "day-20261123-0001";
    state.append(id, { t: "inject_error", slotId: "s2", code: "smtp" });
    state.append(id, { t: "inject_error", slotId: "s2", code: "smtp" });
    state.append(id, { t: "inject_done", slotId: "s1", messageId: "<a>" });
    state.append(id, { t: "skip", code: "inject_failed", ref: "s3" });
    const events = open().events(id);
    expect(injectErrorCounts(events).get("s2")).toBe(2);
    expect(slotsToInject(["s1", "s2", "s3", "s4"], events)).toEqual(["s2", "s4"]);
  });
});
