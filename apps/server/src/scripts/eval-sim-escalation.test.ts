import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type LlmRole, type Slot } from "@ea/core";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { gateFileName, gateFileSchema } from "../modules/triage";
import { loadConfig } from "../platform/config";
import { type LlmCall, type LlmClient } from "../platform/llm";
import { readSlots, writeJson } from "../platform/sim-files";

import { parseEvalArgs } from "./eval-args";
import { runSim } from "./eval-sim";
import { completeCorpus, type MiniCorpus } from "./sim-fixtures.test-helper";

// F109 stage 12 at the runSim level: `--escalate` with a fake LLM client, temp ledger, runs and gate dirs.
// No real call, no money.

const config = loadConfig({
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
  LLM_PROVIDER: "openai",
  OPENAI_API_KEY: "o-key",
});

const MODEL = "gpt-6-luna";
const ESCALATION_MODEL = "gpt-6.1-terra";

let tmp = "";
let corpus: MiniCorpus | undefined;
let lines: string[] = [];
let spies: { mockRestore(): void }[] = [];
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "f109-sim-escalate-"));
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

// The classifier hides every mail as `info` (`spam` is not allowed for whitelisted senders); the escalation answers the slot category. The fixture subject is
// `Temat <slot id>`.
function fakeClient(slots: Slot[]) {
  const category = new Map(slots.map((slot) => [slot.id, slot.category]));
  const requests: { role: LlmRole; promptVersion: string; model: string | undefined }[] = [];
  const client: LlmClient = {
    modelOf: (role) => (role === "escalation" ? ESCALATION_MODEL : MODEL),
    endpointOf: () => "standard",
    async generate<T, R extends LlmRole>(req: LlmCall<T, R>) {
      requests.push({ role: req.role, promptVersion: req.promptVersion, model: req.model });
      const id = /Temat ([a-z0-9-]+)/.exec(req.prompt)?.[1] ?? "";
      const expected = category.get(id);
      if (expected === undefined) throw new Error(`no slot for the prompt of ${id}`);
      const escalating = (req.role as LlmRole) === "escalation";
      return {
        data: answer(escalating ? expected : "info") as T,
        usage: {
          role: req.role,
          promptVersion: req.promptVersion,
          model: escalating ? ESCALATION_MODEL : MODEL,
          tokensIn: 100,
          tokensOut: 20,
          latencyMs: 5,
          endpoint: "standard" as const,
        },
      };
    },
  };
  return { client, requests };
}

async function run(extra: string[], part: "holdout" | "dev" = "dev") {
  corpus = await completeCorpus();
  writeJson(join(corpus.dir, "manifest.json"), { version: "1", audit: { status: "pending" } });
  const fake = fakeClient(readSlots(corpus.dir, part));
  const gateDir = join(tmp, "gate");
  const ledger = join(tmp, "spend.jsonl");
  const out = join(tmp, "report.md");
  const options = parseEvalArgs([
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
    ledger,
    "--out",
    out,
    ...extra,
  ]);
  expect(options).toBeDefined();
  let clients = 0;
  const code = await runSim(options as NonNullable<typeof options>, {
    config,
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
    requests: fake.requests,
    gateFiles: existsSync(gateDir) ? readdirSync(gateDir) : [],
    gateDir,
    stateFiles: existsSync(join(tmp, "runs")) ? readdirSync(join(tmp, "runs")) : [],
    ledger,
    report: existsSync(out) ? readFileSync(out, "utf8") : "",
  };
}

const escalate = ["--escalate", "--escalation-model", ESCALATION_MODEL, "--escalation-reasoning-effort", "none"];

describe("runSim --escalate", () => {
  test("a dev run makes classifier and escalation calls, prints the Escalation section and has its own state file", async () => {
    const r = await run(escalate);
    expect(r.requests.filter((q) => q.role === "classifier").length).toBeGreaterThan(0);
    const second = r.requests.filter((q) => q.role === "escalation");
    expect(second.length).toBeGreaterThan(0);
    expect(second.every((q) => q.promptVersion === "escalation-v1" && q.model === ESCALATION_MODEL)).toBe(true);
    expect(r.report).toContain("## Escalation");
    expect(r.report).toContain("prompt escalation-v1");
    expect(r.stateFiles).toHaveLength(1);
    expect(r.stateFiles[0]).toContain("escalation-v1");
    expect(r.stateFiles[0]).toContain(ESCALATION_MODEL);
    // The first calls are the classifier calls: the classifier part of the state name is unchanged.
    expect(r.stateFiles[0]).toContain("classifier-v2");
  });

  test("a run without --escalate makes no escalation call and prints no Escalation section", async () => {
    const r = await run([]);
    expect(r.requests.every((q) => q.role === "classifier")).toBe(true);
    expect(r.report).not.toContain("## Escalation");
    expect(r.stateFiles[0]).not.toContain("escalation");
  });

  test("a complete holdout cascade run writes the gate file as role escalation, never the classifier file", async () => {
    const r = await run(escalate, "holdout");
    expect(r.gateFiles).toHaveLength(1);
    const name = r.gateFiles[0] as string;
    expect(name.startsWith("classifier-")).toBe(false);
    const file = gateFileSchema.parse(JSON.parse(readFileSync(join(r.gateDir, name), "utf8")));
    expect(name).toBe(
      gateFileName({
        role: "escalation",
        endpoint: "standard",
        promptVersion: "escalation-v1",
        model: ESCALATION_MODEL,
        reasoningEffort: "none",
        scenario: "mini",
        version: "1",
      })
    );
    expect(file).toMatchObject({ role: "escalation", model: ESCALATION_MODEL, promptVersion: "escalation-v1" });
    expect(file.promptParts).toBeUndefined();
  });

  test("an escalation model with no price is refused before any client, ledger line or lock", async () => {
    const r = await run(["--escalate", "--escalation-model", "no-such-model"]);
    expect(r.code).toBe(1);
    expect(lines.some((line) => line.includes("no price for model no-such-model"))).toBe(true);
    expect(r.clients).toBe(0);
    expect(existsSync(r.ledger)).toBe(false);
    expect(r.stateFiles).toEqual([]);
  });
});
