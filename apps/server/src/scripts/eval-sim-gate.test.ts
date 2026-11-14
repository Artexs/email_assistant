import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type LlmRole, type Slot } from "@ea/core";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { gateFileName, gateFileSchema } from "../modules/triage";
import { loadConfig } from "../platform/config";
import { type LlmCall, type LlmClient, LlmSoftError } from "../platform/llm";

import { parseEvalArgs } from "./eval-args";
import { runSim } from "./eval-sim";
import { readSlots, writeJson } from "./sim-files";
import { completeCorpus, type MiniCorpus } from "./sim-fixtures.test-helper";

// The gate file rule of D27 at the runSim level: a gate file comes only from a COMPLETE holdout run at the default
// bar and minimum support with no --limit. Fake LLM client, temp ledger, runs and gate dirs: no real call, no money.

const config = loadConfig({
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
  LLM_PROVIDER: "openai",
  OPENAI_API_KEY: "o-key",
});

const MODEL = "gpt-6-luna";
const REFUSAL_PREFIX = "no gate file:";

let tmp = "";
let corpus: MiniCorpus | undefined;
let lines: string[] = [];
let spies: { mockRestore(): void }[] = [];
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "f097-sim-gate-"));
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

// Answers the slot category of the case. The fixture subject is `Temat <slot id>`. `failFrom`: every call from the
// n-th on ends in a soft error, so the run stops as not complete.
function fakeClient(slots: Slot[], opts: { failFrom?: number } = {}): { client: LlmClient; calls: () => number } {
  const category = new Map(slots.map((slot) => [slot.id, slot.category]));
  let calls = 0;
  const client: LlmClient = {
    modelOf: () => MODEL,
    async generate<T, R extends LlmRole>(req: LlmCall<T, R>) {
      const n = calls;
      calls += 1;
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
        },
      };
    },
  };
  return { client, calls: () => calls };
}

async function run(extra: string[], opts: { part?: "holdout" | "dev"; failFrom?: number } = {}) {
  const part = opts.part ?? "holdout";
  corpus = await completeCorpus();
  // `sim freeze` is stage 12; the loader reads only the version and the audit status.
  writeJson(join(corpus.dir, "manifest.json"), { version: "1", audit: { status: "pending" } });
  const fake = fakeClient(readSlots(corpus.dir, part), { failFrom: opts.failFrom });
  const gateDir = join(tmp, "gate");
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
    "--spend-ledger",
    join(tmp, "spend.jsonl"),
    ...extra,
  ];
  const options = parseEvalArgs(args);
  expect(options).toBeDefined();
  const code = await runSim(options as NonNullable<typeof options>, {
    config,
    root: corpus.root,
    runsDir: join(tmp, "runs"),
    gateDir,
    createLlmClient: () => fake.client,
  });
  const files = existsSync(gateDir) ? readdirSync(gateDir) : [];
  return { code, files, gateDir, calls: fake.calls(), lines };
}

describe("runSim gate file", () => {
  test("a complete holdout run at the defaults writes the gate file with its name and content", async () => {
    const r = await run([]);
    expect(r.calls).toBeGreaterThan(0);
    expect(r.files).toHaveLength(1);
    const name = r.files[0] as string;
    const file = gateFileSchema.parse(JSON.parse(readFileSync(join(r.gateDir, name), "utf8")));
    expect(name).toBe(
      gateFileName({
        role: "classifier",
        promptVersion: "classifier-v2",
        model: MODEL,
        reasoningEffort: file.reasoningEffort,
        scenario: "mini",
        version: "1",
      })
    );
    expect(file).toMatchObject({
      scenario: "mini",
      version: "1",
      part: "holdout",
      audit: "pending",
      provisional: true,
      role: "classifier",
      model: MODEL,
      promptVersion: "classifier-v2",
      bar: 0.98,
      minKept: 30,
    });
    expect(file.manifestSha).toMatch(/^[0-9a-f]{64}$/);
    for (const category of ["urgent", "needs_reply", "info", "notification", "spam"] as const) {
      expect(["go", "no-go", "no-go: too few"]).toContain(file.categories[category].decision);
    }
    // The mini corpus is far below 200 rows per category: the gate says so, it never says "go".
    expect(file.categories.info.decision).toBe("no-go: too few");
    expect(lines.some((line) => line.includes(REFUSAL_PREFIX))).toBe(false);
  });

  test("--limit writes no gate file and names the refusal", async () => {
    const r = await run(["--limit", "5"]);
    expect(r.calls).toBe(5);
    expect(r.files).toEqual([]);
    expect(r.lines.some((line) => line.includes(`${REFUSAL_PREFIX} --limit is set`))).toBe(true);
  });

  test("the dev part writes no gate file", async () => {
    const r = await run([], { part: "dev" });
    expect(r.calls).toBeGreaterThan(0);
    expect(r.files).toEqual([]);
    expect(r.lines.some((line) => line.includes(`${REFUSAL_PREFIX} part is not holdout`))).toBe(true);
  });

  test("a bar below 0.98 writes no gate file", async () => {
    const r = await run(["--bar", "0.9"]);
    expect(r.calls).toBeGreaterThan(0);
    expect(r.files).toEqual([]);
    expect(r.lines.some((line) => line.includes(`${REFUSAL_PREFIX} bar is not 0.98`))).toBe(true);
  });

  test("a min-kept below 30 writes no gate file", async () => {
    const r = await run(["--min-kept", "10"]);
    expect(r.calls).toBeGreaterThan(0);
    expect(r.files).toEqual([]);
    expect(r.lines.some((line) => line.includes(`${REFUSAL_PREFIX} min-kept is not 30`))).toBe(true);
  });

  test("an incomplete holdout run (soft errors stop it) writes no gate file", async () => {
    const r = await run([], { failFrom: 3 });
    expect(r.calls).toBeGreaterThanOrEqual(6);
    expect(r.files).toEqual([]);
    expect(r.lines.some((line) => line.includes(`${REFUSAL_PREFIX} the run is not complete`))).toBe(true);
  });
});
