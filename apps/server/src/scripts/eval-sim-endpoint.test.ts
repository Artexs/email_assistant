import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type LlmEndpointKind, type LlmRole, llmPrices, type Slot } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { gateFileName, gateFileSchema } from "../modules/triage";
import { loadConfig } from "../platform/config";
import { type LlmCall, type LlmClient, LlmSoftError } from "../platform/llm";
import { readSlots, writeJson } from "../platform/sim-files";

import { runClassifier } from "./eval";
import { parseEvalArgs } from "./eval-args";
import { runSim } from "./lib/eval-sim";
import { completeCorpus, type MiniCorpus, removeAllCorpora } from "./lib/sim-fixtures.test-helper";

// A holdout run per endpoint. Own state and gate files, no budget for an own run, and the
// guard that stops an uncapped PAID run stays. Fake client, temp dirs: no real call, no money.

const OWN_MODEL = "SpeakLeash/bielik-11b-v3.1:Q4_K_M";
const PAID_MODEL = "gpt-6-luna";

const env = {
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
  LLM_PROVIDER: "openai",
};
const standardConfig = loadConfig({ ...env, OPENAI_API_KEY: "o-key" });
const euConfig = loadConfig({ ...env, OPENAI_API_KEY: "o-key", OPENAI_BASE_URL: "https://eu.api.openai.com/v1" });
// The port and the path must never reach a report or a gate file.
const ownConfig = loadConfig({ ...env, OPENAI_BASE_URL: "http://127.0.0.1:11500/v1", OPENAI_OWN_MODEL: OWN_MODEL });

let tmp = "";
afterAll(removeAllCorpora);
let corpus: MiniCorpus | undefined;
let lines: string[] = [];
let spies: { mockRestore(): void }[] = [];
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "f111-sim-endpoint-"));
  lines = [];
  const capture = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  spies = [
    spyOn(console, "error").mockImplementation(capture),
    spyOn(console, "log").mockImplementation(capture),
    spyOn(console, "warn").mockImplementation(capture),
    spyOn(console, "info").mockImplementation(capture),
    spyOn(process.stdout, "write").mockImplementation(() => true),
  ];
});
afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  corpus?.cleanup();
  corpus = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

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

function fakeClient(slots: Slot[], model: string, endpoint: LlmEndpointKind) {
  const category = new Map(slots.map((slot) => [slot.id, slot.category]));
  let calls = 0;
  const client: LlmClient = {
    modelOf: () => model,
    endpointOf: () => endpoint,
    providerOf: () => "openai",
    async generate<T, R extends LlmRole>(req: LlmCall<T, R>) {
      calls += 1;
      const id = /Temat ([a-z0-9-]+)/.exec(req.prompt)?.[1] ?? "";
      const expected = category.get(id);
      if (expected === undefined) throw new Error(`no slot for the prompt of ${id}`);
      return {
        data: answer(expected) as T,
        usage: {
          role: "classifier",
          promptVersion: "classifier-v2",
          model,
          tokensIn: 100,
          tokensOut: 20,
          latencyMs: 5,
          endpoint,
          provider: "openai" as const,
        },
      };
    },
  };
  return { client, calls: () => calls };
}

async function run(opts: {
  config: ReturnType<typeof loadConfig>;
  model: string;
  endpoint: LlmEndpointKind;
  extra?: string[];
  part?: "holdout" | "dev";
}) {
  const part = opts.part ?? "holdout";
  corpus = await completeCorpus();
  writeJson(join(corpus.dir, "manifest.json"), { version: "1", audit: { status: "pending" } });
  const fake = fakeClient(readSlots(corpus.dir, part), opts.model, opts.endpoint);
  const gateDir = join(tmp, "gate");
  const ledger = join(tmp, "spend.jsonl");
  const out = join(tmp, "report.md");
  const options = parseEvalArgs([
    "--sim",
    "mini",
    "--part",
    part,
    "--model",
    opts.model,
    "--concurrency",
    "1",
    "--retries",
    "0",
    "--spend-ledger",
    ledger,
    "--out",
    out,
    ...(opts.extra ?? []),
  ]);
  expect(options).toBeDefined();
  let clients = 0;
  const code = await runSim(options as NonNullable<typeof options>, {
    config: opts.config,
    root: corpus.root,
    runsDir: join(tmp, "runs"),
    gateDir,
    createLlmClient: () => {
      clients += 1;
      return fake.client;
    },
  });
  return {
    code,
    clients,
    calls: fake.calls(),
    ledger,
    gateDir,
    gateFiles: existsSync(gateDir) ? readdirSync(gateDir) : [],
    stateFiles: existsSync(join(tmp, "runs")) ? readdirSync(join(tmp, "runs")) : [],
    report: existsSync(out) ? readFileSync(out, "utf8") : "",
  };
}

