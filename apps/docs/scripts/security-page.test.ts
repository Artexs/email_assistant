import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { subprocessors } from "@ea/core/web";

import { flaggedTextProblems } from "../src/flagged-text";
import { publicClaims } from "../src/security/claims";
import { publicSubprocessors } from "../src/security/subprocessor-view";

// On the real build: the docs build runs into a folder of its own (on the device of the build: Astro renames files into it),
// so `dist` stays as it was. One docs build takes 4 to 15 seconds.
const DOCS = join(import.meta.dir, "..");
const WORK_ROOT = join(DOCS, "dist-security-test");
setDefaultTimeout(60_000);

let html = "";
let plHtml = "";

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

// The visible text of each block that can hold a sentence: a table row, a list item or a paragraph.
export function blocksWithText(source: string): string[] {
  return [...source.matchAll(/<(tr|li|p)\b[\s\S]*?<\/\1>/g)].map((match) =>
    decode(match[0].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ")
  );
}

// A block that names Gemini must say that it is optional and off by default.
export function geminiOutsideCondition(blocks: readonly string[]): string[] {
  return blocks.filter((block) => /gemini/i.test(block) && !/optional, off by default/i.test(block));
}

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
    expect(plMain()).toContain("Jeszcze nie potwierdzone");
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

  test("the guard for Gemini text catches a block without the condition and passes one with it", () => {
    expect(geminiOutsideCondition(["Google Gemini API: AI model"])).toEqual(["Google Gemini API: AI model"]);
    expect(geminiOutsideCondition(["Gemini: optional, off by default"])).toEqual([]);
    expect(geminiOutsideCondition(["OpenAI sorts mail"])).toEqual([]);
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
