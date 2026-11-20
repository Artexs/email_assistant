import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { barCategories, DAY_MS, DEFAULT_THRESHOLD, GATE_BAR, GATE_MIN_KEPT, MINUTE_MS, UNDO_WINDOW_MS } from "@ea/core";
import { subprocessors } from "@ea/core/web";

import { flaggedTextProblems } from "../src/flagged-text";
import { apiOperations, loadApiSpec, successAnswers } from "../src/api-reference";
import { blocksWithText, geminiClaimProblems, geminiOutsideCondition } from "../src/gemini-text";
import { publicClaims } from "../src/security/claims";
import { publicSubprocessors } from "../src/security/subprocessor-view";

// On the real build (the security page and the two reference pages): the docs build runs into a folder of its own (on the device of the build: Astro renames files into it),
// so `dist` stays as it was. One docs build takes 4 to 15 seconds.
const DOCS = join(import.meta.dir, "..");
const WORK_ROOT = join(DOCS, ".dist-security-test");
setDefaultTimeout(MINUTE_MS);

let html = "";
let plHtml = "";
let api = "";
let evidence = "";

beforeAll(() => {
  mkdirSync(WORK_ROOT, { recursive: true });
  const out = join(mkdtempSync(join(WORK_ROOT, "run-")), "dist");
  // `bun test` sets NODE_ENV=test, and the Starlight bundle then differs (the allow list of the public-content check misses its credits).
  const run = Bun.spawnSync(["bun", "run", "build", "--outDir", out], {
    cwd: DOCS,
    env: { ...process.env, NODE_ENV: "production", DOCS_SHOTS: undefined, EA_DOCS_SHOTS_DIR: undefined },
    timeout: 100_000,
  });
  if (run.exitCode !== 0) throw new Error(`docs build failed:\n${run.stdout.toString()}${run.stderr.toString()}`);
  html = readFileSync(join(out, "security/index.html"), "utf8");
  plHtml = readFileSync(join(out, "pl/security/index.html"), "utf8");
  api = readFileSync(join(out, "reference/api/index.html"), "utf8");
  evidence = readFileSync(join(out, "reference/autonomy-evidence/index.html"), "utf8");
});
afterAll(() => rmSync(WORK_ROOT, { recursive: true, force: true }));

const decode = (text: string): string =>
  text
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const main = (): string => /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "";
const rows = (prefix: string): string[] =>
  [...main().matchAll(new RegExp(`<tr id="${prefix}-[^"]*"[\\s\\S]*?</tr>`, "g"))].map((match) => match[0]);
const cells = (row: string): string[] => [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((match) => match[1] ?? "");

describe("the built /pl/security/ page", () => {
  const plMain = (): string => /<main[\s\S]*<\/main>/.exec(plHtml)?.[0] ?? "";
  const plRows = (prefix: string): string[] =>
    [...plMain().matchAll(new RegExp(`<tr id="${prefix}-[^"]*"[\\s\\S]*?</tr>`, "g"))].map((match) => match[0]);

  test("one claim row for each public claim, in order, with the Polish claim text", () => {
    const claimRows = plRows("claim");
    expect(claimRows.map((row) => /<tr id="claim-([^"]*)"/.exec(row)?.[1])).toEqual(
      publicClaims.map((claim) => claim.id)
    );
    claimRows.forEach((row, index) => {
      expect(decode(cells(row)[0] ?? "")).toBe(publicClaims[index]?.text.pl as string);
    });
  });

  test("one service row for each row of the registry that the page shows, with no placeholder and no English label", () => {
    const shown = publicSubprocessors(subprocessors).map((row) => row.id);
    expect(plRows("subprocessor").map((row) => /<tr id="subprocessor-([^"]*)"/.exec(row)?.[1])).toEqual(shown);
    expect(plHtml).not.toContain("&lt;to confirm");
    expect(plMain()).toContain("Jeszcze niepotwierdzone");
    expect(plMain()).not.toContain("Not confirmed yet");
  });

  test("the checklist links reach claim anchors and the page holds no Gemini text outside its condition", () => {
    const hrefs = [...plMain().matchAll(/href="(#claim-[^"]*)"/g)].map((match) => match[1] ?? "");
    expect(hrefs.length).toBeGreaterThanOrEqual(5);
    for (const href of hrefs) expect(plMain()).toContain(`<tr id="${href.slice(1)}"`);
    expect(/gemini/i.test(plMain())).toBe(false);
  });
});

