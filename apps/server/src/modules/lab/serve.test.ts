import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatWithOptions } from "node:util";

import type { LiveRunPlan } from "@ea/core";
import { MINUTE_MS } from "@ea/core";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { LabMailError } from "./mail-client";
import {
  finishRun,
  runModeStep,
  runServe,
  serveTick,
  type ServeDeps,
  type ServeParts,
  type ServeRunDeps,
} from "./serve";
import type { ServeStatus } from "./serve-files";
import { writeRunLedgerLine } from "./start";
import { createLabState, type LabRun, type LabState } from "./state";

// Unit tests of the serve loop with fake parts and a fake clock: no DB, no mail, no Telegram.
const START = "2026-11-23"; // a Monday
let dir = "";
let now = new Date("2026-11-23T09:00:00.000Z");
let calls: string[] = [];
let said: string[] = [];
let spend: number | "unpriced" = 0;
let throwIn: Record<string, number> = {};
let injectorResult: { stopped?: "budget" } = {};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "f113-s11-serve-"));
  now = new Date("2026-11-23T09:00:00.000Z");
  calls = [];
  said = [];
  spend = 0;
  throwIn = {};
  injectorResult = {};
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const plan = (runId: string, tailEndsAt = "2026-11-28T23:00:00.000Z"): LiveRunPlan => ({
  runId,
  mode: "week",
  startDate: START,
  offsetDays: 0,
  scenarioDays: [1],
  items: [],
  endsAt: "2026-11-24T23:00:00.000Z",
  tailEndsAt,
  deadlines: [],
});

const state = (): LabState => createLabState(dir, () => now);

function start(runId: string, over: Partial<LabRun> = {}, tailEndsAt?: string): LabState {
  const labState = state();
  const org = over.org ?? "lab";
  labState.writeOrgs({
    ...labState.readOrgs(),
    [org]: { orgId: `o-${org}`, mailboxId: `m-${org}`, address: `${org}@x.test`, chatId: 1 },
  });
  expect(labState.startRun({ plan: plan(runId, tailEndsAt), org: "lab", capUsd: 5, ...over })).toBe("ok");
  return labState;
}

// Fake parts: each part writes its name into `calls`; `throwIn` makes a part throw that many more times.
function parts(labState: LabState): ServeParts {
  const part =
    <T>(name: string, value: () => T) =>
    async (runId: string): Promise<T> => {
      calls.push(`${name}:${runId}`);
      if ((throwIn[name] ?? 0) > 0) {
        throwIn[name] = (throwIn[name] ?? 0) - 1;
        throw Object.assign(new Error("secret mail text"), { code: "ECONNREFUSED" });
      }
      return value();
    };
  return {
    mode: part("mode", () => undefined),
    injector: part("injector", () => injectorResult),
    // The first call of the bots and of the executive writes the baseline `seen` event, as the real ticks do.
    bots: async (runId) => {
      calls.push(`bots:${runId}`);
      if ((throwIn.bots ?? 0) > 0) {
        throwIn.bots = (throwIn.bots ?? 0) - 1;
        throw new Error("x");
      }
      return { failed: 0 };
    },
    executive: async (runId) => {
      calls.push(`executive:${runId}`);
      if ((throwIn.executive ?? 0) > 0) {
        throwIn.executive = (throwIn.executive ?? 0) - 1;
        throw new Error("x");
      }
      if (!labState.events(runId).some((event) => event.t === "seen" && event.part === "tg")) {
        labState.append(runId, { t: "seen", part: "tg", ref: "0" });
      }
    },
    finish: async (runId, reason) => {
      calls.push(`finish:${runId}:${reason}`);
      finishRun(labState, runId, reason, typeof spend === "number" ? spend : 0, now);
    },
  };
}

function deps(labState: LabState, over: Partial<ServeDeps> = {}): ServeDeps {
  return {
    state: labState,
    parts: parts(labState),
    now: () => now,
    spendUsd: async (runId) => {
      calls.push(`spend:${runId}`);
      return spend;
    },
    say: (line) => said.push(line),
    ...over,
  };
}

const ledger = (labState: LabState): string[] =>
  readFileSync(labState.ledgerPath(), "utf8")
    .split("\n")
    .filter((line) => line !== "");
const stoppedEvents = (labState: LabState, runId: string) => labState.events(runId).filter((e) => e.t === "stopped");

