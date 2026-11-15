import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { LAB_FAKE_TELEGRAM_TOKEN } from "@ea/core";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import {
  createLabState,
  labAddresses,
  LAB_MAILBOXES,
  loadLabCorpus,
  LabScoreError,
  LabSeedError,
  type LabCorpus,
  type LabModel,
  type LabOrg,
  type RunSpend,
  type ServeStatus,
  type SeedResult,
  type SeedTarget,
} from "../modules/lab";
import type { CliOutput } from "../platform/cli";
import { ledgerLine } from "../platform/eval-ledger";

import type { LabCommand } from "./lab-args";
import { parseLabArgs } from "./lab-args";
import { type LabDeps, runLabCommand } from "./lab-run";

const ROOT = resolve(import.meta.dir, "../../../../evals/sim");
// A Friday: the next Monday is 2026-11-23.
const NOW = new Date("2026-11-20T08:00:00.000Z");

let corpus: LabCorpus;
beforeAll(async () => {
  corpus = await loadLabCorpus(ROOT, "lab-01");
});

const LUNA: LabModel = { model: "gpt-6-luna", endpoint: "standard" };

const simEnv = (): Record<string, string | undefined> => ({
  LAB_STACK: "ea-sim",
  MAIL_ALLOW_LOCAL_HOSTS: "true",
  TELEGRAM_API_ROOT: "http://127.0.0.1:8090",
  TELEGRAM_BOT_TOKEN: LAB_FAKE_TELEGRAM_TOKEN,
  SEND_SCOPE: "self",
  SEND_TEST_ADDRESSES: LAB_MAILBOXES.lab,
  TRIAGE_LLM_SCOPE: "all",
  ACTIONS_SCOPE: "all",
});