describe("the built /security/ page", () => {
  test("T5 one claim row for each public claim, in order, with the claim text", () => {
    const claimRows = rows("claim");
    expect(claimRows.map((row) => /<tr id="claim-([^"]*)"/.exec(row)?.[1])).toEqual(
      publicClaims.map((claim) => claim.id)
    );
    claimRows.forEach((row, index) => {
      expect(decode(cells(row)[0] ?? "")).toBe(publicClaims[index]?.text.en as string);
    });
  });

  test("T5 one service row for each row of the registry that the page shows", () => {
    const shown = publicSubprocessors(subprocessors).map((row) => row.id);
    expect(rows("subprocessor").map((row) => /<tr id="subprocessor-([^"]*)"/.exec(row)?.[1])).toEqual(shown);
  });

  test("T5 no placeholder reaches the page, escaped or not", () => {
    expect(html).not.toContain("&lt;to confirm");
    expect(html).not.toContain("<to confirm");
    expect(decode(main())).not.toMatch(/<to confirm|<SMTP|<B2 region/);
    expect(main()).toContain("Not confirmed yet");
  });

  test("T8 the page holds no text about Gemini outside the condition: optional, off by default", () => {
    expect(geminiOutsideCondition(blocksWithText(main()))).toEqual([]);
  });

  test("no config key name reaches the page, and no text of a default-off flag stands outside the service rows", () => {
    const visible = (source: string): string =>
      decode(source.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]*>/g, " "));
    expect(visible(main())).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}\b/);
    // The service rows show the registry as it stands (the open question about flag-gated registry rows, in the plan of the public pages): the consent text of
    // Telegram names "drafts that wait for approval", which is also the heading of a panel page that a flag gates.
    const withoutServices = main().replace(/<tr id="subprocessor-[^"]*"[\s\S]*?<\/tr>/g, " ");
    expect(flaggedTextProblems(visible(withoutServices))).toEqual([]);
  });
});

const mainOf = (html: string): string => /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "";
const visibleOf = (html: string): string =>
  blocksWithText(mainOf(html).replace(/<(script|style)[\s\S]*?<\/\1>/g, " ")).join("\n");
const count = (html: string, needle: string): number => html.split(needle).length - 1;

describe("the built /reference/api/ page", () => {
  const operations = apiOperations(loadApiSpec());

  test("T5 each operationId of the file is on the page once", () => {
    const body = mainOf(api);
    const missing = operations.filter((operation) => count(body, `id="op-${operation.operationId}"`) !== 1);
    expect(missing.map((operation) => operation.operationId)).toEqual([]);
    expect(operations.length).toBeGreaterThan(50);
  });
  test("T5 an operation with two success answers shows both statuses", () => {
    const doubles = operations.filter((operation) => successAnswers(operation).length > 1);
    expect(doubles.length).toBeGreaterThan(0);
    for (const operation of doubles) {
      const start = mainOf(api).indexOf(`id="op-${operation.operationId}"`);
      const section = mainOf(api).slice(start, mainOf(api).indexOf("</section>", start));
      for (const answer of successAnswers(operation)) expect(section).toContain(`<code>${answer.status}</code>`);
    }
  });
  test("T8 no block names Gemini outside the condition: optional, off by default; no claim that it is removed", () => {
    expect(count(api.toLowerCase(), "gemini")).toBe(0);
    expect(geminiOutsideCondition(blocksWithText(mainOf(api)))).toEqual([]);
    expect(geminiClaimProblems(visibleOf(api))).toEqual([]);
  });
  test("the page runs no script of its own and links to the claim on the security page", () => {
    expect(mainOf(api)).not.toContain("<script");
    expect(mainOf(api)).toContain("/security/#claim-private-panel");
    expect(visibleOf(api)).toContain("Some routes answer only while an operator turns a feature on.");
  });
});

describe("the built /reference/autonomy-evidence/ page", () => {
  test("T6 the numbers on the page are the numbers of the code constants", () => {
    const text = visibleOf(evidence);
    expect(text).toContain(`at least ${Math.round(GATE_BAR * 100)} % on at least ${GATE_MIN_KEPT} mails`);
    expect(text).toContain(`limit of confidence is ${DEFAULT_THRESHOLD}`);
    expect(text).toContain(`Auto is off for each of the ${barCategories.length} categories`);
    expect(text).toContain(`undone for ${UNDO_WINDOW_MS / DAY_MS} days`);
  });
  test("the page names no Gemini and makes no claim about the providers of the code", () => {
    expect(count(evidence.toLowerCase(), "gemini")).toBe(0);
    expect(geminiClaimProblems(visibleOf(evidence))).toEqual([]);
  });
});