describe("serveTick (spec tests 1 to 5)", () => {
  test("1: one active run: spend, mode, then the parts; the first tick reads the executive chat before the injector", async () => {
    const labState = start("week-20261123-aaaa");
    const errors = new Map<string, number>();
    await serveTick(deps(labState), errors);
    expect(calls).toEqual([
      "spend:week-20261123-aaaa",
      "mode:week-20261123-aaaa",
      "executive:week-20261123-aaaa",
      "bots:week-20261123-aaaa",
      "injector:week-20261123-aaaa",
    ]);
    calls = [];
    await serveTick(deps(labState), errors);
    expect(calls).toEqual([
      "spend:week-20261123-aaaa",
      "mode:week-20261123-aaaa",
      "injector:week-20261123-aaaa",
      "bots:week-20261123-aaaa",
      "executive:week-20261123-aaaa",
    ]);
  });

  test("1b: when the first executive tick fails, the injector sends nothing in that tick", async () => {
    const labState = start("week-20261123-aaaa");
    throwIn.executive = 1;
    await serveTick(deps(labState), new Map());
    expect(calls).not.toContain("injector:week-20261123-aaaa");
    expect(calls).not.toContain("bots:week-20261123-aaaa");
    await serveTick(deps(labState), new Map());
    expect(calls).toContain("injector:week-20261123-aaaa");
  });

  test("2: a run with a stopped event is skipped", async () => {
    const labState = start("week-20261123-aaaa");
    labState.stopRun("week-20261123-aaaa", "operator");
    await serveTick(deps(labState), new Map());
    expect(calls).toEqual([]);
  });

  test("2b: an active run that already has its ledger line ends at once, with no part and no second line", async () => {
    // A crash came between the ledger line and `stopRun`: spend after that line would never reach the month ledger.
    const labState = start("week-20261123-aaaa");
    writeRunLedgerLine(labState, "week-20261123-aaaa", 0.5, now, "lab-01-live-error");
    expect(labState.activeRuns()).toEqual(["week-20261123-aaaa"]);
    await serveTick(deps(labState), new Map());
    expect(calls).toEqual(["finish:week-20261123-aaaa:error:ledger_line"]);
    expect(stoppedEvents(labState, "week-20261123-aaaa")).toMatchObject([{ reason: "error:ledger_line" }]);
    expect(ledger(labState)).toHaveLength(1);
    expect(labState.activeRuns()).toEqual([]);
  });

  test("3: spend at the cap finishes with budget, no part runs, one stopped event and one ledger line", async () => {
    const labState = start("week-20261123-aaaa", { capUsd: 5 });
    spend = 5;
    await serveTick(deps(labState), new Map());
    expect(calls).toEqual(["spend:week-20261123-aaaa", "finish:week-20261123-aaaa:budget"]);
    expect(stoppedEvents(labState, "week-20261123-aaaa")).toHaveLength(1);
    expect(ledger(labState)).toHaveLength(1);
    expect(ledger(labState)[0]).toContain("lab-01-live-budget");
    calls = [];
    await serveTick(deps(labState), new Map());
    expect(calls).toEqual([]);
  });

  test("3: unpriced spend finishes with error:unpriced", async () => {
    const labState = start("week-20261123-aaaa");
    spend = "unpriced";
    await serveTick(deps(labState), new Map());
    expect(calls).toEqual(["spend:week-20261123-aaaa", "finish:week-20261123-aaaa:error:unpriced"]);
    expect(stoppedEvents(labState, "week-20261123-aaaa")).toMatchObject([{ reason: "error:unpriced" }]);
    expect(ledger(labState)).toHaveLength(1);
  });

  test("3b: the injector returns stopped budget: finish budget in the same tick, no bots, no executive", async () => {
    const labState = start("week-20261123-aaaa");
    await serveTick(deps(labState), new Map());
    calls = [];
    injectorResult = { stopped: "budget" };
    await serveTick(deps(labState), new Map());
    expect(calls).toEqual([
      "spend:week-20261123-aaaa",
      "mode:week-20261123-aaaa",
      "injector:week-20261123-aaaa",
      "finish:week-20261123-aaaa:budget",
    ]);
    expect(stoppedEvents(labState, "week-20261123-aaaa")).toHaveLength(1);
  });

  test("4: now at tailEndsAt finishes with done once; the next tick does nothing for it", async () => {
    const labState = start("week-20261123-aaaa", {}, "2026-11-28T23:00:00.000Z");
    await serveTick(deps(labState), new Map());
    expect(calls.some((call) => call.startsWith("finish"))).toBe(false);
    now = new Date("2026-11-28T23:00:00.000Z");
    calls = [];
    await serveTick(deps(labState), new Map());
    expect(calls.filter((call) => call.startsWith("finish"))).toEqual(["finish:week-20261123-aaaa:done"]);
    expect(ledger(labState)).toHaveLength(1);
    calls = [];
    await serveTick(deps(labState), new Map());
    expect(calls).toEqual([]);
    expect(stoppedEvents(labState, "week-20261123-aaaa")).toHaveLength(1);
  });

  test("5: the injector throws 9 times: still active; the 10th finishes with error:injector; a good tick resets the count", async () => {
    const labState = start("week-20261123-aaaa");
    const errors = new Map<string, number>();
    await serveTick(deps(labState), errors); // the baseline tick
    throwIn.injector = 9;
    for (let i = 0; i < 9; i += 1) await serveTick(deps(labState), errors);
    expect(stoppedEvents(labState, "week-20261123-aaaa")).toHaveLength(0);
    expect(errors.get("week-20261123-aaaa:injector")).toBe(9);
    // The other parts kept running while the injector failed.
    expect(calls.filter((call) => call.startsWith("bots:")).length).toBeGreaterThan(9);
    // One good tick resets the count: 9 more failures do not stop the run.
    await serveTick(deps(labState), errors);
    expect(errors.has("week-20261123-aaaa:injector")).toBe(false);
    throwIn.injector = 9;
    for (let i = 0; i < 9; i += 1) await serveTick(deps(labState), errors);
    expect(stoppedEvents(labState, "week-20261123-aaaa")).toHaveLength(0);
    throwIn.injector = 1;
    await serveTick(deps(labState), errors);
    expect(stoppedEvents(labState, "week-20261123-aaaa")).toMatchObject([{ reason: "error:injector" }]);
    expect(ledger(labState)).toHaveLength(1);
  });

  test("5b: an error line holds the part, the run and a code, never the error text", async () => {
    const labState = start("week-20261123-aaaa");
    await serveTick(deps(labState), new Map());
    throwIn.injector = 1;
    await serveTick(deps(labState), new Map());
    expect(said).toContain("error week-20261123-aaaa injector ECONNREFUSED 1");
    expect(said.join("\n")).not.toContain("secret");
  });

  test("5d: canary: an error that carries mail text in its message or its code never reaches an operator line or the heartbeat", async () => {
    const labState = start("week-20261123-aaaa");
    const canary = "CANARY-Subject-Re-your-offer";
    const beats: ServeStatus[] = [];
    const base = parts(labState);
    const failing: ServeParts = {
      ...base,
      executive: async () => {
        throw Object.assign(new Error(canary), { code: canary, subject: canary });
      },
      injector: async () => {
        throw new LabMailError("smtp_failed", { code: "ECONNREFUSED", message: canary });
      },
    };
    for (let tick = 0; tick < 3; tick += 1) {
      await serveTick(deps(labState, { parts: failing, heartbeat: (status) => beats.push(status) }), new Map());
    }
    expect(said.length).toBeGreaterThan(0);
    expect(formatWithOptions({}, "%s %o", said.join("\n"), said)).not.toContain(canary);
    expect(JSON.stringify(beats)).not.toContain(canary);
    expect(said).toContain("error week-20261123-aaaa executive unknown 1");
  });

  test("5c: a stop by the operator between two parts ends the tick before the next part", async () => {
    const labState = start("week-20261123-aaaa");
    await serveTick(deps(labState), new Map());
    calls = [];
    const base = parts(labState);
    await serveTick(
      deps(labState, {
        parts: {
          ...base,
          injector: async (runId) => {
            const result = await base.injector(runId);
            labState.stopRun(runId, "operator");
            return result;
          },
        },
      }),
      new Map()
    );
    expect(calls).toEqual(["spend:week-20261123-aaaa", "mode:week-20261123-aaaa", "injector:week-20261123-aaaa"]);
  });

  test("9: two runs are handled one after the other; a failing run does not stop the other", async () => {
    const labState = start("week-20261123-aaaa");
    start("day-20261124-bbbb", { org: "demo" });
    throwIn.executive = 1;
    await serveTick(deps(labState), new Map());
    expect(calls.filter((call) => call.startsWith("spend"))).toEqual([
      "spend:day-20261124-bbbb",
      "spend:week-20261123-aaaa",
    ]);
    // The first run (day) fails its first executive tick: it sends nothing; the other run goes on.
    expect(calls).not.toContain("injector:day-20261124-bbbb");
    expect(calls).toContain("injector:week-20261123-aaaa");
  });

  test("the heartbeat holds the tick time, the failed parts in a row and the failed bot items", async () => {
    const labState = start("week-20261123-aaaa");
    const beats: ServeStatus[] = [];
    await serveTick(deps(labState, { heartbeat: (status) => beats.push(status) }), new Map());
    throwIn.injector = 1;
    const errors = new Map<string, number>();
    await serveTick(
      deps(labState, {
        heartbeat: (status) => beats.push(status),
        parts: { ...parts(labState), bots: async () => ({ failed: 2 }) },
      }),
      errors
    );
    expect(beats[0]).toEqual({ tickAt: now.toISOString(), runs: { "week-20261123-aaaa": {} } });
    expect(beats[1]?.runs["week-20261123-aaaa"]).toEqual({ injector: 1, bots_failed: 2 });
  });
});

