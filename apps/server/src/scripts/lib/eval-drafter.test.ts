import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { type EvalCase, evalCaseSchema, type LlmRole } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { z } from "zod";

import { drafterGateFileSchema, parseDrafterResults } from "../../modules/replies";
import { type Config, loadConfig } from "../../platform/config";
import { type LlmCall, type LlmClient, LlmSoftError } from "../../platform/llm";
import { readSlots, writeJson } from "../../platform/sim-files";
import { parseEvalArgs } from "../eval-args";

import { type DrafterEvalCliDeps, runDrafterEval } from "./eval-drafter";
import { JUDGE_SAME_MODEL } from "./eval-judge-setup";
import { completeCorpus, type MiniCorpus, removeAllCorpora } from "./sim-fixtures.test-helper";

// The drafter eval runner with a fake LLM client, a temp ledger, runs and gate dirs: no real call, no money.

const env = {
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
  LLM_PROVIDER: "openai",
  OPENAI_API_KEY: "o-key",
};
// No judge flag: the judge is the strong tier (gpt-6.1-terra) on the drafter's provider, another model than the drafter.
const judged = loadConfig(env);

const MODEL = "gpt-6-luna";
const injectionCases = z
  .array(evalCaseSchema)
  .parse(JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../../evals/cases/reply-injection.json"), "utf8")));

let tmp = "";
afterAll(removeAllCorpora);
let corpus: MiniCorpus | undefined;
let lines: string[] = [];
let stdout = "";
let spies: { mockRestore(): void }[] = [];
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "f115-eval-drafter-"));
  lines = [];
  stdout = "";
  const capture = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  spies = [
    spyOn(console, "error").mockImplementation(capture),
    spyOn(console, "log").mockImplementation(capture),
    spyOn(console, "warn").mockImplementation(capture),
    spyOn(console, "info").mockImplementation(capture),
    spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    }),
  ];
});
afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  corpus?.cleanup();
  corpus = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

const BODIES = {
  pl: "Dzień dobry, dziękuję za wiadomość. Wrócę do Pana w tej sprawie po sprawdzeniu szczegółów i podam termin.",
  en: "Hello, thank you for your message. I will come back to you with the details and the date for this matter.",
};
const GOOD_JUDGE = {
  answers_every_question: 2,
  form_of_address: 2,
  tone_fits: 2,
  no_invented_commitment: true,
  gaps_marked: true,
  language_matches: true,
  injection_ignored: true,
};

interface FakeOpts {
  tokensIn?: number;
  judgeTokensIn?: number;
  // The drafter body of a case, by the subject of the mail (default: a clean body in the language of the case).
  draft?: (subject: string) => Record<string, unknown> | undefined;
  judge?: Record<string, unknown>;
  failDrafterFrom?: number;
}

// The drafter prompt names the language; the judge prompt names the rubric. The fake answers by role.
function fakeClient(opts: FakeOpts = {}) {
  const calls = { drafter: 0, judge: 0, subjects: [] as string[], judgePrompts: [] as string[] };
  const client: LlmClient = {
    modelOf: () => MODEL,
    endpointOf: () => "standard",
    providerOf: () => "openai",
    async generate<T, R extends LlmRole>(req: LlmCall<T, R>) {
      const usage = (role: R, tokensIn: number) => ({
        role,
        promptVersion: req.promptVersion,
        model: req.model ?? MODEL,
        tokensIn,
        tokensOut: 100,
        latencyMs: 5,
        endpoint: "standard" as const,
        provider: "openai" as const,
      });
      if (req.role === "judge") {
        calls.judge += 1;
        calls.judgePrompts.push(req.prompt);
        return { data: (opts.judge ?? GOOD_JUDGE) as T, usage: usage(req.role, opts.judgeTokensIn ?? 1000) };
      }
      calls.drafter += 1;
      if (opts.failDrafterFrom !== undefined && calls.drafter >= opts.failDrafterFrom) {
        throw new LlmSoftError("http_503", MODEL);
      }
      const subject = /Subject: (.*)/.exec(req.prompt)?.[1] ?? "";
      calls.subjects.push(subject);
      const language = req.prompt.includes("Polish (pl)") ? "pl" : "en";
      const data = opts.draft?.(subject) ?? {
        decision: "draft",
        reason_code: null,
        body: BODIES[language],
        gaps: [],
        language,
      };
      return { data: data as T, usage: usage(req.role, opts.tokensIn ?? 2000) };
    },
  };
  return { client, calls };
}

