import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { llmPrices, type SentPart } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { extractorGateFileSchema } from "../../modules/loops";
import { loadConfig } from "../../platform/config";
import { type GenerateFn, LlmSoftError } from "../../platform/llm";
import { createFixedLlmClient } from "../../platform/llm/testing";
import { readSentSlots } from "../../platform/sim-sent-files";
import { parseEvalArgs } from "../eval-args";

import { runExtractorEval } from "./eval-extractor";
import { runSimInProcess } from "./sim-fixtures.test-helper";
import {
  completeSentCorpus,
  miniSentFloors,
  type SentCorpus,
  removeAllSentCorpora,
} from "./sim-sent-fixtures.test-helper";

// The extractor runner on a mini sent corpus with a fake LLM. No real call, no money.

const MODEL = "gpt-6-luna";
const env = {
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
  LLM_PROVIDER: "openai",
};
const config = loadConfig({ ...env, OPENAI_API_KEY: "o-key" });
const keyless = loadConfig(env);

let tmp = "";
afterAll(removeAllSentCorpora);
let corpus: SentCorpus | undefined;
let lines: string[] = [];
let stdout = "";
let spies: { mockRestore(): void }[] = [];
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "f116-eval-extractor-"));
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

// The fake answers what the slot labels say (a perfect extractor), or what `answerOf` says. The case id is the
// subject of the fixture text.
function fakeClient(
  part: SentPart,
  opts: { tokensIn?: number; failIds?: Set<string>; answerOf?: (id: string) => unknown } = {}
) {
  const slots = new Map(readSentSlots((corpus as SentCorpus).dir, part).map((slot) => [slot.id, slot]));
  const calls: string[] = [];
  const generate: GenerateFn = async (request) => {
    const id = /Subject: Temat (\S+)/.exec(request.prompt)?.[1] ?? "";
    const slot = slots.get(id);
    if (slot === undefined) throw new Error(`no slot for ${id}`);
    calls.push(id);
    if (opts.failIds?.has(id)) throw new LlmSoftError("http_503", MODEL);
    const { labels } = slot;
    const answer = opts.answerOf?.(id) ?? {
      expects_reply: labels.expectsReply,
      ask: labels.ask,
      due: labels.due,
      promise: labels.promise,
      promise_due: labels.promiseDue,
      language: slot.lang,
    };
    return { text: JSON.stringify(answer), tokensIn: opts.tokensIn ?? 100, tokensOut: 20, blocked: false };
  };
  return { client: createFixedLlmClient(generate, { provider: "openai", model: MODEL }), calls };
}

async function setup(freeze: boolean): Promise<SentCorpus> {
  corpus = await completeSentCorpus();
  if (freeze) {
    const result = await runSimInProcess([
      "freeze",
      "mini",
      "--bank",
      "sent",
      ...miniSentFloors,
      "--root",
      corpus.root,
    ]);
    expect(result.code).toBe(0);
  }
  return corpus;
}

async function run(opts: {
  part: SentPart;
  args?: string[];
  client?: ReturnType<typeof fakeClient>;
  config?: ReturnType<typeof loadConfig>;
  runsName?: string;
}) {
  const c = corpus as SentCorpus;
  const fake = opts.client ?? fakeClient(opts.part);
  const gateDir = join(tmp, "gate");
  const ledger = join(tmp, "spend.jsonl");
  const out = join(tmp, `report-${opts.part}.md`);
  const options = parseEvalArgs([
    "--sim",
    "mini",
    "--part",
    opts.part,
    "--extractor",
    "--model",
    MODEL,
    "--concurrency",
    "1",
    "--retries",
    "0",
    "--spend-ledger",
    ledger,
    "--out",
    out,
    ...(opts.args ?? []),
  ]);
  expect(options).toBeDefined();
  let clients = 0;
  const code = await runExtractorEval(options as NonNullable<typeof options>, {
    config: opts.config ?? config,
    root: c.root,
    runsDir: join(tmp, opts.runsName ?? "runs"),
    gateDir,
    sleep: () => Promise.resolve(),
    createLlmClient: () => {
      clients += 1;
      return fake.client;
    },
  });
  const runs = join(tmp, opts.runsName ?? "runs");
  return {
    code,
    clients,
    calls: fake.calls,
    gateFiles: existsSync(gateDir) ? readdirSync(gateDir) : [],
    gateDir,
    stateFiles: existsSync(runs) ? readdirSync(runs).filter((file) => file.endsWith(".jsonl")) : [],
    runs,
    ledger: existsSync(ledger)
      ? readFileSync(ledger, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as { usd: number; label: string })
      : [],
    report: existsSync(out) ? readFileSync(out, "utf8") : "",
  };
}