describe("the mode switch (spec test 6)", () => {
  const modeRun = (labState: LabState, runId: string) => labState.readRun(runId);
  test("6: assistFromDay 4 from Monday 2026-11-23: set once from Thursday 00:00 Warsaw", async () => {
    const labState = start("week-20261123-aaaa", { modePlan: { assistFromDay: 4 }, org: "demo" });
    let sets = 0;
    const modeDeps = {
      state: labState,
      now: () => now,
      setAssist: async () => {
        sets += 1;
      },
    };
    expect(modeRun(labState, "week-20261123-aaaa").modePlan).toEqual({ assistFromDay: 4 });
    // Wed 23:59 Warsaw = 22:59Z: not yet.
    now = new Date("2026-11-25T22:59:00.000Z");
    await runModeStep(modeDeps, "week-20261123-aaaa");
    expect(sets).toBe(0);
    // Thu 00:30 Warsaw = Wed 23:30Z.
    now = new Date("2026-11-25T23:30:00.000Z");
    await runModeStep(modeDeps, "week-20261123-aaaa");
    await runModeStep(modeDeps, "week-20261123-aaaa");
    expect(sets).toBe(1);
    expect(labState.events("week-20261123-aaaa").filter((event) => event.t === "mode")).toMatchObject([
      { mode: "assist" },
    ]);
  });

  test("6b: a run without modePlan skips the step; a failed switch writes no mode event", async () => {
    const plain = start("week-20261123-aaaa");
    let sets = 0;
    now = new Date("2026-11-30T00:00:00.000Z");
    await runModeStep(
      {
        state: plain,
        now: () => now,
        setAssist: async () => {
          sets += 1;
        },
      },
      "week-20261123-aaaa"
    );
    expect(sets).toBe(0);
    plain.stopRun("week-20261123-aaaa", "operator");
    const demo = start("week-20261130-cccc", { modePlan: { assistFromDay: 1 }, org: "demo" });
    now = new Date("2026-11-30T09:00:00.000Z");
    await expect(
      runModeStep(
        {
          state: demo,
          now: () => now,
          setAssist: async () => {
            throw new Error("db down");
          },
        },
        "week-20261130-cccc"
      )
    ).rejects.toThrow();
    expect(demo.events("week-20261130-cccc").filter((event) => event.t === "mode")).toEqual([]);
  });
});