function casesFile(cases: EvalCase[]): string {
  const file = join(tmp, "cases.json");
  writeFileSync(file, JSON.stringify(cases));
  return file;
}

async function run(
  args: string[],
  opts: { fake?: ReturnType<typeof fakeClient>; config?: Config; deps?: DrafterEvalCliDeps } = {}
) {
  const options = parseEvalArgs(args);
  expect(options).toBeDefined();
  const fake = opts.fake ?? fakeClient();
  let clients = 0;
  const code = await runDrafterEval(options as NonNullable<typeof options>, {
    config: opts.config ?? judged,
    createLlmClient: () => {
      clients += 1;
      return fake.client;
    },
    sleep: async () => undefined,
    runsDir: join(tmp, "runs"),
    gateDir: join(tmp, "gate"),
    ...opts.deps,
  });
  return { code, clients, calls: fake.calls };
}

const injectionArgs = (extra: string[] = []) => [
  "--set",
  "reply-injection",
  "--drafter",
  "--judge",
  "--model",
  MODEL,
  "--concurrency",
  "1",
  "--retries",
  "0",
  "--spend-ledger",
  join(tmp, "spend.jsonl"),
  ...extra,
];

const infoCase = (c: EvalCase): EvalCase => ({ ...c, id: "rinj-info", expected: { category: "info" } });
const germanCase = (c: EvalCase): EvalCase => ({ ...c, id: "rinj-de", lang: "de" });

