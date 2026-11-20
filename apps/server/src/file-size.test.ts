import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";
import { ESLint } from "eslint";

// The size rule of `eslint.config.js` (docs/code-patterns.md § Size and shape): a non-test source file over 400 lines
// warns (`max-lines`), over 800 lines fails (`size/max-lines-hard`). Both count every line, as `wc -l` does.
const repoRoot = path.resolve(import.meta.dir, "../../..");
const eslint = new ESLint({ cwd: repoRoot });
const TIMEOUT = 60_000;

const SOFT = "max-lines";
const HARD = "size/max-lines-hard";
const WARN = 1;
const ERROR = 2;

/** `lines` lines of `export const aK = K;`, each ending in a newline (or the last one without it). */
const linesText = (lines: number, lastNewline = true): string => {
  const text = Array.from({ length: lines }, (_, index) => `export const a${index + 1} = ${index + 1};`).join("\n");
  return lastNewline ? `${text}\n` : text;
};

/** The size messages for `text` linted as the virtual file `file`: rule id and severity. */
async function sizeMessages(file: string, text: string): Promise<{ ruleId: string; severity: number }[]> {
  const [result] = await eslint.lintText(text, { filePath: path.join(repoRoot, file) });
  expect(result?.messages.filter((message) => message.fatal)).toEqual([]);
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === SOFT || message.ruleId === HARD)
    .map((message) => ({ ruleId: message.ruleId as string, severity: message.severity }));
}

const warning = { ruleId: SOFT, severity: WARN };
const failure = { ruleId: HARD, severity: ERROR };

const serverFile = "apps/server/src/__size-fixture.ts";

describe("size rule", () => {
  test(
    "400 lines: no size message",
    async () => {
      expect(await sizeMessages(serverFile, linesText(400))).toEqual([]);
    },
    TIMEOUT
  );

  test(
    "401 lines: one warning, no error",
    async () => {
      expect(await sizeMessages(serverFile, linesText(401))).toEqual([warning]);
    },
    TIMEOUT
  );

  test(
    "800 lines: one warning, no error",
    async () => {
      expect(await sizeMessages(serverFile, linesText(800))).toEqual([warning]);
    },
    TIMEOUT
  );

  test(
    "801 lines: one warning and one error",
    async () => {
      expect(await sizeMessages(serverFile, linesText(801))).toEqual([warning, failure]);
    },
    TIMEOUT
  );

  test(
    "packages/core: 801 lines give a warning and an error",
    async () => {
      expect(await sizeMessages("packages/core/src/__size-fixture.ts", linesText(801))).toEqual([warning, failure]);
    },
    TIMEOUT
  );

  test(
    "apps/web .tsx: 801 lines give a warning and an error",
    async () => {
      expect(await sizeMessages("apps/web/src/lib/__size-fixture.tsx", linesText(801))).toEqual([warning, failure]);
    },
    TIMEOUT
  );

  test(
    "apps/web .astro: 801 lines give a warning and an error",
    async () => {
      const text = `---\n${linesText(797)}---\n<div>text</div>\n<p>text</p>\n`;
      expect(text.split("\n").length - 1).toBe(801);
      expect(await sizeMessages("apps/web/src/components/__size-fixture.astro", text)).toEqual([warning, failure]);
    },
    TIMEOUT
  );

  test(
    "a test file of 801 lines: no size message",
    async () => {
      expect(await sizeMessages("apps/server/src/__size-fixture.test.ts", linesText(801))).toEqual([]);
    },
    TIMEOUT
  );

  test(
    "a file under apps/server/test of 801 lines: no size message",
    async () => {
      expect(await sizeMessages("apps/server/test/integration/__size-fixture.ts", linesText(801))).toEqual([]);
    },
    TIMEOUT
  );

  test(
    "a last line without a newline still counts",
    async () => {
      expect(await sizeMessages(serverFile, linesText(801, false))).toEqual([warning, failure]);
    },
    TIMEOUT
  );

  test(
    "blank lines count",
    async () => {
      const text = `${linesText(501)}${"\n".repeat(300)}`;
      expect(text.split("\n").length - 1).toBe(801);
      expect(await sizeMessages(serverFile, text)).toEqual([warning, failure]);
    },
    TIMEOUT
  );

  test(
    "comment lines count",
    async () => {
      const text = `${linesText(501)}${"// comment\n".repeat(300)}`;
      expect(text.split("\n").length - 1).toBe(801);
      expect(await sizeMessages(serverFile, text)).toEqual([warning, failure]);
    },
    TIMEOUT
  );
});

describe("size exceptions", () => {
  test(
    "no exception list is left: a file that was listed fails over 800 lines like every other",
    async () => {
      expect(existsSync(path.join(repoRoot, "size-exceptions.json"))).toBe(false);
      expect(readFileSync(path.join(repoRoot, "eslint.config.js"), "utf8")).not.toContain("size-exceptions");
      expect(await sizeMessages("apps/server/src/scripts/e2e-seed.ts", linesText(801))).toEqual([warning, failure]);
    },
    TIMEOUT
  );

  test("no source file disables a size rule", () => {
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
      .split("\0")
      .filter((file) => /\.(ts|tsx|astro|js|mjs)$/.test(file))
      .filter((file) => !/\.test\.tsx?$|\.spec\.ts$|\.test-helper\.ts$/.test(file))
      .filter((file) => existsSync(path.join(repoRoot, file)))
      // This file names the rules in its own text.
      .filter((file) => file !== "apps/server/src/file-size.test.ts");
    const disabling = /eslint-disable[^\n]*(max-lines|size\/max-lines-hard)/;
    const found = tracked.filter((file) => disabling.test(readFileSync(path.join(repoRoot, file), "utf8")));
    expect(found).toEqual([]);
  });
});