describe("finishRun", () => {
  test("a ledger line comes with the stop, and a second finish adds neither", () => {
    const labState = start("week-20261123-aaaa");
    finishRun(labState, "week-20261123-aaaa", "done", 1.25, now);
    finishRun(labState, "week-20261123-aaaa", "done", 1.5, now);
    expect(ledger(labState)).toHaveLength(1);
    expect(ledger(labState)[0]).toContain('"usd":1.25');
    expect(stoppedEvents(labState, "week-20261123-aaaa")).toHaveLength(1);
    expect(labState.activeRuns()).toEqual([]);
  });

  test("TG1: a stopRun that throws leaves the ledger line; a repeat adds no second line and stops the run", () => {
    const labState = start("week-20261123-aaaa");
    const failing = {
      ...labState,
      stopRun: () => {
        throw new Error("disk");
      },
    } as LabState;
    expect(() => finishRun(failing, "week-20261123-aaaa", "done", 1.25, now)).toThrow();
    expect(ledger(labState)).toHaveLength(1);
    expect(stoppedEvents(labState, "week-20261123-aaaa")).toHaveLength(0);
    finishRun(labState, "week-20261123-aaaa", "done", 9, now);
    expect(ledger(labState)).toHaveLength(1);
    expect(ledger(labState)[0]).toContain('"usd":1.25');
    expect(stoppedEvents(labState, "week-20261123-aaaa")).toHaveLength(1);
  });

  test("TG1: a ledger write that fails throws and does not stop the run", () => {
    const labState = start("week-20261123-aaaa");
    // A file where the ledger folder should be: the append fails.
    writeFileSync(join(dir, "blocker"), "x");
    const failing = { ...labState, ledgerPath: () => join(dir, "blocker", "eval-spend.jsonl") } as LabState;
    expect(() => finishRun(failing, "week-20261123-aaaa", "done", 1, now)).toThrow();
    expect(stoppedEvents(labState, "week-20261123-aaaa")).toHaveLength(0);
    expect(labState.activeRuns()).toEqual(["week-20261123-aaaa"]);
  });
});