describe("runSim budget by endpoint (D12, review B2)", () => {
  test("5. a standard run of a model with no price row is refused; an own run of the same model starts and charges 0", async () => {
    const refused = await run({ config: standardConfig, model: OWN_MODEL, endpoint: "standard" });
    expect(refused.code).toBe(1);
    expect(lines.some((line) => line.includes(`no price for model ${OWN_MODEL}`))).toBe(true);
    expect(refused.clients).toBe(0);
    expect(refused.calls).toBe(0);
    expect(refused.stateFiles).toEqual([]);

    lines = [];
    const own = await run({ config: ownConfig, model: OWN_MODEL, endpoint: "own" });
    expect(own.code).toBe(0);
    expect(own.calls).toBeGreaterThan(0);
    // The ledger line is $0: the run spent nothing.
    const ledger = readFileSync(own.ledger, "utf8").trim().split("\n");
    expect(ledger).toHaveLength(1);
    expect(JSON.parse(ledger[0] as string)).toMatchObject({ usd: 0 });
    expect(lines.some((line) => line.includes("cap=none (own endpoint)"))).toBe(true);
  });

  test("6. a price of 0 on standard stays refused (an uncapped paid run)", async () => {
    llmPrices["zero-price-model"] = [{ inputPerM: 0, outputPerM: 0, source: "test", checked: "2026-11-15" }];
    try {
      const r = await run({ config: standardConfig, model: "zero-price-model", endpoint: "standard" });
      expect(r.code).toBe(1);
      expect(lines.some((line) => line.includes("no price for model zero-price-model"))).toBe(true);
      expect(r.clients).toBe(0);
      expect(r.calls).toBe(0);
    } finally {
      Reflect.deleteProperty(llmPrices, "zero-price-model");
    }
  });

  test("an eu run of a model with no EU row is refused, though it has a standard row", async () => {
    llmPrices["standard-only-model"] = [{ inputPerM: 1, outputPerM: 1, source: "test", checked: "2026-11-15" }];
    try {
      const r = await run({ config: euConfig, model: "standard-only-model", endpoint: "eu" });
      expect(r.code).toBe(1);
      expect(lines.some((line) => line.includes("no price for model standard-only-model"))).toBe(true);
      expect(r.clients).toBe(0);
    } finally {
      Reflect.deleteProperty(llmPrices, "standard-only-model");
    }
  });

  test("an own run with --judge is refused: the judge is a paid provider and the run has no cap", async () => {
    const r = await run({
      config: { ...ownConfig, GEMINI_API_KEY: "g-key" },
      model: OWN_MODEL,
      endpoint: "own",
      extra: ["--judge"],
    });
    expect(r.code).toBe(1);
    expect(lines.some((line) => line.includes("an own endpoint run has no USD budget"))).toBe(true);
    expect(r.clients).toBe(0);
    expect(r.calls).toBe(0);
  });
});

