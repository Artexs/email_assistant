import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { barCategories, DEFAULT_THRESHOLD, GATE_BAR, GATE_MIN_KEPT, UNDO_WINDOW_MS } from "@ea/core";

import { apiOperations, loadApiSpec, successAnswers } from "../src/api-reference";
import { blocksWithText, geminiClaimProblems, geminiOutsideCondition } from "../src/gemini-text";

// On the real build, like `security-page.test.ts`: the two reference pages as a reader gets them. The docs build runs into a
// folder of its own, so `dist` stays as it was.
const DOCS = join(import.meta.dir, "..");
const WORK_ROOT = join(DOCS, "dist-reference-test");
setDefaultTimeout(60_000);

let api = "";
let evidence = "";

beforeAll(() => {
  mkdirSync(WORK_ROOT, { recursive: true });
  const out = join(mkdtempSync(join(WORK_ROOT, "run-")), "dist");
  const run = Bun.spawnSync(["bun", "run", "build", "--outDir", out], {
    cwd: DOCS,
    env: { ...process.env, NODE_ENV: "production", DOCS_SHOTS: undefined, EA_DOCS_SHOTS_DIR: undefined },
    timeout: 100_000,
  });
  if (run.exitCode !== 0) throw new Error(`docs build failed:\n${run.stdout.toString()}${run.stderr.toString()}`);
  api = readFileSync(join(out, "reference/api/index.html"), "utf8");
  evidence = readFileSync(join(out, "reference/autonomy-evidence/index.html"), "utf8");
});
afterAll(() => rmSync(WORK_ROOT, { recursive: true, force: true }));

const main = (html: string): string => /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "";
const visible = (html: string): string =>
  blocksWithText(main(html).replace(/<(script|style)[\s\S]*?<\/\1>/g, " ")).join("\n");
const count = (html: string, needle: string): number => html.split(needle).length - 1;

describe("the built /reference/api/ page", () => {
  const operations = apiOperations(loadApiSpec());

  test("T5 each operationId of the file is on the page once", () => {
    const body = main(api);
    const missing = operations.filter((operation) => count(body, `id="op-${operation.operationId}"`) !== 1);
    expect(missing.map((operation) => operation.operationId)).toEqual([]);
    expect(operations.length).toBeGreaterThan(50);
  });
  test("T5 an operation with two success answers shows both statuses", () => {
    const doubles = operations.filter((operation) => successAnswers(operation).length > 1);
    expect(doubles.length).toBeGreaterThan(0);
    for (const operation of doubles) {
      const start = main(api).indexOf(`id="op-${operation.operationId}"`);
      const section = main(api).slice(start, main(api).indexOf("</section>", start));
      for (const answer of successAnswers(operation)) expect(section).toContain(`<code>${answer.status}</code>`);
    }
  });
  test("T8 no block names Gemini outside the condition: optional, off by default; no claim that it is removed", () => {
    expect(count(api.toLowerCase(), "gemini")).toBe(0);
    expect(geminiOutsideCondition(blocksWithText(main(api)))).toEqual([]);
    expect(geminiClaimProblems(visible(api))).toEqual([]);
  });
  test("the page runs no script of its own and links to the claim on the security page", () => {
    expect(main(api)).not.toContain("<script");
    expect(main(api)).toContain("/security/#claim-private-panel");
    expect(visible(api)).toContain("Some routes answer only while an operator turns a feature on.");
  });
});

describe("the built /reference/autonomy-evidence/ page", () => {
  test("T6 the numbers on the page are the numbers of the code constants", () => {
    const text = visible(evidence);
    expect(text).toContain(`at least ${Math.round(GATE_BAR * 100)} % on at least ${GATE_MIN_KEPT} mails`);
    expect(text).toContain(`limit of confidence is ${DEFAULT_THRESHOLD}`);
    expect(text).toContain(`Auto is off for each of the ${barCategories.length} categories`);
    expect(text).toContain(`undone for ${UNDO_WINDOW_MS / 86_400_000} days`);
  });
  test("the page names no Gemini and makes no claim about the providers of the code", () => {
    expect(count(evidence.toLowerCase(), "gemini")).toBe(0);
    expect(geminiClaimProblems(visible(evidence))).toEqual([]);
  });
});
