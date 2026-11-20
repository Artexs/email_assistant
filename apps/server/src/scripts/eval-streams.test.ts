import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type LlmRole, type Slot } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { evalStateFileName, prompts } from "../modules/triage";
import { type Config, llmRoleTable, loadConfig } from "../platform/config";
import { ledgerLine } from "../platform/eval-ledger";
import { type LlmCall, type LlmClient, LlmConfigError, LlmOutputError, LlmSoftError } from "../platform/llm";
import { readSlots, writeJson } from "../platform/sim-files";

import { type ClassifierDeps, runClassifier } from "./eval";
import { parseEvalArgs } from "./eval-args";
import { evalFailureLine } from "./lib/eval-failure-line";
import { JUDGE_SAME_MODEL } from "./lib/eval-judge-setup";
import { runSim, type SimDeps } from "./lib/eval-sim";
import { completeCorpus, type MiniCorpus, removeAllCorpora } from "./lib/sim-fixtures.test-helper";

// `bun run eval` and `eval --sim` print through createCliOutput: `print` to stdout, `fail` to stderr. Each test reads
// the two streams apart: console.log is stdout, console.error is stderr. The fake client makes no real call.

const config: Config = loadConfig({
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
  LLM_PROVIDER: "openai",
  OPENAI_API_KEY: "o-key",
});

const MODEL = "gpt-6-luna";

let tmp = "";
afterAll(removeAllCorpora);
let corpus: MiniCorpus | undefined;
let stdout: string[] = [];
let stderr: string[] = [];
let spies: { mockRestore(): void }[] = [];
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "f103-s04-eval-"));
  stdout = [];
  stderr = [];
  spies = [
    spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      stdout.push(args.map(String).join(" "));
    }),
    spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(" "));
    }),
    // The report goes through process.stdout.write: the test does not read it.
    spyOn(process.stdout, "write").mockImplementation(() => true),
  ];
});
afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  corpus?.cleanup();
  corpus = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

function has(lines: string[], text: string): boolean {
  return lines.some((line) => line.startsWith("[eval] ") && line.includes(text));
}

// Each text is on the stream the CLI promises and not on the other one.
function expectStream(text: string, stream: "stdout" | "stderr"): void {
  expect(has(stream === "stdout" ? stdout : stderr, text)).toBe(true);
  expect(has(stream === "stdout" ? stderr : stdout, text)).toBe(false);
}

function answer(category: string): Record<string, unknown> {
  return {
    category,
    confidence: 0.95,
    reason_code: "other",
    reason: "Because.",
    summary: category === "info" ? "Short summary." : null,
    fields: { due_date: null, language: "en", delegate_id: null, task: null, clarification: null },
  };
}

// Answers the slot category of the case (the fixture subject is `Temat <slot id>`). `failFrom`: every call from the
// n-th on ends in a soft error. `configError`: every call ends in an LLM config error.
function fakeClient(
  slots: Slot[],
  opts: { failFrom?: number; configError?: boolean; badOutput?: readonly string[] } = {}
): LlmClient {
  const category = new Map(slots.map((slot) => [slot.id, slot.category]));
  let calls = 0;
  return {
    modelOf: () => MODEL,
    endpointOf: () => "standard",
    providerOf: () => "openai",
    async generate<T, R extends LlmRole>(req: LlmCall<T, R>) {
      const n = calls;
      calls += 1;
      if (opts.configError === true) throw new LlmConfigError("missing_key", MODEL);
      if (opts.badOutput !== undefined) throw new LlmOutputError(MODEL, opts.badOutput);
      if (opts.failFrom !== undefined && n >= opts.failFrom) throw new LlmSoftError("http_503", MODEL);
      const id = /Temat ([a-z0-9-]+)/.exec(req.prompt)?.[1] ?? "";
      const expected = category.get(id);
      if (expected === undefined) throw new Error(`no slot for the prompt of ${id}`);
      return {
        data: answer(expected) as T,
        usage: {
          role: "classifier",
          promptVersion: "classifier-v2",
          model: MODEL,
          tokensIn: 100,
          tokensOut: 20,
          latencyMs: 5,
          endpoint: "standard",
          provider: "openai" as const,
        },
      };
    },
  };
}

interface SimRun {
  extra?: string[];
  part?: "holdout" | "dev";
  failFrom?: number;
  configError?: boolean;
  badOutput?: readonly string[];
  config?: Config;
  ledger?: string | null;
  before?: (paths: { runs: string; stateFile: string }) => void;
}