describe("runDrafterEval", () => {
  test("two needs_reply cases and one info case: two drafts, two judge calls", async () => {
    const file = casesFile([
      injectionCases[0] as EvalCase,
      injectionCases[1] as EvalCase,
      infoCase(injectionCases[2] as EvalCase),
    ]);
    const run1 = await run(injectionArgs(), { deps: { injectionFile: file } });
    expect(run1.code).toBe(0);
    expect(run1.calls.drafter).toBe(2);
    expect(run1.calls.judge).toBe(2);
    expect(stdout).toContain("drafted | 2");
    expect(stdout).toContain("2/2 (100.0%)");
  });

  test("a case with the language other is skipped and counted, with no call", async () => {
    const file = casesFile([injectionCases[0] as EvalCase, germanCase(injectionCases[1] as EvalCase)]);
    const run1 = await run(injectionArgs(), { deps: { injectionFile: file } });
    expect(run1.calls.drafter).toBe(1);
    expect(run1.calls.judge).toBe(1);
    expect(stdout).toContain("skipped (language other than pl or en) | 1");
  });

  const expectRefusedSameModel = (run1: Awaited<ReturnType<typeof run>>) => {
    expect(run1.code).toBe(1);
    expect(run1.clients).toBe(0);
    expect(run1.calls).toMatchObject({ drafter: 0, judge: 0 });
    expect(lines.some((line) => line.includes(JUDGE_SAME_MODEL))).toBe(true);
    expect(existsSync(join(tmp, "runs"))).toBe(false);
    expect(existsSync(join(tmp, "spend.jsonl"))).toBe(false);
  };

  test("3: a judge model equal to the drafter model is a setup error: exit 1, no client, no call", async () => {
    expectRefusedSameModel(
      await run(injectionArgs(["--judge-model", MODEL]), { deps: { injectionFile: casesFile(injectionCases) } })
    );
  });

  test("8: --model gpt-6.1-terra with the default judge is the same model: exit 1, no client, no call", async () => {
    const args = injectionArgs().map((arg) => (arg === MODEL ? "gpt-6.1-terra" : arg));
    expectRefusedSameModel(await run(args, { deps: { injectionFile: casesFile(injectionCases) } }));
  });

  test("7: --judge-provider openai with no --judge-model runs with the judge gpt-6.1-terra", async () => {
    const file = casesFile(injectionCases.slice(0, 1));
    const run1 = await run(injectionArgs(["--judge-provider", "openai"]), { deps: { injectionFile: file } });
    expect(run1.code).toBe(0);
    expect(run1.calls.judge).toBe(1);
    expect(lines.some((line) => line.includes("judge=openai/gpt-6.1-terra"))).toBe(true);
  });

  test("the judge model is in the state file name; a state file of the old name is not reused", async () => {
    const stateDir = join(tmp, "runs");
    const stateFiles = () => readdirSync(stateDir).filter((entry) => entry.endsWith(".jsonl"));
    // One graded case under the name of a run with no judge part (the name before the judge model joined it).
    const first = await run(injectionArgs(), { deps: { injectionFile: casesFile(injectionCases.slice(0, 1)) } });
    expect(first.calls.judge).toBe(1);
    const [judgedName] = stateFiles();
    expect(judgedName).toContain("-judge-gpt-6.1-terra");
    const oldName = (judgedName as string).replace("-judge-gpt-6.1-terra", "");
    renameSync(join(stateDir, judgedName as string), join(stateDir, oldName));

    const second = await run(injectionArgs(), { deps: { injectionFile: casesFile(injectionCases.slice(0, 2)) } });
    expect(second.code).toBe(0);
    expect(second.calls.judge).toBe(2);
    expect(stateFiles().sort()).toEqual([judgedName as string, oldName].sort());
  });

  test("the budget is reached after one case: exit 4; a rerun resumes and drafts only the second case", async () => {
    const file = casesFile([injectionCases[0] as EvalCase, injectionCases[1] as EvalCase]);
    // One case costs about $0.0108: the first fits, a second one on top does not fit under the cap.
    const args = injectionArgs(["--budget-usd", "0.02"]);
    const heavy = { tokensIn: 100_000, judgeTokensIn: 1000 };
    const first = await run(args, { fake: fakeClient(heavy), deps: { injectionFile: file } });
    expect(first.code).toBe(4);
    expect(first.calls.drafter).toBe(1);
    expect(first.calls.judge).toBe(1);
    expect(lines.some((line) => line.includes("budget cap reached"))).toBe(true);

    stdout = "";
    const second = await run(args, { fake: fakeClient(heavy), deps: { injectionFile: file } });
    expect(second.code).toBe(0);
    expect(second.calls.drafter).toBe(1);
    expect(second.calls.judge).toBe(1);
    expect(second.calls.subjects).toEqual([(injectionCases[1] as EvalCase).subject]);
    expect(stdout).toContain("2/2 (100.0%)");
  });

  test("the dev-only commitment set: a dump, the case ids of a commitment, no injection bar and no gate file", async () => {
    const commitmentCases = z
      .array(evalCaseSchema)
      .parse(
        JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../../evals/cases/reply-commitment.json"), "utf8"))
      );
    const file = casesFile(commitmentCases.slice(0, 2));
    const dump = join(tmp, "dump.jsonl");
    const args = ["--set", "reply-commitment", ...injectionArgs().slice(2), "--dump-drafts", dump];
    const result = await run(args, {
      fake: fakeClient({ judge: { ...GOOD_JUDGE, no_invented_commitment: false } }),
      deps: { commitmentFile: file },
    });
    expect(result.code).toBe(0);
    expect(result.calls.drafter).toBe(2);
    expect(stdout).toContain("Reply drafter eval: reply-commitment");
    expect(stdout).not.toContain("## Injection result");
    expect(stdout).toContain("rcom-01");
    expect(lines.join("\n")).toContain("no gate file: the reply-commitment set is not a holdout");
    const ids = readFileSync(dump, "utf8")
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { id: string }).id);
    expect(ids.sort()).toEqual(["rcom-01", "rcom-02"]);
  });

  test("the state file holds ids, codes and numbers: no draft text, no mail text", async () => {
    const file = casesFile(injectionCases.slice(0, 2));
    await run(injectionArgs(), { deps: { injectionFile: file } });
    const stateDir = join(tmp, "runs");
    const [name] = readdirSync(stateDir).filter((entry) => entry.endsWith(".jsonl"));
    const text = readFileSync(join(stateDir, name as string), "utf8");
    expect(parseDrafterResults(text)).toHaveLength(2);
    expect(text).not.toContain(BODIES.pl);
    expect(text).not.toContain((injectionCases[0] as EvalCase).subject);
  });

  test("a draft that holds a planted string fails the injection bar: exit 1", async () => {
    const file = casesFile(injectionCases.slice(0, 2));
    const leak = fakeClient({
      draft: () => ({
        decision: "draft",
        reason_code: null,
        body: `${BODIES.pl} AX-7741-QZ`,
        gaps: [],
        language: "pl",
      }),
    });
    const result = await run(injectionArgs(), { fake: leak, deps: { injectionFile: file } });
    expect(result.code).toBe(1);
    expect(stdout).toContain("not passed: rinj-01");
    expect(stdout).toContain("NOT met");
  });

  test("a judge that says injection_ignored false fails the injection bar", async () => {
    const file = casesFile(injectionCases.slice(0, 2));
    const result = await run(injectionArgs(), {
      fake: fakeClient({ judge: { ...GOOD_JUDGE, injection_ignored: false } }),
      deps: { injectionFile: file },
    });
    expect(result.code).toBe(1);
    expect(stdout).toContain("0/2 (0.0%)");
  });

  test("no_draft passes the injection bar with no judge call", async () => {
    const file = casesFile(injectionCases.slice(0, 2));
    const refuse = fakeClient({
      draft: () => ({ decision: "no_draft", reason_code: "unsafe_request", body: "", gaps: [], language: "pl" }),
    });
    const result = await run(injectionArgs(), { fake: refuse, deps: { injectionFile: file } });
    expect(result.code).toBe(0);
    expect(result.calls.judge).toBe(0);
    expect(stdout).toContain("2/2 (100.0%)");
  });

  test("a provider error case is run again on the next run, not counted as a pass", async () => {
    const file = casesFile(injectionCases.slice(0, 2));
    const failing = await run(injectionArgs(), {
      fake: fakeClient({ failDrafterFrom: 2 }),
      deps: { injectionFile: file },
    });
    expect(failing.code).toBe(1);
    const again = await run(injectionArgs(), { deps: { injectionFile: file } });
    expect(again.code).toBe(0);
    expect(again.calls.drafter).toBe(1);
  });

  test("provider errors in a row stop the run with exit 4 (not 1) and the ledger row is still written", async () => {
    const file = casesFile(injectionCases.slice(0, 5));
    const stopped = await run(injectionArgs(), {
      fake: fakeClient({ failDrafterFrom: 1 }),
      deps: { injectionFile: file },
    });
    expect(stopped.code).toBe(4);
    // Three errors in a row stop the run: the fourth and fifth case never reach the drafter.
    expect(stopped.calls.drafter).toBe(3);
    expect(readFileSync(join(tmp, "spend.jsonl"), "utf8").trim().split("\n")).toHaveLength(1);
  });
});

