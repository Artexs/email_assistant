import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { DrafterCaseResult } from "../../modules/replies";
import { evalStateFileName } from "../../modules/triage";

import { keyOfFile, STYLE_NONE, STYLE_SCENARIO } from "./eval-drafter-style";
import { parseDrafterStateName, runPairRefusal, runStyleGate } from "./eval-style-gate";

const STYLE = {
  scenario: "lab-01",
  part: "sent-holdout",
  promptVersion: "stylist-v1",
  model: "gpt-6-luna",
  effort: "low",
  sampleCount: 40,
  text: "Short mails, no greeting for close colleagues.",
  checks: { ok: true, failures: [] as string[] },
  usd: 0.01,
};
const STYLE_KEY = keyOfFile(STYLE.promptVersion, STYLE.text);
const INJECTION = { promptVersion: "stylist-v1", model: "gpt-6-luna", effort: "low", passed: 8, total: 8, usd: 0.01 };
const CASE_IDS = Array.from({ length: 60 }, (_, index) => `c${index}`);

// The state file name that `eval --drafter --judge` writes for a run with this style key.
function stateName(
  styleSuffix: string,
  judgeVersion = "judge-v4",
  part = "holdout",
  drafterPrompt = "drafter-v4"
): string {
  return evalStateFileName({
    model: "gpt-6-luna",
    endpoint: "standard",
    reasoningEffort: "low",
    promptVersion: drafterPrompt,
    set: `drafter-sim-lab-01-v1-${part}${styleSuffix}`,
    judgeModel: "gpt-6.1-terra",
    judgeVersion,
  });
}

function draft(id: string, style: number): DrafterCaseResult {
  return {
    id,
    source: "llm",
    outcome: "draft",
    reasonCode: null,
    failures: [],
    calls: 1,
    gaps: 0,
    leak: false,
    usage: null,
    judgeUsage: null,
    errorCode: null,
    judge: {
      scores: { answers_every_question: 2, form_of_address: 2, tone_fits: 2, style_match: style },
      checks: { no_invented_commitment: true, gaps_marked: true, language_matches: true, injection_ignored: true },
    },
  };
}

const lines = (results: DrafterCaseResult[]): string => results.map((r) => JSON.stringify(r)).join("\n");

describe("parseDrafterStateName", () => {
  const names: [string, string, "standard" | "eu", string][] = [
    ["no style, standard endpoint", "", "standard", STYLE_SCENARIO],
    ["a none style", "-style-none", "standard", STYLE_NONE],
    ["a style file key", `-style-${STYLE_KEY}`, "eu", STYLE_KEY],
  ];
  test.each(names)("reads the name of a run with %s", (_name, suffix, endpoint, style) => {
    const file = evalStateFileName({
      model: "gpt-6-luna",
      endpoint,
      reasoningEffort: "low",
      promptVersion: "drafter-v4",
      set: `drafter-sim-lab-01-v1-holdout${suffix}`,
      judgeModel: "gpt-6.1-terra",
      judgeVersion: "judge-v4",
    });
    expect(parseDrafterStateName(`/some/dir/${file}`)).toEqual({
      model: "gpt-6-luna",
      reasoningEffort: "low",
      drafterPrompt: "drafter-v4",
      scenario: "lab-01",
      version: "1",
      part: "holdout",
      style,
      judgeModel: "gpt-6.1-terra",
      judgeVersion: "judge-v4",
      endpoint,
    });
  });

  test("a run without a judge has no judge fields, and a classifier state file has no name", () => {
    const file = evalStateFileName({
      model: "gpt-6-luna",
      endpoint: "standard",
      reasoningEffort: null,
      promptVersion: "drafter-v4",
      set: "drafter-sim-lab-01-v1-holdout",
    });
    expect(parseDrafterStateName(file)).toMatchObject({ reasoningEffort: null, judgeModel: null, judgeVersion: null });
    expect(parseDrafterStateName("gpt-6-luna-none-classifier-v2-synthetic.jsonl")).toBeNull();
  });
});

