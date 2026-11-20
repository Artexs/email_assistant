import { describe, expect, test } from "bun:test";

import { compareHunk, parseDiff, timeValuesOf } from "./time-rewrite-check";
import { importLines } from "./time-rewrite-check-values";

describe("timeValuesOf", () => {
  test("C1 a chain of literals is one value", () => {
    expect(timeValuesOf("const a = 7 * 24 * 3_600_000;")).toEqual([604_800_000]);
  });
  test("C2 a division by a time literal counts the literal", () => {
    expect(timeValuesOf("x = ms / 60_000 + 1;")).toEqual([60_000]);
  });
  test("C3 a unit name inside parentheses", () => {
    expect(timeValuesOf("t(Math.floor(ms / (24 * HOUR)));")).toEqual([86_400_000]);
  });
  test("C4 an identifier ends the run", () => {
    expect(timeValuesOf("const a = PENDING_DAYS * DAY_MS;")).toEqual([86_400_000]);
  });
  test("C5 seconds and small numbers do not count", () => {
    expect(timeValuesOf("Math.max(1, 30 * 1000)")).toEqual([]);
  });
  test("a comment and a string are not read", () => {
    expect(timeValuesOf('const a = "60_000"; // 5 * MINUTE_MS')).toEqual([]);
  });
  test("60 and 1000 in a chain are a minute", () => {
    expect(timeValuesOf("const a = 1.5 * 60 * 1000;")).toEqual([90_000]);
  });
});

describe("compareHunk", () => {
  test("C6 the same value in another unit is equal", () => {
    expect(compareHunk(["a = 48 * 3_600_000;"], ["a = 2 * DAY_MS;"])).toBeNull();
  });
  test("C7 a changed factor is a mismatch", () => {
    expect(compareHunk(["a = 48 * 3_600_000;"], ["a = 48 * DAY_MS;"])).toEqual({
      removed: [172_800_000],
      added: [4_147_200_000],
    });
  });
  test("C8 a copy with the core value goes away", () => {
    expect(compareHunk(["const MINUTE = 60_000;", "x = 5 * MINUTE;"], ["x = 5 * MINUTE_MS;"])).toBeNull();
  });
  test("C9 a copy with a wrong value is a mismatch", () => {
    expect(compareHunk(["const HOUR = 60 * 60;"], [])).not.toBeNull();
  });
  test("C10 a comment is ignored", () => {
    expect(compareHunk(["a = 60_000; // 1 min"], ["a = MINUTE_MS; // 1 min"])).toBeNull();
  });
  test("a block comment line holds no value", () => {
    expect(compareHunk([" * one day is 24 * 3_600_000"], ["/** MINUTE_MS */"])).toBeNull();
  });
});

describe("importLines", () => {
  test("marks single and multi line imports and re-exports", () => {
    const source = [
      'import { A } from "a";',
      "import {",
      "  DAY_MS,",
      '} from "@ea/core";',
      "const x = 1;",
      'export * from "./y";',
    ].join("\n");
    expect([...importLines(source)]).toEqual([1, 2, 3, 4, 6]);
  });
});

describe("parseDiff", () => {
  const diff = [
    "diff --git a/apps/server/src/a.ts b/apps/server/src/a.ts",
    "--- a/apps/server/src/a.ts",
    "+++ b/apps/server/src/a.ts",
    "@@ -10,2 +10 @@ ctx",
    "-const a = 1;",
    "-const b = 60_000;",
    "+const b = MINUTE_MS;",
    "diff --git a/apps/web/src/b.md b/apps/web/src/b.md",
    "--- a/apps/web/src/b.md",
    "+++ b/apps/web/src/b.md",
    "@@ -1 +1 @@",
    "-60_000",
    "+MINUTE_MS",
  ].join("\n");
  test("numbers each line and skips files that are not source", () => {
    const hunks = parseDiff(diff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.removed).toEqual([
      { line: 10, text: "const a = 1;" },
      { line: 11, text: "const b = 60_000;" },
    ]);
    expect(hunks[0]?.added).toEqual([{ line: 10, text: "const b = MINUTE_MS;" }]);
    expect(hunks[0]?.newStart).toBe(10);
  });
});