describe("lab command", () => {
  let dir = "";
  let printed: string[] = [];
  let failed: string[] = [];
  let hasMail = false;
  let spend: RunSpend = { kind: "ok", usd: 0, calls: 0, unpricedCalls: 0 };
  let hexes: string[] = [];
  let models: LabModel[] = [LUNA];
  let env = simEnv();
  let seedCalls: SeedTarget[] = [];
  let seedResult: SeedResult | Error;
  let stored: string[] = [];
  let storeError: Error | undefined;
  let serveCalls = 0;
  let serveStatus: ServeStatus | undefined;
  let scoreCalls: [string, string | undefined][] = [];
  let scoreResult: { markdown: string; json: string; partial: boolean } | Error;

  beforeEach(() => {
    seedCalls = [];
    seedResult = {
      org: { orgId: "o-new", mailboxId: "m-new", address: LAB_MAILBOXES.lab, chatId: 5550001 },
      created: true,
      added: { mailbox: 1, delegates: 3, rules: 2, flags: 11, linked: true, relinked: false },
    };
    stored = [];
    storeError = undefined;
    serveCalls = 0;
    serveStatus = undefined;
    scoreCalls = [];
    scoreResult = { markdown: "/out/r.md", json: "/out/r.json", partial: false };
    dir = mkdtempSync(join(tmpdir(), "f113-s05-lab-"));
    printed = [];
    failed = [];
    hasMail = false;
    spend = { kind: "ok", usd: 0, calls: 0, unpricedCalls: 0 };
    hexes = ["aaaa", "bbbb", "cccc", "dddd"];
    models = [LUNA];
    env = simEnv();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const state = () => createLabState(dir, () => NOW);
  const seedOrgs = () =>
    state().writeOrgs({
      lab: { orgId: "o-lab", mailboxId: "m-lab", address: LAB_MAILBOXES.lab, chatId: 1 },
      demo: { orgId: "o-demo", mailboxId: "m-demo", address: LAB_MAILBOXES.demo, chatId: 2 },
    });
  const cli: CliOutput = { print: (text) => printed.push(text), fail: (text) => failed.push(text) };
  const deps = (): LabDeps => ({
    env,
    state: state(),
    corpus,
    models,
    orgHasMail: async () => hasMail,
    seed: async (target) => {
      seedCalls.push(target);
      if (seedResult instanceof Error) throw seedResult;
      return seedResult;
    },
    storeUrgency: async (org: LabOrg, plan) => {
      if (storeError) throw storeError;
      stored.push(`${org.orgId} ${plan.runId} ${plan.deadlines.length}`);
    },
    spendOf: async () => spend,
    score: async (runId, out) => {
      scoreCalls.push([runId, out]);
      if (scoreResult instanceof Error) throw scoreResult;
      return scoreResult;
    },
    serveStatus: () => serveStatus,
    serve: async () => {
      serveCalls += 1;
      return 0;
    },
    now: () => NOW,
    hex4: () => hexes.shift() ?? "ffff",
    cli,
  });
  const run = async (argv: string[]): Promise<number> => {
    const command = parseLabArgs(argv) as LabCommand;
    expect(command).toBeDefined();
    return runLabCommand(command, deps());
  };
  const runFolders = () => (existsSync(join(dir, "runs")) ? readdirSync(join(dir, "runs")) : []);
  const ledgerLines = () =>
    existsSync(state().ledgerPath())
      ? readFileSync(state().ledgerPath(), "utf8")
          .split("\n")
          .filter((line) => line !== "")
      : [];

  test("1: a week run that does not start on a Monday exits 1 with not_monday and writes no run folder", async () => {
    seedOrgs();
    expect(await run(["start", "--mode", "week", "--date", "2026-11-24"])).toBe(1);
    expect(failed.join("\n")).toContain("not_monday");
    expect(runFolders()).toEqual([]);
    expect(state().activeRuns()).toEqual([]);
  });

  test("2: a bad env exits 1 with the issue codes and writes no run folder", async () => {
    seedOrgs();
    env = { ...simEnv(), TELEGRAM_BOT_TOKEN: "123456:real-looking-token-value-0000", SEND_SCOPE: "all" };
    expect(await run(["start", "--mode", "day", "--date", "2026-11-23"])).toBe(1);
    expect(failed.join("\n")).toContain("telegram_token_not_fake");
    expect(failed.join("\n")).toContain("send_scope_not_self");
    expect(runFolders()).toEqual([]);
  });

  test("2b: every command but demo-import checks the env first", async () => {
    env = { LAB_STACK: "ea-prod" };
    for (const argv of [
      ["status"],
      ["serve"],
      ["stop", "--run", "day-20261123-aaaa"],
      ["seed"],
      ["score", "--run", "day-20261123-aaaa"],
    ]) {
      failed = [];
      expect(await run(argv)).toBe(1);
      expect(failed.join("\n")).toContain("not_sim_stack");
    }
    failed = [];
    expect(await run(["demo-import", "--file", "x", "--email", "a@dev.test"])).toBe(1);
    expect(failed.join("\n")).toBe("demo-import: not built");
  });

  test("commands of later stages exit 1 with not built", async () => {
    for (const argv of [
      ["reset", "--org", "lab", "--yes"],
      ["demo-reset", "--yes"],
    ]) {
      failed = [];
      expect(await run(argv)).toBe(1);
      expect(failed.join("\n")).toContain("not built");
    }
  });

  test("score: an unknown run is refused; a known run prints the paths and passes --out on", async () => {
    seedOrgs();
    expect(await run(["score", "--run", "day-20261123-aaaa"])).toBe(1);
    expect(failed).toEqual(["refused: no_such_run"]);
    expect(scoreCalls).toEqual([]);
    expect(await run(["start", "--mode", "day", "--date", "2026-11-23"])).toBe(0);
    printed = [];
    expect(await run(["score", "--run", "day-20261123-aaaa", "--out", "/tmp/x"])).toBe(0);
    expect(scoreCalls).toEqual([["day-20261123-aaaa", "/tmp/x"]]);
    expect(printed).toEqual(["score: day-20261123-aaaa report /out/r.md json /out/r.json"]);
    scoreResult = { markdown: "/out/r.md", json: "/out/r.json", partial: true };
    printed = [];
    expect(await run(["score", "--run", "day-20261123-aaaa"])).toBe(0);
    expect(printed[0]).toContain("day-20261123-aaaa partial report");
  });

  test("score: a LabScoreError exits 1 with its code; another error is not caught", async () => {
    seedOrgs();
    expect(await run(["start", "--mode", "day", "--date", "2026-11-23"])).toBe(0);
    scoreResult = new LabScoreError("org_gone");
    failed = [];
    expect(await run(["score", "--run", "day-20261123-aaaa"])).toBe(1);
    expect(failed).toEqual(["refused: org_gone"]);
    scoreResult = new Error("boom");
    await expect(run(["score", "--run", "day-20261123-aaaa"])).rejects.toThrow("boom");
  });

  test("serve: a bad env exits 1 before the loop starts; a good env hands over to the serve loop", async () => {
    env = { ...simEnv(), SEND_SCOPE: "all" };
    expect(await run(["serve"])).toBe(1);
    expect(failed.join("\n")).toContain("refused: env is not the sim stack");
    expect(serveCalls).toBe(0);
    env = simEnv();
    expect(await run(["serve"])).toBe(0);
    expect(serveCalls).toBe(1);
  });

  test("status shows the serve heartbeat of an active run, not of a stopped one", async () => {
    seedOrgs();
    expect(await run(["start", "--mode", "day", "--date", "2026-11-23"])).toBe(0);
    serveStatus = {
      tickAt: "2026-11-23T09:00:30.000Z",
      runs: { "day-20261123-aaaa": { injector: 2, bots_failed: 1 } },
    };
    printed = [];
    expect(await run(["status"])).toBe(0);
    expect(printed.join("\n")).toContain("serve tick 2026-11-23T09:00:30.000Z · fails injector 2 bots_failed 1");
    state().stopRun("day-20261123-aaaa", "operator");
    printed = [];
    expect(await run(["status"])).toBe(0);
    expect(printed.join("\n")).not.toContain("serve tick");
  });

  test("seed prints the ids and counts of the org and picks the target of the flag", async () => {
    expect(await run(["seed"])).toBe(0);
    expect(await run(["seed", "--org", "demo"])).toBe(0);
    expect(seedCalls.map((target) => [target.key, target.mode, target.mailbox])).toEqual([
      ["lab", "assist", LAB_MAILBOXES.lab],
      ["demo", "shadow", LAB_MAILBOXES.demo],
    ]);
    expect(printed[0]).toBe(
      "seed: created lab org o-new mailbox m-new chat 5550001 · added mailbox 1 delegates 3 rules 2 flags 11 · link linked"
    );
  });

  test("seed: a refusal of the seed exits 1 with its code; another error is not caught", async () => {
    seedResult = new LabSeedError("org_gone");
    expect(await run(["seed"])).toBe(1);
    expect(failed).toEqual(["refused: org_gone"]);
    seedResult = new Error("boom");
    await expect(run(["seed"])).rejects.toThrow("boom");
  });

  test("start stores the urgency profile after the run is written; a refused start stores none", async () => {
    seedOrgs();
    expect(await run(["start", "--mode", "day", "--date", "2026-11-23", "--cap-usd", "9"])).toBe(1);
    expect(stored).toEqual([]);
    expect(await run(["start", "--mode", "day", "--date", "2026-11-23"])).toBe(0);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toStartWith("o-lab day-20261123-aaaa ");
    // The second start of the same org is refused by the lock and does not touch the profile of the active run.
    expect(await run(["start", "--mode", "day", "--date", "2026-11-23"])).toBe(1);
    expect(stored).toHaveLength(1);
  });

  test("start: a failed profile store stops the run and frees the org", async () => {
    seedOrgs();
    storeError = new Error("store down");
    await expect(run(["start", "--mode", "day", "--date", "2026-11-23"])).rejects.toThrow("store down");
    expect(state().activeRuns()).toEqual([]);
    const events = state().events(state().listRuns()[0] as string);
    expect(events.map((event) => event.t === "stopped" && event.reason)).toContain("error:urgency_profile");
  });

  test("not_seeded: an org that is not in orgs.json is refused", async () => {
    expect(await run(["start", "--mode", "day", "--date", "2026-11-23"])).toBe(1);
    expect(failed.join("\n")).toContain("not_seeded");
    expect(runFolders()).toEqual([]);
  });

  test("3: --cap-usd above the default is cap_too_high", async () => {
    seedOrgs();
    expect(await run(["start", "--cap-usd", "6", "--mode", "week", "--date", "2026-11-23"])).toBe(1);
    expect(failed.join("\n")).toContain("cap_too_high");
    failed = [];
    expect(await run(["start", "--cap-usd", "2", "--mode", "day", "--date", "2026-11-23"])).toBe(1);
    expect(failed.join("\n")).toContain("cap_too_high");
    expect(runFolders()).toEqual([]);
  });

  test("a lower request is kept; the default is $1 (day) and $5 (week)", async () => {
    seedOrgs();
    expect(await run(["start", "--mode", "day", "--date", "2026-11-23", "--cap-usd", "0.5"])).toBe(0);
    expect(state().readRun("day-20261123-aaaa").capUsd).toBe(0.5);
    expect(await run(["start", "--mode", "week", "--date", "2026-11-23", "--org", "demo"])).toBe(0);
    expect(state().readRun("week-20261123-bbbb").capUsd).toBe(5);
  });

  test("the default date: tomorrow (day) and the next Monday (week), Warsaw", async () => {
    seedOrgs();
    expect(await run(["start", "--mode", "day"])).toBe(0);
    expect(state().readRun("day-20261121-aaaa").plan.startDate).toBe("2026-11-21");
    expect(await run(["start", "--mode", "week", "--org", "demo"])).toBe(0);
    expect(state().readRun("week-20261123-bbbb").plan.startDate).toBe("2026-11-23");
  });

  test("4: the cap is clamped by the month ledger and the caps of active runs (review B5)", async () => {
    seedOrgs();
    writeFileSync(state().ledgerPath(), ledgerLine({ runId: "old", at: NOW, usd: 17, label: "x" }));
    // An active day run of the demo org holds $1.
    expect(await run(["start", "--mode", "day", "--date", "2026-11-23", "--org", "demo"])).toBe(0);
    printed = [];
    expect(await run(["start", "--mode", "week", "--date", "2026-11-23"])).toBe(0);
    expect(state().readRun("week-20261123-bbbb").capUsd).toBe(2);
    expect(printed.join("\n")).toContain("cap $2.00");
  });

  test("4b: a ledger at $19.10 plus an active $1 cap leaves nothing: month_cap, no run folder", async () => {
    seedOrgs();
    writeFileSync(state().ledgerPath(), ledgerLine({ runId: "old", at: NOW, usd: 19.1, label: "x" }));
    expect(await run(["start", "--mode", "day", "--date", "2026-11-23", "--org", "demo", "--cap-usd", "0.5"])).toBe(0);
    // $19.10 + $0.50 active: $0.40 are left, so a week run gets that clamped cap.
    expect(await run(["start", "--mode", "week", "--date", "2026-11-23"])).toBe(0);
    expect(state().readRun("week-20261123-bbbb").capUsd).toBeCloseTo(0.4, 10);
    state().stopRun("week-20261123-bbbb", "done");
    // A demo run now holds the rest ($0.90 of the $20): the lab org has no budget left.
    state().stopRun("day-20261123-aaaa", "done");
    expect(await run(["start", "--mode", "day", "--date", "2026-11-24", "--org", "demo"])).toBe(0);
    failed = [];
    expect(await run(["start", "--mode", "day", "--date", "2026-11-24", "--org", "lab"])).toBe(1);
    expect(failed.join("\n")).toContain("month_cap");
    expect(runFolders().sort()).toEqual(["day-20261123-aaaa", "day-20261124-cccc", "week-20261123-bbbb"]);
  });

  test("5: a second start for the same org exits 1 with run_active; one active run remains", async () => {
    seedOrgs();
    expect(await run(["start", "--mode", "day", "--date", "2026-11-23"])).toBe(0);
    failed = [];
    expect(await run(["start", "--mode", "day", "--date", "2026-11-24"])).toBe(1);
    expect(failed.join("\n")).toContain("run_active");
    expect(state().activeRuns()).toEqual(["day-20261123-aaaa"]);
    expect(runFolders()).toEqual(["day-20261123-aaaa"]);
  });

  test("6: org_not_fresh when the org holds mail; --reuse starts anyway (review T10)", async () => {
    seedOrgs();
    hasMail = true;
    expect(await run(["start", "--mode", "day", "--date", "2026-11-23"])).toBe(1);
    expect(failed.join("\n")).toContain("org_not_fresh");
    expect(runFolders()).toEqual([]);
    expect(await run(["start", "--mode", "day", "--date", "2026-11-23", "--reuse"])).toBe(0);
    expect(state().activeRuns()).toHaveLength(1);
  });

  test("N8: a configured model with no price is refused as model_unpriced; no run folder", async () => {
    seedOrgs();
    models = [LUNA, { model: "x-unknown", endpoint: "standard" }];
    expect(await run(["start", "--mode", "day", "--date", "2026-11-23"])).toBe(1);
    expect(failed.join("\n")).toContain("model_unpriced (x-unknown)");
    expect(runFolders()).toEqual([]);
  });

  test("N3: the price check uses the endpoint kind of the role: own never refused, eu needs an eu row", async () => {
    seedOrgs();
    // An own server costs 0 and has no price row: not refused.
    models = [LUNA, { model: "x-own-model", endpoint: "own" }];
    expect(await run(["start", "--mode", "day", "--date", "2026-11-23"])).toBe(0);
    state().stopRun("day-20261123-aaaa", "operator");
    // A model with a standard row only, on an eu endpoint, would count $0 toward the cap: refused.
    models = [LUNA, { model: "gemini-3.5-flash-lite", endpoint: "eu" }];
    printed = [];
    expect(await run(["start", "--mode", "day", "--date", "2026-11-23"])).toBe(1);
    expect(failed.join("\n")).toContain("model_unpriced (gemini-3.5-flash-lite)");
    // The eu row of gpt-6-luna exists: not refused.
    models = [{ model: "gpt-6-luna", endpoint: "eu" }];
    expect(await run(["start", "--mode", "day", "--date", "2026-11-24"])).toBe(0);
  });

  test("8: stop writes stopped: operator and one ledger line, also when it runs twice", async () => {
    seedOrgs();
    expect(await run(["start", "--mode", "day", "--date", "2026-11-23"])).toBe(0);
    spend = { kind: "ok", usd: 0.25, calls: 3, unpricedCalls: 0 };
    printed = [];
    expect(await run(["stop", "--run", "day-20261123-aaaa"])).toBe(0);
    expect(printed.join("\n")).toContain("stopped: operator");
    expect(
      state()
        .events("day-20261123-aaaa")
        .find((event) => event.t === "stopped")
    ).toMatchObject({
      reason: "operator",
    });
    expect(state().activeRuns()).toEqual([]);
    expect(ledgerLines()).toHaveLength(1);
    expect(JSON.parse(ledgerLines()[0] as string)).toMatchObject({ runId: "day-20261123-aaaa", usd: 0.25 });
    expect(await run(["stop", "--run", "day-20261123-aaaa"])).toBe(0);
    expect(ledgerLines()).toHaveLength(1);
    // The stopped run no longer counts as committed: the cap is the full request again.
    expect(await run(["start", "--mode", "day", "--date", "2026-11-24"])).toBe(0);
  });

  test("8b: stop of an unknown run exits 1 and writes no ledger line", async () => {
    expect(await run(["stop", "--run", "day-20261123-zzzz"])).toBe(1);
    expect(failed.join("\n")).toContain("no_such_run");
    expect(ledgerLines()).toEqual([]);
  });

  test("status prints the counts, the spend and the stop reason of each run", async () => {
    seedOrgs();
    expect(await run(["status"])).toBe(0);
    expect(printed).toEqual(["no runs"]);
    printed = [];
    expect(await run(["start", "--mode", "day", "--date", "2026-11-23"])).toBe(0);
    const id = "day-20261123-aaaa";
    state().append(id, { t: "inject_done", slotId: "s1", messageId: "<a>" });
    state().append(id, { t: "inject_done", slotId: "s2", messageId: "<b>", lateBySec: 90 });
    state().append(id, { t: "bot_done", key: "k", messageId: "<r>" });
    state().append(id, { t: "tap_done", key: "t", data: "ap:1" });
    state().append(id, { t: "skip", code: "inject_failed", ref: "s3" });
    spend = { kind: "unpriced", usd: 0.1, calls: 4, unpricedCalls: 1 };
    printed = [];
    expect(await run(["status", "--run", id])).toBe(0);
    const line = printed.join("\n");
    expect(line).toContain("injected 2 · late 1 · replies 1 · taps 1 · skips 1");
    expect(line).toContain("spend unpriced (1 calls, priced part $0.1000)");
    expect(line).toContain("stopped no");
    expect(await run(["status", "--run", "day-20261123-zzzz"])).toBe(1);
  });
});