async function sim(opts: SimRun = {}): Promise<number> {
  const part = opts.part ?? "dev";
  corpus = await completeCorpus();
  // `sim freeze` is a later stage; the loader reads only the version and the audit status.
  writeJson(join(corpus.dir, "manifest.json"), { version: "1", audit: { status: "pending" } });
  const runs = join(tmp, "runs");
  const table = llmRoleTable(opts.config ?? config, { classifier: { model: MODEL } });
  const stateFile = join(
    runs,
    evalStateFileName({
      model: MODEL,
      endpoint: "standard",
      reasoningEffort: table.roles.classifier.reasoningEffort,
      promptVersion: prompts.classifier.version,
      set: `sim-mini-v1-${part}`,
    })
  );
  opts.before?.({ runs, stateFile });
  const args = [
    "--sim",
    "mini",
    "--part",
    part,
    "--model",
    MODEL,
    "--concurrency",
    "1",
    "--retries",
    "0",
    ...(opts.ledger === null ? [] : ["--spend-ledger", opts.ledger ?? join(tmp, "spend.jsonl")]),
    ...(opts.extra ?? []),
  ];
  const options = parseEvalArgs(args);
  expect(options).toBeDefined();
  const deps: SimDeps = {
    config: opts.config ?? config,
    root: corpus.root,
    runsDir: runs,
    gateDir: join(tmp, "gate"),
    createLlmClient: () =>
      fakeClient(readSlots((corpus as MiniCorpus).dir, part), {
        failFrom: opts.failFrom,
        configError: opts.configError,
        badOutput: opts.badOutput,
      }),
  };
  return runSim(options as NonNullable<typeof options>, deps);
}

describe("eval --sim streams", () => {
  test("a reasoning effort the provider does not take: exit 2 and the usage on stderr", async () => {
    const code = await sim({
      extra: ["--provider", "gemini", "--reasoning-effort", "high"],
    });
    expect(code).toBe(2);
    expectStream("--reasoning-effort is not accepted by this provider", "stderr");
    expectStream("usage: bun run eval", "stderr");
    expect(stdout).toEqual([]);
  });

  test("a provider without a key: `<KEY> is missing` on stderr", async () => {
    const code = await sim({ extra: ["--provider", "gemini"] });
    expect(code).toBe(1);
    expectStream("GEMINI_API_KEY is missing", "stderr");
    expect(stdout).toEqual([]);
  });

  test("a judge with the model under test: the setup problem on stderr", async () => {
    const code = await sim({ extra: ["--judge", "--judge-model", MODEL] });
    expect(code).toBe(1);
    expect(stderr).toEqual([`[eval] ${JUDGE_SAME_MODEL}`]);
    expect(stderr.length).toBe(1);
    expect(stderr[0]?.startsWith("[eval] ")).toBe(true);
    expect(stdout).toEqual([]);
  });

  test("no ledger path (no HOME): the error on stderr", async () => {
    const home = process.env.HOME;
    const state = process.env.XDG_STATE_HOME;
    delete process.env.HOME;
    delete process.env.XDG_STATE_HOME;
    try {
      const code = await sim({ ledger: null });
      expect(code).toBe(1);
    } finally {
      if (home !== undefined) process.env.HOME = home;
      if (state !== undefined) process.env.XDG_STATE_HOME = state;
    }
    expect(stderr.length).toBe(1);
    expect(stderr[0]?.startsWith("[eval] ")).toBe(true);
    // The corpus line came before the ledger: it stays on stdout.
    expect(stdout.length).toBe(1);
    expectStream("corpus mini v1 part dev", "stdout");
  });

  test("the month budget used: the refusal on stderr", async () => {
    const ledger = join(tmp, "spent.jsonl");
    writeFileSync(ledger, `${ledgerLine({ runId: "spent", at: new Date(), usd: 1000, label: "earlier" })}\n`);
    const code = await sim({ ledger });
    expect(code).toBe(1);
    expectStream("month budget used", "stderr");
    expectStream("corpus mini v1 part dev", "stdout");
  });

  test("a state file that another run holds: the lock error on stderr", async () => {
    const code = await sim({
      before: ({ runs, stateFile }) => {
        mkdirSync(runs, { recursive: true });
        writeFileSync(`${stateFile}.lock`, `${new Date().toISOString()}\n`);
      },
    });
    expect(code).toBe(1);
    expectStream("state file is locked by another run", "stderr");
    expect(has(stdout, "state ")).toBe(false);
  });

  test("a dev run: the corpus, run and state lines and the gate refusal on stdout, nothing on stderr", async () => {
    const code = await sim();
    expect(code).toBe(0);
    expectStream("corpus mini v1 part dev", "stdout");
    expectStream("provider=openai endpoint=standard host=api.openai.com model=gpt-6-luna", "stdout");
    expectStream("earlier results", "stdout");
    expectStream("no gate file: part is not holdout", "stdout");
    expect(stderr).toEqual([]);
  });

  test("a holdout run: the gate file line on stdout", async () => {
    const code = await sim({ part: "holdout" });
    expect(code).toBe(0);
    expectStream("gate file: evals/results/gate/", "stdout");
    expect(stderr).toEqual([]);
  });

  test("a run that stops (soft errors): `run not complete` on stderr", async () => {
    await sim({ failFrom: 3 });
    expectStream("resume with the same command", "stderr");
  });

  test("a case with a bad model output: the issue paths on stdout, not in the log on stderr", async () => {
    await sim({ badOutput: ["fields.task:too_big"] });
    expectStream("failed: bad_output (fields.task:too_big)", "stdout");
    expect(stderr.join("\n")).not.toContain("too_big");
    expect(stderr.join("\n")).not.toContain("dropped_fields");
  });

  test("an LLM config error: its line on stderr, exit 1", async () => {
    const code = await sim({ configError: true });
    expect(code).toBe(1);
    expectStream("LLM config error missing_key", "stderr");
  });
});