describe("runSim state, gate and report by endpoint (D8)", () => {
  test("7. an own run: own state and gate file, report with host only, price line 'own endpoint: cost 0'", async () => {
    const r = await run({ config: ownConfig, model: OWN_MODEL, endpoint: "own" });
    expect(r.code).toBe(0);
    expect(r.stateFiles).toHaveLength(1);
    expect(r.stateFiles[0]).toEndWith("-sim-mini-v1-holdout-own.jsonl");
    expect(r.gateFiles).toEqual([
      gateFileName({
        role: "classifier",
        endpoint: "own",
        promptVersion: "classifier-v2",
        model: OWN_MODEL,
        reasoningEffort: null,
        scenario: "mini",
        version: "1",
      }),
    ]);
    expect(r.gateFiles[0]).toEndWith("-default-mini-v1-own.json");
    const file = gateFileSchema.parse(JSON.parse(readFileSync(join(r.gateDir, r.gateFiles[0] as string), "utf8")));
    expect(file).toMatchObject({ endpoint: "own", host: "127.0.0.1", model: OWN_MODEL, reasoningEffort: null });
    expect(r.report).toContain("endpoint=own host=127.0.0.1");
    expect(r.report).toContain("own endpoint: cost 0");
    expect(r.report).not.toContain("11500");
    expect(r.report).not.toContain("http://");
    expect(JSON.stringify(file)).not.toContain("11500");
    // The run line prints the same fields.
    expect(lines.some((line) => line.includes("endpoint=own host=127.0.0.1"))).toBe(true);
  });

  test("an eu run: eu state and gate file; the report shows the EU price row and says it is unverified", async () => {
    const r = await run({ config: euConfig, model: PAID_MODEL, endpoint: "eu" });
    expect(r.code).toBe(0);
    expect(r.stateFiles[0]).toEndWith("-sim-mini-v1-holdout-eu.jsonl");
    expect(r.gateFiles[0]).toEndWith("-v1-eu.json");
    const file = gateFileSchema.parse(JSON.parse(readFileSync(join(r.gateDir, r.gateFiles[0] as string), "utf8")));
    expect(file).toMatchObject({ endpoint: "eu", host: "eu.api.openai.com" });
    expect(r.report).toContain("endpoint=eu host=eu.api.openai.com");
    expect(r.report).toContain("E11 discovery notes §6 (opsware.co 2026-10-16, secondary)");
    expect(r.report).toContain("UNVERIFIED");
    // 100 in / 20 out per call at the EU rate.
    const ledger = JSON.parse(readFileSync(r.ledger, "utf8").trim()) as { usd: number };
    expect(ledger.usd).toBeCloseTo(r.calls * ((100 * 0.11 + 20 * 0.55) / 1_000_000), 9);
  });

  test("a standard run keeps its old names and prints the standard price row", async () => {
    const r = await run({ config: standardConfig, model: PAID_MODEL, endpoint: "standard" });
    expect(r.code).toBe(0);
    expect(r.stateFiles[0]).toEndWith("-sim-mini-v1-holdout.jsonl");
    expect(r.gateFiles[0]).toEndWith("-none-mini-v1.json");
    expect(r.report).toContain("endpoint=standard host=api.openai.com");
    expect(r.report).toContain("https://developers.openai.com/api/docs/pricing");
    expect(r.report).not.toContain("UNVERIFIED");
  });

  test("2a. a v3 own run: the gate file holds the parts, endpoint and host; its name has no part", async () => {
    const r = await run({
      config: ownConfig,
      model: OWN_MODEL,
      endpoint: "own",
      extra: ["--prompt-version", "classifier-v3", "--prompt-parts", "urgency"],
    });
    expect(r.code).toBe(0);
    const file = gateFileSchema.parse(JSON.parse(readFileSync(join(r.gateDir, r.gateFiles[0] as string), "utf8")));
    expect(file).toMatchObject({ endpoint: "own", host: "127.0.0.1", promptParts: ["urgency"] });
    expect(r.gateFiles[0]).not.toContain("urgency");
    expect(r.gateFiles[0]).toEndWith("-v1-own.json");
    expect(r.stateFiles[0]).toContain("classifier-v3_urgency_");
    expect(r.stateFiles[0]).toEndWith("-own.jsonl");
  });

  test("two endpoints of one model never share a state file", async () => {
    const standard = await run({ config: standardConfig, model: PAID_MODEL, endpoint: "standard", part: "dev" });
    const eu = await run({ config: euConfig, model: PAID_MODEL, endpoint: "eu", part: "dev" });
    expect(standard.stateFiles).toHaveLength(1);
    expect(eu.stateFiles).toHaveLength(2);
    expect(new Set(eu.stateFiles).size).toBe(2);
  });
});

describe("runClassifier state file by endpoint (D8)", () => {
  const failing = (endpoint: LlmEndpointKind): LlmClient => ({
    modelOf: () => OWN_MODEL,
    endpointOf: () => endpoint,
    providerOf: () => "openai",
    generate: () => Promise.reject(new LlmSoftError("http_503", OWN_MODEL)),
  });

  async function classify(extra: string[]) {
    const options = parseEvalArgs([
      "--set",
      "synthetic",
      "--limit",
      "2",
      "--retries",
      "0",
      "--model",
      OWN_MODEL,
      ...extra,
    ]);
    expect(options).toBeDefined();
    await runClassifier(options as NonNullable<typeof options>, {
      config: ownConfig,
      runsDir: join(tmp, "runs"),
      createLlmClient: () => failing("own"),
    });
    return existsSync(join(tmp, "runs")) ? readdirSync(join(tmp, "runs")) : [];
  }

  test("an own run names its state file with -own", async () => {
    const files = await classify([]);
    expect(files).toHaveLength(1);
    expect(files[0]).toEndWith("-classifier-v2-synthetic-own.jsonl");
    expect(lines.some((line) => line.includes("endpoint=own host=127.0.0.1"))).toBe(true);
  });

  test("an explicit --state path gets no suffix: the caller keeps one endpoint per file", async () => {
    const state = join(tmp, "mine.jsonl");
    const files = await classify(["--state", state]);
    expect(files).toEqual([]);
    // The run wrote to the path as given; nothing with `-own` next to it.
    expect(existsSync(state)).toBe(true);
    expect(existsSync(join(tmp, "mine-own.jsonl"))).toBe(false);
    expect(lines.some((line) => line.includes(`state ${state}:`))).toBe(true);
  });
});