describe("runPairRefusal", () => {
  const a = parseDrafterStateName(stateName("-style-none"));
  const b = parseDrafterStateName(stateName(`-style-${STYLE_KEY}`));
  if (a === null || b === null) throw new Error("fixture names do not parse");

  test("two runs that differ in the style alone are eligible", () => {
    expect(runPairRefusal(a, b, STYLE_KEY)).toBeNull();
  });

  test.each([
    ["run A has the scenario style", { ...a, style: STYLE_SCENARIO }, b, "run A does not have the style key none"],
    ["run B has another style file", a, { ...b, style: "stylist-v1-00000000" }, "run B does not have the style key"],
    ["a run uses judge-v3", { ...a, judgeVersion: "judge-v3" }, b, "a run does not use judge-v4"],
    ["a run has no judge", a, { ...b, judgeModel: null, judgeVersion: null }, "a run has no judge"],
    ["a run is a dev run", { ...a, part: "dev" }, b, "a run is not a holdout run"],
    ["the drafter models differ", a, { ...b, model: "other" }, "the runs differ in the drafter model"],
    ["the efforts differ", a, { ...b, reasoningEffort: "high" }, "the runs differ in the drafter effort"],
  ])("%s", (_name, left, right, reason) => {
    expect(runPairRefusal(left, right, STYLE_KEY)).toContain(reason);
  });
});

