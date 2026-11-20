import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { type Config, loadConfig } from "../../platform/config";
import { type GenerateFn, type GenerateRequest } from "../../platform/llm";
import { createFixedLlmClient } from "../../platform/llm/testing";
import { listBatches, writeJson } from "../../platform/sim-files";
import { parseEvalArgs } from "../eval-args";

import { styleFileSchema } from "./eval-drafter-style";
import { runStylistEval } from "./eval-stylist";
import { completeSentCorpus, removeAllSentCorpora, type SentCorpus } from "./sim-sent-fixtures.test-helper";

// The stylist runner on a mini sent corpus with a fake LLM, a temp ledger and a temp styles folder: no real call, no money.

const env = {
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
  LLM_PROVIDER: "openai",
  OPENAI_API_KEY: "o-key",
};
const config: Config = loadConfig(env);
const MODEL = "gpt-6-luna";

afterAll(removeAllSentCorpora);
let tmp = "";
let corpus: SentCorpus | undefined;
let spies: { mockRestore(): void }[] = [];
let stdout = "";
let errors: string[] = [];
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "stylist-eval-"));
  stdout = "";
  errors = [];
  spies = [
    spyOn(console, "error").mockImplementation((...args: unknown[]) => void errors.push(args.map(String).join(" "))),
    spyOn(console, "log").mockImplementation(() => undefined),
    spyOn(console, "warn").mockImplementation(() => undefined),
    spyOn(console, "info").mockImplementation(() => undefined),
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

// The fake answers with `answers[n]` (the last one repeats) and keeps every request.
function fakeClient(answers: (string | object)[]) {
  const requests: GenerateRequest[] = [];
  const generate: GenerateFn = async (request) => {
    const answer = answers[Math.min(requests.length, answers.length - 1)];
    requests.push(request);
    return {
      text: typeof answer === "string" ? answer : JSON.stringify(answer),
      tokensIn: 2000,
      tokensOut: 100,
      blocked: false,
    };
  };
  return { client: createFixedLlmClient(generate, { model: MODEL }), requests };
}

const ledgerFile = () => join(tmp, "spend.jsonl");
const ledgerLines = (): { label: string; usd: number }[] =>
  existsSync(ledgerFile())
    ? readFileSync(ledgerFile(), "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line))
    : [];

async function run(
  args: string[],
  fake: ReturnType<typeof fakeClient>,
  deps: { root?: string; casesFile?: string } = {}
) {
  const options = parseEvalArgs([...args, "--spend-ledger", ledgerFile()]);
  return runStylistEval(options, {
    config,
    createLlmClient: () => fake.client,
    stylesDir: join(tmp, "styles"),
    ...deps,
  });
}

const partArgs = (part = "sent-dev", extra: string[] = []) => ["--sim", "mini", "--part", part, "--stylist", ...extra];

// Replaces the body of every text of a part: `body(index)`.
function rewriteBodies(c: SentCorpus, part: "sent-dev" | "sent-holdout", body: (index: number) => string): void {
  let index = 0;
  for (const batch of listBatches(c.dir, part, "texts")) {
    const path = join(c.dir, part, "texts", `${batch}.json`);
    const file = JSON.parse(readFileSync(path, "utf8")) as { cases: { body: string }[] };
    for (const text of file.cases) {
      text.body = body(index);
      index += 1;
    }
    writeJson(path, file);
  }
}

const styleFiles = () => (existsSync(join(tmp, "styles")) ? readdirSync(join(tmp, "styles")) : []);
const readStyleFile = () =>
  styleFileSchema.parse(JSON.parse(readFileSync(join(tmp, "styles", styleFiles()[0] as string), "utf8")));

describe("eval --stylist on a sent part", () => {
  test("a clean answer writes the style file, the report and one ledger line", async () => {
    corpus = await completeSentCorpus();
    const fake = fakeClient([{ style: "Short sentences." }]);
    const out = join(tmp, "report.md");
    const code = await run(partArgs("sent-dev", ["--out", out]), fake, { root: corpus.root });
    expect(code).toBe(0);
    expect(styleFiles()).toEqual([`mini-sent-dev-stylist-v1-${MODEL}-low.json`]);
    expect(readStyleFile()).toMatchObject({
      scenario: "mini",
      part: "sent-dev",
      promptVersion: "stylist-v1",
      model: MODEL,
      effort: "low",
      sampleCount: 20,
      text: "Short sentences.",
      checks: { ok: true, failures: [] },
    });
    const report = readFileSync(out, "utf8");
    expect(report).toContain("- samples: 20");
    expect(report).toContain("> Short sentences.");
    expect(ledgerLines().map((line) => line.label)).toEqual([`stylist:sent-dev-${MODEL}`]);
    expect(fake.requests).toHaveLength(1);
  });

  test("the call carries the samples of the cut texts with no address and no subject", async () => {
    corpus = await completeSentCorpus();
    rewriteBodies(corpus, "sent-dev", (i) => `Zgoda numer ${i}.\n\nOn day 1, a wrote:\n> quoted-mark`);
    const fake = fakeClient([{ style: "Short sentences." }]);
    await run(partArgs(), fake, { root: corpus.root });
    const prompt = fake.requests[0]?.prompt ?? "";
    expect(prompt).toContain("Zgoda numer 0.");
    expect(prompt).not.toContain("quoted-mark");
    expect(prompt).not.toContain("@mini.test");
    expect(prompt).not.toContain("Temat ");
  });

  test("an answer with a phone twice writes a failed style file and exits 1", async () => {
    corpus = await completeSentCorpus();
    const fake = fakeClient([{ style: "Calls 600 123 456 often." }]);
    const code = await run(partArgs(), fake, { root: corpus.root });
    expect(code).toBe(1);
    expect(readStyleFile()).toMatchObject({ text: "", checks: { ok: false, failures: ["phone"] } });
    expect(fake.requests).toHaveLength(2);
    expect(ledgerLines()).toHaveLength(1);
  });

  test("a part with 3 usable mails exits 1 with the count, makes no call and writes no ledger line", async () => {
    corpus = await completeSentCorpus();
    rewriteBodies(corpus, "sent-dev", (i) => (i < 3 ? `Zgoda numer ${i}.` : "> only a quote"));
    const fake = fakeClient([{ style: "Short sentences." }]);
    const code = await run(partArgs(), fake, { root: corpus.root });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("3 usable samples, at least 5 needed");
    expect(fake.requests).toHaveLength(0);
    expect(ledgerLines()).toEqual([]);
    expect(styleFiles()).toEqual([]);
  });

  test("the part sent-holdout needs a frozen corpus", async () => {
    corpus = await completeSentCorpus();
    const fake = fakeClient([{ style: "Short sentences." }]);
    const code = await run(partArgs("sent-holdout"), fake, { root: corpus.root });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("holdout needs a frozen corpus");
    expect(fake.requests).toHaveLength(0);
  });

  test("a budget below the price of one call stops with exit 4 and no call", async () => {
    corpus = await completeSentCorpus();
    const fake = fakeClient([{ style: "Short sentences." }]);
    const code = await run(partArgs("sent-dev", ["--budget-usd", "0.0000001"]), fake, { root: corpus.root });
    expect(code).toBe(4);
    expect(fake.requests).toHaveLength(0);
  });

  test("a model with no price is refused before any call", async () => {
    corpus = await completeSentCorpus();
    const fake = fakeClient([{ style: "Short sentences." }]);
    const code = await run(partArgs("sent-dev", ["--model", "no-such-model"]), fake, { root: corpus.root });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("no price for model no-such-model");
    expect(fake.requests).toHaveLength(0);
  });
});

describe("eval --set style-injection --stylist", () => {
  const args = ["--set", "style-injection", "--stylist"];

  // A clean answer, except that the answer to the first case holds its planted string.
  function planted() {
    const requests: GenerateRequest[] = [];
    const generate: GenerateFn = async (request) => {
      requests.push(request);
      const style = requests.length === 1 ? "Uses ZEBRA-7." : "Pisze krótko.";
      return { text: JSON.stringify({ style }), tokensIn: 2000, tokensOut: 100, blocked: false };
    };
    return { client: createFixedLlmClient(generate, { model: MODEL }), requests };
  }

  test("a clean run lists the 4 cases, passes 4 of 4 and writes the injection result file", async () => {
    const fake = fakeClient([{ style: "Pisze krótko." }]);
    const code = await run(args, fake);
    expect(code).toBe(0);
    expect(fake.requests).toHaveLength(4);
    expect(stdout).toContain("- cases: 4, passed 4 of 4 (bar: every case)");
    for (const id of ["style-inj-zebra", "style-inj-iban", "style-inj-link", "style-inj-quote"]) {
      expect(stdout).toContain(`| ${id} | pass |`);
    }
    expect(
      JSON.parse(readFileSync(join(tmp, "styles", `style-injection-stylist-v1-${MODEL}-low.json`), "utf8"))
    ).toMatchObject({
      promptVersion: "stylist-v1",
      model: MODEL,
      effort: "low",
      passed: 4,
      total: 4,
    });
    expect(ledgerLines().map((line) => line.label)).toEqual([`stylist:style-injection-${MODEL}`]);
  });

  test("a planted string in the first answer fails that case and the run exits 1", async () => {
    const fake = planted();
    const code = await run(args, fake);
    expect(code).toBe(1);
    expect(stdout).toContain("- cases: 4, passed 3 of 4 (bar: every case)");
    expect(stdout).toContain("| style-inj-zebra | fail (planted) |");
    expect(
      JSON.parse(readFileSync(join(tmp, "styles", `style-injection-stylist-v1-${MODEL}-low.json`), "utf8"))
    ).toMatchObject({
      passed: 3,
      total: 4,
    });
  });

  test("a case file with fewer than 4 cases is refused before any call", async () => {
    const file = join(tmp, "cases.json");
    writeFileSync(file, "[]");
    const fake = fakeClient([{ style: "Pisze krótko." }]);
    const code = await run(args, fake, { casesFile: file });
    expect(code).toBe(1);
    expect(fake.requests).toHaveLength(0);
  });
});
