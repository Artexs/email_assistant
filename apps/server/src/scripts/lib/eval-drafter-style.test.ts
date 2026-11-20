import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { type EvalCase, evalCaseSchema, type LlmRole } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { z } from "zod";

import { loadConfig } from "../../platform/config";
import type { LlmCall, LlmClient } from "../../platform/llm";
import { writeJson } from "../../platform/sim-files";
import { parseEvalArgs } from "../eval-args";

import { runDrafterEval } from "./eval-drafter";
import { completeCorpus, type MiniCorpus, removeAllCorpora } from "./sim-fixtures.test-helper";

// The `--style` option of the drafter eval, with a fake LLM client and temp dirs: no real call, no money.

const config = loadConfig({
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
  LLM_PROVIDER: "openai",
  OPENAI_API_KEY: "o-key",
});
const MODEL = "gpt-6-luna";
const INJECTION_VOICE = "Krótko i rzeczowo, po imieniu. In English: short and direct.";
const injectionCases = z
  .array(evalCaseSchema)
  .parse(JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../../evals/cases/reply-injection.json"), "utf8")))
  .slice(0, 2);

let tmp = "";
let corpus: MiniCorpus | undefined;
let lines: string[] = [];
let stdout = "";
let spies: { mockRestore(): void }[] = [];
afterAll(removeAllCorpora);
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "eval-drafter-style-"));
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

const GOOD_JUDGE = {
  answers_every_question: 2,
  form_of_address: 2,
  tone_fits: 2,
  no_invented_commitment: true,
  gaps_marked: true,
  language_matches: true,
  injection_ignored: true,
};

// The prompts that each role got. The drafter answers with a clean draft in the language of the case.
function fakeClient() {
  const prompts = { drafter: [] as string[], judge: [] as string[] };
  const client: LlmClient = {
    modelOf: () => MODEL,
    endpointOf: () => "standard",
    providerOf: () => "openai",
    async generate<T, R extends LlmRole>(req: LlmCall<T, R>) {
      const usage = {
        role: req.role,
        promptVersion: req.promptVersion,
        model: req.model ?? MODEL,
        tokensIn: 1000,
        tokensOut: 100,
        latencyMs: 5,
        endpoint: "standard" as const,
        provider: "openai" as const,
      };
      if (req.role === "judge") {
        prompts.judge.push(req.prompt);
        return { data: { ...GOOD_JUDGE, style_match: 1 } as T, usage };
      }
      prompts.drafter.push(req.prompt);
      const language = req.prompt.includes("Polish (pl)") ? "pl" : "en";
      const body =
        language === "pl"
          ? "Dzień dobry, dziękuję za wiadomość. Wrócę do Pana w tej sprawie po sprawdzeniu szczegółów i podam termin."
          : "Hello, thank you for your message. I will come back to you with the details and the date for this matter.";
      return { data: { decision: "draft", reason_code: null, body, gaps: [], language } as T, usage };
    },
  };
  return { client, prompts };
}

function styleFile(overrides: Record<string, unknown> = {}, name = "style.json"): string {
  const file = join(tmp, name);
  writeFileSync(
    file,
    JSON.stringify({
      scenario: "lab-01",
      part: "sent-dev",
      promptVersion: "stylist-v1",
      model: MODEL,
      effort: "low",
      sampleCount: 37,
      text: "Krótko i rzeczowo.",
      checks: { ok: true, failures: [] },
      usd: 0.01,
      ...overrides,
    })
  );
  return file;
}

async function runInjection(extra: string[]) {
  const casesFile = join(tmp, "cases.json");
  writeFileSync(casesFile, JSON.stringify(injectionCases as EvalCase[]));
  const options = parseEvalArgs([
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
  ]);
  const fake = fakeClient();
  let clients = 0;
  const code = await runDrafterEval(options, {
    config,
    createLlmClient: () => {
      clients += 1;
      return fake.client;
    },
    sleep: async () => undefined,
    runsDir: join(tmp, "runs"),
    gateDir: join(tmp, "gate"),
    injectionFile: casesFile,
  });
  return { code, clients, prompts: fake.prompts };
}

const styleLines = (prompts: string[]) => prompts.map((prompt) => /- Writing style: (.*)/.exec(prompt)?.[1]);
const nameLines = (prompts: string[]) => prompts.map((prompt) => /- Display name: (.*)/.exec(prompt)?.[1]);
const stateFiles = () => readdirSync(join(tmp, "runs")).filter((file) => file.endsWith(".jsonl"));