describe("runStyleGate", () => {
  let dir = "";
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "style-gate-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const holdout = async () => ({ ids: CASE_IDS, version: "1", manifestSha: "abc123" });

  // Writes the inputs of one run of the command; `cases` are the ids that the runs hold, `b` the style scores of B.
  function setup(
    name: string,
    input: {
      aSuffix?: string;
      bSuffix?: string;
      cases?: string[];
      bStyle?: number;
      part?: string;
      bDrafterPrompt?: string;
    }
  ) {
    const base = join(dir, name);
    const cases = input.cases ?? CASE_IDS;
    const part = input.part ?? "holdout";
    const files = {
      a: join(base, stateName(input.aSuffix ?? "-style-none", "judge-v4", part)),
      b: join(base, stateName(input.bSuffix ?? `-style-${STYLE_KEY}`, "judge-v4", part, input.bDrafterPrompt)),
      style: join(base, "style.json"),
      injection: join(base, "injection.json"),
      out: join(base, "report.md"),
      gate: join(base, "gate"),
    };
    rmSync(base, { recursive: true, force: true });
    Bun.spawnSync(["mkdir", "-p", base]);
    writeFileSync(files.a, lines(cases.map((id) => draft(id, 1))));
    writeFileSync(files.b, lines(cases.map((id) => draft(id, input.bStyle ?? 2))));
    writeFileSync(files.style, JSON.stringify(STYLE));
    writeFileSync(files.injection, JSON.stringify(INJECTION));
    return files;
  }

  async function run(files: ReturnType<typeof setup>, mode: { smoke?: boolean; holdout?: typeof holdout } = {}) {
    const printed: string[] = [];
    const smoke = mode.smoke === true;
    const code = await runStyleGate(
      {
        a: files.a,
        b: files.b,
        style: files.style,
        injection: smoke ? null : files.injection,
        out: files.out,
        smoke,
      },
      {
        out: { print: (t) => printed.push(t), fail: (t) => printed.push(t), write: (t) => printed.push(t) },
        gateDir: files.gate,
        now: () => new Date("2026-11-21T10:00:00Z"),
        holdout: mode.holdout ?? holdout,
      }
    );
    return { code, printed: printed.join("\n") };
  }

  const gateName = "stylist-stylist-v1-gpt-6-luna-low-lab-01-v1.json";

  test("two full runs with a gain write the gate file under the stylist name and exit 0", async () => {
    const files = setup("pass", {});
    const { code } = await run(files);
    const gate = JSON.parse(readFileSync(join(files.gate, gateName), "utf8"));
    expect(code).toBe(0);
    expect(gate).toMatchObject({
      role: "stylist",
      scenario: "lab-01",
      version: "1",
      manifestSha: "abc123",
      date: "2026-11-21",
      passed: true,
      failures: [],
      stylist: { promptVersion: "stylist-v1", model: "gpt-6-luna", reasoningEffort: "low" },
      drafter: { promptVersion: "drafter-v4", model: "gpt-6-luna", reasoningEffort: "low" },
      judge: { model: "gpt-6.1-terra", promptVersion: "judge-v4" },
      cases: 60,
      numbers: { pairs: 60, wins: 60, losses: 0, ties: 0, meanA: 1, meanB: 2 },
    });
    expect(readFileSync(files.out, "utf8")).toContain("Verdict: PASS");
  });

  test("a failed bar still writes the gate file, with passed false, and exits 1", async () => {
    const files = setup("fail", { bStyle: 1 });
    const { code } = await run(files);
    const gate = JSON.parse(readFileSync(join(files.gate, gateName), "utf8"));
    expect(code).toBe(1);
    expect(gate.passed).toBe(false);
    expect(gate.failures).toEqual(["gain_pairs", "gain_wilson", "gain_mean"]);
  });

  test("a run with a --limit holds fewer cases: the report is written and the gate file is not", async () => {
    const files = setup("limit", { cases: CASE_IDS.slice(0, 30) });
    const { code, printed } = await run(files);
    expect(code).toBe(1);
    expect(existsSync(join(files.gate, gateName))).toBe(false);
    expect(existsSync(files.out)).toBe(true);
    expect(printed).toContain("no gate file: a run has no result for every case");
  });

  test("run A with the scenario style writes the report and no gate file", async () => {
    const files = setup("scenario", { aSuffix: "" });
    const { code, printed } = await run(files);
    expect(code).toBe(1);
    expect(existsSync(join(files.gate, gateName))).toBe(false);
    expect(existsSync(files.out)).toBe(true);
    expect(printed).toContain("no gate file: run A does not have the style key none");
  });

  test("a state file that does not exist exits 1 with one line that names the file", async () => {
    const files = setup("missing", {});
    rmSync(files.b);
    const { code, printed } = await run(files);
    expect(code).toBe(1);
    expect(printed).toBe(`state file ${files.b} cannot be read`);
  });

  describe("--smoke", () => {
    const cases = CASE_IDS.slice(0, 20);
    const neverCalled = async (): Promise<never> => {
      throw new Error("the holdout loader was called");
    };

    test("two dev runs with a gain exit 0 and write the report, ids and scores only, and no gate file", async () => {
      const files = setup("smoke-pass", { part: "dev", cases });
      const { code, printed } = await run(files, { smoke: true, holdout: neverCalled });
      const report = readFileSync(files.out, "utf8");
      expect(code).toBe(0);
      expect(report).toContain("Verdict: pass (smoke)");
      expect(report).toContain("Pairs: 20 (wins 20, losses 0, ties 0)");
      expect(report).toContain("style_match mean: A 1.00, B 2.00");
      expect(report).toContain("- c0: 1, 2");
      expect(report).not.toContain(STYLE.text);
      expect(printed).toContain("style smoke: pass (smoke)");
      expect(existsSync(files.gate)).toBe(false);
    });

    test("equal scores in both runs exit 1 with the judge stop", async () => {
      const files = setup("smoke-flat", { part: "dev", cases, bStyle: 1 });
      const { code } = await run(files, { smoke: true });
      expect(code).toBe(1);
      expect(readFileSync(files.out, "utf8")).toContain("Verdict: judge stop");
    });

    test("a holdout pair exits 2 and writes no report", async () => {
      const files = setup("smoke-holdout", {});
      const { code, printed } = await run(files, { smoke: true });
      expect(code).toBe(2);
      expect(printed).toBe("a holdout pair goes through the full gate");
      expect(existsSync(files.out)).toBe(false);
    });

    test("a pair with another drafter prompt in B exits 2", async () => {
      const files = setup("smoke-prompt", { part: "dev", cases, bDrafterPrompt: "drafter-v5" });
      const { code, printed } = await run(files, { smoke: true });
      expect(code).toBe(2);
      expect(printed).toBe("the runs differ in the drafter prompt");
    });

    test("without --smoke a dev pair is refused as before and the full gate writes no gate file", async () => {
      const files = setup("smoke-off", { part: "dev", cases });
      const { code, printed } = await run(files);
      expect(code).toBe(1);
      expect(printed).toContain("no gate file: a run is not a holdout run");
      expect(existsSync(files.gate)).toBe(false);
    });
  });
});