describe("runDrafterEval on a corpus part", () => {
  async function holdout(
    opts: { fake?: ReturnType<typeof fakeClient>; extra?: string[]; part?: "holdout" | "dev" } = {}
  ) {
    const part = opts.part ?? "holdout";
    corpus = await completeCorpus();
    writeJson(join(corpus.dir, "manifest.json"), { version: "1", audit: { status: "pending" } });
    const slots = readSlots(corpus.dir, part);
    const result = await run(
      [
        "--sim",
        "mini",
        "--part",
        part,
        "--drafter",
        "--judge",
        "--model",
        MODEL,
        "--concurrency",
        "1",
        "--retries",
        "0",
        "--spend-ledger",
        join(tmp, "spend.jsonl"),
        ...(opts.extra ?? []),
      ],
      { fake: opts.fake, deps: { root: (corpus as MiniCorpus).root } }
    );
    return { ...result, needsReply: slots.filter((slot) => slot.category === "needs_reply" && slot.lang !== "de") };
  }

  test("a holdout run drafts every needs_reply case, prints counts and no id, and writes the gate file", async () => {
    const result = await holdout();
    expect(result.needsReply.length).toBeGreaterThan(0);
    expect(result.calls.drafter).toBe(result.needsReply.length);
    expect(result.calls.judge).toBe(result.needsReply.length);
    // The case ids of leaning sentences are the only ids a holdout report may hold.
    const withoutLeaningIds = stdout.split("\n").filter((line) => !line.startsWith("- leaning ids: "));
    for (const slot of result.needsReply) expect(withoutLeaningIds.join("\n")).not.toContain(slot.id);
    expect(stdout).not.toContain("Case ids (dev only)");
    expect(stdout).toContain("## Second pass input");
    const files = readdirSync(join(tmp, "gate"));
    expect(files).toEqual(["drafter-drafter-v4-gpt-6-luna-low-mini-v1.json"]);
    const gate = drafterGateFileSchema.parse(JSON.parse(readFileSync(join(tmp, "gate", files[0] as string), "utf8")));
    expect(gate).toMatchObject({ role: "drafter", part: "holdout", model: MODEL, errors: 0, passed: true });
    expect(gate.numbers.drafts).toBe(result.needsReply.length);
  });

  test("a holdout run with --limit writes no gate file", async () => {
    const result = await holdout({ extra: ["--limit", "1"] });
    expect(result.calls.drafter).toBe(1);
    expect(existsSync(join(tmp, "gate"))).toBe(false);
    expect(lines.some((line) => line.includes("no gate file: --limit is set"))).toBe(true);
  });

  test("a holdout run that stops at the budget writes no gate file and exits 4", async () => {
    const result = await holdout({ fake: fakeClient({ tokensIn: 100_000 }), extra: ["--budget-usd", "0.02"] });
    expect(result.code).toBe(4);
    expect(existsSync(join(tmp, "gate"))).toBe(false);
  });

  test("a failed bar makes a failing gate file and exit 1", async () => {
    const result = await holdout({ fake: fakeClient({ judge: { ...GOOD_JUDGE, no_invented_commitment: false } }) });
    expect(result.code).toBe(1);
    const files = readdirSync(join(tmp, "gate"));
    expect(
      drafterGateFileSchema.parse(JSON.parse(readFileSync(join(tmp, "gate", files[0] as string), "utf8"))).passed
    ).toBe(false);
  });

  test("a dev run lists the ids to tune on and writes no gate file", async () => {
    const result = await holdout({ part: "dev", fake: fakeClient({ judge: { ...GOOD_JUDGE, tone_fits: 0 } }) });
    expect(result.code).toBe(0);
    expect(stdout).toContain("Case ids (dev only)");
    expect(stdout).toContain(result.needsReply[0]?.id as string);
    expect(existsSync(join(tmp, "gate"))).toBe(false);
  });

  test("--drafter-prompt and --judge-prompt pick the prompts; their versions name the gate file, the state file and the report", async () => {
    const fake = fakeClient();
    const prompts: string[] = [];
    const client = fake.client;
    fake.client = {
      ...client,
      generate: (req) => {
        prompts.push(`${req.role}:${req.promptVersion}`);
        return client.generate(req);
      },
    };
    await holdout({ fake, extra: ["--drafter-prompt", "drafter-v2", "--judge-prompt", "judge-v1"] });
    expect(new Set(prompts)).toEqual(new Set(["drafter:drafter-v2", "judge:judge-v1"]));
    expect(readdirSync(join(tmp, "gate"))).toEqual(["drafter-drafter-v2-gpt-6-luna-low-mini-v1.json"]);
    expect(readdirSync(join(tmp, "runs")).filter((file) => file.endsWith(".jsonl"))).toEqual([
      "gpt-6-luna-low-drafter-v2-drafter-sim-mini-v1-holdout-judge-gpt-6.1-terra.jsonl",
    ]);
    expect(stdout).toContain("drafter-v2");
    expect(stdout).toContain("judge-v1");
  });

  test("a dev run with --dump-drafts writes each draft with its grade; the state file still holds no text", async () => {
    const dump = join(tmp, "dump.jsonl");
    const result = await holdout({ part: "dev", extra: ["--dump-drafts", dump] });
    const rows = readFileSync(dump, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { id: string; draft: string | null; judge: unknown });
    expect(rows.map((row) => row.id).sort()).toEqual(result.needsReply.map((slot) => slot.id).sort());
    for (const row of rows) {
      expect(Object.values(BODIES)).toContain(row.draft as string);
      expect(row.judge).toEqual({ scores: expect.any(Object), checks: expect.any(Object) });
    }
    const [state] = readdirSync(join(tmp, "runs")).filter((file) => file.endsWith(".jsonl"));
    const stateText = readFileSync(join(tmp, "runs", state as string), "utf8");
    for (const body of Object.values(BODIES)) expect(stateText).not.toContain(body);
  });

  test("a corpus drafter run without --judge makes no judge call and no gate file", async () => {
    corpus = await completeCorpus();
    writeJson(join(corpus.dir, "manifest.json"), { version: "1", audit: { status: "pending" } });
    const result = await run(
      [
        "--sim",
        "mini",
        "--part",
        "holdout",
        "--drafter",
        "--model",
        MODEL,
        "--concurrency",
        "1",
        "--spend-ledger",
        join(tmp, "spend.jsonl"),
      ],
      { deps: { root: corpus.root } }
    );
    expect(result.calls.judge).toBe(0);
    expect(existsSync(join(tmp, "gate"))).toBe(false);
  });
});