describe("runExtractorEval", () => {
  test("a dev run scores every case, lists the missed ids, writes no gate file and a ledger line", async () => {
    await setup(false);
    const fake = fakeClient("sent-dev");
    const r = await run({ part: "sent-dev", client: fake });
    expect(r.code).toBe(0);
    // One slot is a many_recipients case: a code filter skips it, so it makes no call.
    expect(r.calls).toHaveLength(19);
    expect(r.report).toContain("skipped by a code filter 1");
    expect(r.report).toContain("# Extractor eval: sim mini sent-dev");
    expect(r.report).toContain("## Misses (dev ids)");
    expect(r.report).toContain("## Second pass input");
    expect(r.gateFiles).toEqual([]);
    expect(lines.some((line) => line.includes("no gate file: part is not sent-holdout"))).toBe(true);
    expect(r.stateFiles).toEqual([`${MODEL}-none-extractor-v1-sent-mini-vdraft-sent-dev.jsonl`]);
    // The ledger line holds the new spend of the run: 19 calls of 100 tokens in and 20 out.
    expect(r.ledger).toHaveLength(1);
    expect(r.ledger[0]?.label).toBe(`mini-sent-dev-${MODEL}`);
    expect(r.ledger[0]?.usd).toBeCloseTo((19 * (100 * 0.1 + 20 * 0.5)) / 1_000_000, 9);
  });

  test("a holdout run needs a frozen corpus", async () => {
    await setup(false);
    const r = await run({ part: "sent-holdout" });
    expect(r.code).toBe(1);
    expect(lines.some((line) => line.includes("holdout needs a frozen corpus"))).toBe(true);
    expect(r.clients).toBe(0);
    expect(r.calls).toHaveLength(0);
  });

  test("a holdout run writes the gate file with the numbers and no case id in the report", async () => {
    await setup(true);
    const r = await run({ part: "sent-holdout" });
    expect(r.calls.length).toBeGreaterThan(0);
    expect(r.gateFiles).toEqual([`extractor-extractor-v1-${MODEL}-none-mini-vsent-v1.json`]);
    const gate = extractorGateFileSchema.parse(
      JSON.parse(readFileSync(join(r.gateDir, r.gateFiles[0] as string), "utf8"))
    );
    expect(gate).toMatchObject({ part: "sent-holdout", scenario: "mini", version: "sent-v1", cases: 60, errors: 0 });
    expect(gate.partSha).toMatch(/^[0-9a-f]{64}$/);
    // The exit code follows the gate: 0 when it passed, 1 when it failed.
    expect(r.code).toBe(gate.passed ? 0 : 1);
    expect(r.report).toContain(gate.passed ? "Result: PASS" : "Result: FAIL");
    expect(r.report).not.toContain("## Misses");
    expect(r.report).not.toMatch(/\bs-\d{4}\b|\bsh-[a-z]+-\d+\b/);
    expect(stdout).not.toMatch(/\bs-\d{4}\b/);
  });

  test("a failed holdout case prints its code and no case id", async () => {
    await setup(true);
    const ids = readSentSlots((corpus as SentCorpus).dir, "sent-holdout").map((slot) => slot.id);
    const failId = ids[0] as string;
    const r = await run({ part: "sent-holdout", client: fakeClient("sent-holdout", { failIds: new Set([failId]) }) });
    expect(r.calls).toContain(failId);
    // The failure line exists, with the code only.
    expect(lines.some((line) => line.includes("failed: http_503"))).toBe(true);
    for (const id of ids) expect(lines.some((line) => line.includes(id))).toBe(false);
  });

  test("a holdout run with --limit writes no gate file", async () => {
    await setup(true);
    const r = await run({ part: "sent-holdout", args: ["--limit", "5"] });
    expect(r.gateFiles).toEqual([]);
    expect(lines.some((line) => line.includes("no gate file: --limit is set"))).toBe(true);
  });

  test("T4 --budget-usd 0.001 stops with exit 4 after the first call, spends into the ledger and resumes", async () => {
    await setup(false);
    // One call costs 6,000 in and 20 out = $0.00061. A second call would pass the cap of $0.001.
    const first = await run({
      part: "sent-dev",
      args: ["--budget-usd", "0.001"],
      client: fakeClient("sent-dev", { tokensIn: 6000 }),
    });
    expect(first.code).toBe(4);
    expect(first.calls).toHaveLength(1);
    expect(first.report).toContain("not complete");
    expect(first.gateFiles).toEqual([]);
    expect(first.ledger).toHaveLength(1);
    expect(first.ledger[0]?.usd).toBeCloseTo((6000 * 0.1 + 20 * 0.5) / 1_000_000, 9);

    // The same command resumes: the first case is not called again.
    const second = await run({ part: "sent-dev", client: fakeClient("sent-dev") });
    expect(second.code).toBe(0);
    expect(second.calls).toHaveLength(18);
    expect(second.calls).not.toContain(first.calls[0]);
    expect(second.ledger).toHaveLength(2);
  });

  test("an error case runs again on the next run", async () => {
    await setup(false);
    const slots = readSentSlots((corpus as SentCorpus).dir, "sent-dev");
    const bad = (slots[3] as { id: string }).id;
    const first = await run({ part: "sent-dev", client: fakeClient("sent-dev", { failIds: new Set([bad]) }) });
    // One error case of 20 is 5%: under the 10% line.
    expect(first.code).toBe(0);
    expect(first.report).toContain("error cases 1");
    const second = await run({ part: "sent-dev", client: fakeClient("sent-dev") });
    expect(second.calls).toEqual([bad]);
    expect(second.report).toContain("error cases 0");
  });

  test("more than 10% error cases fail the run", async () => {
    await setup(false);
    const ids = readSentSlots((corpus as SentCorpus).dir, "sent-dev").map((slot) => slot.id);
    // Three errors, not in a row, in 20 cases (15%).
    const failIds = new Set([ids[1], ids[6], ids[13]] as string[]);
    const r = await run({ part: "sent-dev", client: fakeClient("sent-dev", { failIds }) });
    expect(r.code).toBe(1);
    expect(lines.some((line) => line.includes("more than 10%"))).toBe(true);
  });

  test("three errors in a row stop the run with exit 4", async () => {
    await setup(false);
    const ids = readSentSlots((corpus as SentCorpus).dir, "sent-dev").map((slot) => slot.id);
    const r = await run({ part: "sent-dev", client: fakeClient("sent-dev", { failIds: new Set(ids) }) });
    expect(r.code).toBe(4);
    expect(r.calls).toHaveLength(3);
  });

  test("a missing key, and a model with no price are refused before any call", async () => {
    await setup(false);
    const keyless1 = await run({ part: "sent-dev", config: keyless });
    expect(keyless1.code).toBe(1);
    expect(lines.some((line) => line.includes("OPENAI_API_KEY is missing"))).toBe(true);
    expect(keyless1.clients).toBe(0);

    lines = [];
    const unpriced = await run({ part: "sent-dev", args: ["--model", "no-price-model"] });
    expect(unpriced.code).toBe(1);
    expect(lines.some((line) => line.includes("no price for model no-price-model"))).toBe(true);
    expect(unpriced.clients).toBe(0);
    expect(llmPrices["no-price-model"]).toBeUndefined();
  });
});