describe("drafter eval --style", () => {
  test("none gives every case no writing style and leaves the name and signature; a file gives its text", async () => {
    const scenario = await runInjection([]);
    const none = await runInjection(["--style", "none", "--fresh"]);
    const filed = await runInjection(["--style", styleFile(), "--fresh"]);
    expect(styleLines(scenario.prompts.drafter)).toEqual([INJECTION_VOICE, INJECTION_VOICE]);
    expect(styleLines(none.prompts.drafter)).toEqual(["(none)", "(none)"]);
    expect(styleLines(filed.prompts.drafter)).toEqual(["Krótko i rzeczowo.", "Krótko i rzeczowo."]);
    expect(nameLines(none.prompts.drafter)).toEqual(nameLines(scenario.prompts.drafter));
    expect(nameLines(none.prompts.drafter)).toEqual(["Jan Kowalski", "Jan Kowalski"]);
  });

  test("the judge measures every run against the voice of the persona, whatever style the drafter got", async () => {
    const none = await runInjection(["--style", "none", "--judge-prompt", "judge-v4"]);
    expect(none.prompts.judge).toHaveLength(2);
    for (const prompt of none.prompts.judge) {
      const block = prompt.slice(
        prompt.indexOf("<<<UNTRUSTED REFERENCE_STYLE"),
        prompt.indexOf("<<<END_UNTRUSTED REFERENCE_STYLE")
      );
      expect(block).toContain(INJECTION_VOICE);
    }
  });

  test("none, a file and the default are three different state files; the default keeps its old name", async () => {
    await runInjection([]);
    await runInjection(["--style", "none"]);
    await runInjection(["--style", styleFile()]);
    expect(stateFiles().sort()).toEqual([
      "gpt-6-luna-low-drafter-v4-drafter-reply-injection-judge-gpt-6.1-terra-judge-v3.jsonl",
      "gpt-6-luna-low-drafter-v4-drafter-reply-injection-style-none-judge-gpt-6.1-terra-judge-v3.jsonl",
      expect.stringMatching(/^gpt-6-luna-low-drafter-v4-drafter-reply-injection-style-stylist-v1-[0-9a-f]{8}-judge-/),
    ]);
  });

  test("two style files of one prompt version with other texts never share a state file", async () => {
    await runInjection(["--style", styleFile()]);
    await runInjection(["--style", styleFile({ text: "Inny styl." }, "other.json")]);
    expect(stateFiles()).toHaveLength(2);
  });

  test("the report names the style key, the file path and the sample count", async () => {
    const file = styleFile();
    await runInjection(["--style", file]);
    expect(stdout).toMatch(/- style: stylist-v1-[0-9a-f]{8}, file .*style\.json, sample count 37/);
  });

  test.each([
    ["checks failed", { checks: { ok: false, failures: ["names_a_person"] } }, "failed its checks (names_a_person)"],
    ["not a style file", { text: 5 }, "has no valid style file shape"],
  ])("a style file that is refused (%s): exit 1, no client, no call", async (_name, overrides, message) => {
    const result = await runInjection(["--style", styleFile(overrides)]);
    expect(result.code).toBe(1);
    expect(result.clients).toBe(0);
    expect(lines.some((line) => line.includes(message))).toBe(true);
    expect(existsSync(join(tmp, "runs"))).toBe(false);
  });

  test("a style file that does not exist: exit 1", async () => {
    const result = await runInjection(["--style", join(tmp, "missing.json")]);
    expect(result.code).toBe(1);
    expect(result.clients).toBe(0);
    expect(lines.some((line) => line.includes("cannot be read as JSON"))).toBe(true);
  });

  test("--style none on a holdout with a judge writes no gate file; the default style does", async () => {
    corpus = await completeCorpus();
    writeJson(join(corpus.dir, "manifest.json"), { version: "1", audit: { status: "pending" } });
    const holdout = async (extra: string[]) => {
      const fake = fakeClient();
      const code = await runDrafterEval(
        parseEvalArgs([
          "--sim",
          "mini",
          "--part",
          "holdout",
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
        ]),
        {
          config,
          createLlmClient: () => fake.client,
          sleep: async () => undefined,
          runsDir: join(tmp, "runs"),
          gateDir: join(tmp, "gate"),
          root: (corpus as MiniCorpus).root,
        }
      );
      return code;
    };
    expect(await holdout(["--style", "none"])).toBe(0);
    expect(existsSync(join(tmp, "gate"))).toBe(false);
    expect(lines.some((line) => line.includes("no gate file: --style is not scenario"))).toBe(true);
    expect(await holdout([])).toBe(0);
    expect(readdirSync(join(tmp, "gate"))).toEqual(["drafter-drafter-v4-gpt-6-luna-low-mini-v1.json"]);
  });
});