describe("runServe (spec tests 7 and 8)", () => {
  const runDeps = (labState: LabState, over: Partial<ServeRunDeps> = {}): ServeRunDeps => ({
    ...deps(labState),
    envIssues: () => [],
    takeLock: () => ({ touch: () => true, release: () => calls.push("release") }),
    sleep: async () => undefined,
    heartbeatEveryMs: MINUTE_MS,
    ...over,
  });

  test("7: an abort during a part ends the loop after that part; the lock is released", async () => {
    const labState = start("week-20261123-aaaa");
    const abort = new AbortController();
    const base = parts(labState);
    const code = await runServe(
      runDeps(labState, {
        parts: {
          ...base,
          executive: async (runId) => {
            await base.executive(runId);
            abort.abort();
          },
        },
      }),
      { everyMs: 1, signal: abort.signal }
    );
    expect(code).toBe(0);
    // The first tick order is executive, bots, injector: the abort came in the executive, so nothing ran after it.
    expect(calls).toEqual([
      "spend:week-20261123-aaaa",
      "mode:week-20261123-aaaa",
      "executive:week-20261123-aaaa",
      "release",
    ]);
  });

  test("a lost lock (a foreign token in the file) ends the loop with exit 1 before the next tick; the lock is released", async () => {
    const labState = start("week-20261123-aaaa");
    let touches = 0;
    let sleeps = 0;
    const code = await runServe(
      runDeps(labState, {
        // A loop that does not stop fails the test fast instead of hanging it.
        sleep: async () => {
          sleeps += 1;
          if (sleeps > 3) throw new Error("the loop did not stop");
        },
        takeLock: () => ({
          // The first touch is ours; the second finds a foreign token.
          touch: () => {
            touches += 1;
            return touches < 2;
          },
          release: () => calls.push("release"),
        }),
      }),
      { everyMs: 1, signal: new AbortController().signal }
    );
    expect(code).toBe(1);
    expect(said).toContain("error serve lock_lost");
    // One tick ran (executive, bots, injector); the loop never started a second one.
    expect(calls.filter((call) => call.startsWith("spend:"))).toHaveLength(1);
    expect(calls.at(-1)).toBe("release");
  });

  test("8: a bad env exits 1 before any tick and before the lock", async () => {
    const labState = start("week-20261123-aaaa");
    let locked = false;
    const code = await runServe(
      runDeps(labState, {
        envIssues: () => ["telegram_token_real"],
        takeLock: () => {
          locked = true;
          return undefined;
        },
      }),
      { everyMs: 1, signal: new AbortController().signal }
    );
    expect(code).toBe(1);
    expect(locked).toBe(false);
    expect(calls).toEqual([]);
    expect(said.join("\n")).toContain("telegram_token_real");
  });

  test("a second serve process (no lock) exits 1 and writes no event", async () => {
    const labState = start("week-20261123-aaaa");
    const before = labState.events("week-20261123-aaaa").length;
    const code = await runServe(runDeps(labState, { takeLock: () => undefined }), {
      everyMs: 1,
      signal: new AbortController().signal,
    });
    expect(code).toBe(1);
    expect(said).toContain("refused: serve_running");
    expect(calls).toEqual([]);
    expect(labState.events("week-20261123-aaaa")).toHaveLength(before);
  });
});

describe("only the stop function writes stopped", () => {
  test("no source file of the lab module other than state.ts holds a stopped event literal", () => {
    const names = new Bun.Glob("*.ts").scanSync({ cwd: import.meta.dir });
    const writers = [...names]
      .filter((name) => !name.endsWith(".test.ts"))
      .filter((name) => /t:\s*"stopped"/.test(readFileSync(join(import.meta.dir, name), "utf8")))
      .sort();
    expect(writers).toEqual(["state.ts"]);
  });
});