describe("eval (case sets) streams", () => {
  // The case sets come from `evals/cases`; the run stops after a few errors in a row, so 20 cases are enough.
  function classify(extra: string[], deps: Partial<ClassifierDeps> = {}): ReturnType<typeof runClassifier> {
    const options = parseEvalArgs(["--limit", "20", "--retries", "0", "--state", join(tmp, "state.jsonl"), ...extra]);
    expect(options).toBeDefined();
    return runClassifier(options as NonNullable<typeof options>, {
      config,
      runsDir: join(tmp, "runs"),
      createLlmClient: () => fakeClient([], { failFrom: 0 }),
      ...deps,
    });
  }

  test("a reasoning effort the provider does not take: exit 2 and the usage on stderr", async () => {
    const code = await classify(["--provider", "gemini", "--reasoning-effort", "high"]);
    expect(code).toBe(2);
    expectStream("--reasoning-effort is not accepted by this provider", "stderr");
    expectStream("usage: bun run eval", "stderr");
    expect(stdout).toEqual([]);
  });

  test("a provider without a key: `<KEY> is missing` on stderr", async () => {
    const code = await classify(["--provider", "gemini"]);
    expect(code).toBe(1);
    expectStream("GEMINI_API_KEY is missing", "stderr");
    expect(stdout).toEqual([]);
  });

  test("a run that stops (soft errors): the run line and the state line on stdout, `run not complete` on stderr", async () => {
    await classify([]);
    expectStream("provider=openai endpoint=standard host=api.openai.com model=", "stdout");
    expectStream(`state ${join(tmp, "state.jsonl")}: 0 earlier results`, "stdout");
    expectStream("resume with the same command", "stderr");
  });

  test("a case with a bad model output: the issue paths on stdout, only the case id and the code in the log on stderr", async () => {
    await classify([], {
      createLlmClient: () => fakeClient([], { badOutput: ["fields.task:too_big", "fields.due_date:invalid_type"] }),
    });
    expectStream("failed: bad_output (fields.task:too_big, fields.due_date:invalid_type)", "stdout");
    const logLines = stderr.filter((line) => line.startsWith("[eval] eval_case_failed"));
    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) expect(line).toMatch(/^\[eval\] eval_case_failed case_id=\S+ code=bad_output$/);
    // The unfiltered capture of both streams: the paths are only on stdout, and no value was dropped.
    expect(stderr.join("\n")).not.toContain("too_big");
    expect(stderr.join("\n")).not.toContain("dropped_fields");
  });

  test("an LLM config error: its line on stderr, exit 1", async () => {
    const code = await classify([], { createLlmClient: () => fakeClient([], { configError: true }) });
    expect(code).toBe(1);
    expectStream("LLM config error missing_key", "stderr");
  });
});

describe("evalFailureLine", () => {
  test("holds the issue paths; no paths, no brackets", () => {
    expect(
      evalFailureLine({
        caseId: "inv-001",
        code: "bad_output",
        issues: ["fields.task:too_big", "fields.due_date:invalid_type"],
      })
    ).toBe("case inv-001 failed: bad_output (fields.task:too_big, fields.due_date:invalid_type)");
    expect(evalFailureLine({ caseId: "a", code: "http_503", issues: [] })).toBe("case a failed: http_503");
  });
});
