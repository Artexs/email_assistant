import { describe, expect, test } from "bun:test";
import { checkCounts, checkLines, checkMutants, junitSeconds, parseExpect, type Coverage } from "./cut-proof";
import type { MutantRow } from "./mutation-summary";

const cov = (files: Record<string, number[]>): Coverage =>
  new Map(
    Object.entries(files).map(([file, lines]) => [file, { found: 10, hit: lines.length, hitLines: new Set(lines) }])
  );

describe("case counts", () => {
  const before = [{ unit: 10, int: 5 }];

  test("the expected delta of both lanes passes", () => {
    expect(checkCounts(before, { unit: 16, int: 4 }, parseExpect("unit=+6,int=-1"))).toEqual([]);
  });

  test("a wrong delta names the lane, the expected and the real change", () => {
    expect(checkCounts(before, { unit: 16, int: 4 }, parseExpect("unit=+5,int=-1"))).toEqual([
      "unit: expected +5, got +6",
    ]);
  });

  test("a lane that is not named must not change", () => {
    expect(checkCounts(before, { unit: 16, int: 4 }, parseExpect("unit=+6"))).toEqual(["int: expected +0, got -1"]);
  });

  test("a lane with no file before counts as 0 cases", () => {
    expect(checkCounts([{ unit: 0, int: 5 }], { unit: 6, int: 5 }, parseExpect("unit=+6"))).toEqual([]);
  });
});

describe("covered lines", () => {
  test("a line hit in both before runs and unhit after fails with file and line", () => {
    const run = cov({ "a.ts": [1, 2, 3] });
    expect(checkLines([run, run], cov({ "a.ts": [1, 2] }), new Set())).toEqual(["a.ts line 3"]);
  });

  test("a line hit in one before run only is noise", () => {
    const failures = checkLines(
      [cov({ "a.ts": [1, 2, 3] }), cov({ "a.ts": [1, 2] })],
      cov({ "a.ts": [1, 2] }),
      new Set()
    );
    expect(failures).toEqual([]);
  });

  test("a file of the noise list and a helper under apps/server/test are not checked", () => {
    const run = cov({ "a.ts": [1, 2], "apps/server/test/h.ts": [1] });
    expect(checkLines([run], cov({ "a.ts": [], "apps/server/test/h.ts": [] }), new Set(["a.ts"]))).toEqual([]);
  });

  test("a source file that is missing after loses all its lines", () => {
    expect(checkLines([cov({ "a.ts": [4, 5] })], cov({}), new Set())).toEqual(["a.ts line 4", "a.ts line 5"]);
  });
});

describe("mutants", () => {
  const mutant = (status: string, file = "packages/core/src/x.ts", line = 4, column = 2): MutantRow => ({
    file,
    line,
    column,
    mutator: "ConditionalExpression",
    replacement: "true",
    status,
    killedBy: [],
  });

  test("Killed before and Survived after fails", () => {
    const result = checkMutants([[mutant("Killed")]], [mutant("Survived")], new Set());
    expect(result.failures).toEqual(["packages/core/src/x.ts:4:2 ConditionalExpression true: Killed -> Survived"]);
  });

  test("Killed before and NoCoverage after fails", () => {
    expect(checkMutants([[mutant("Killed")]], [mutant("NoCoverage")], new Set()).failures).toHaveLength(1);
  });

  test("Killed before and Timeout after passes", () => {
    expect(checkMutants([[mutant("Killed")]], [mutant("Timeout")], new Set()).failures).toEqual([]);
  });

  test("a place of the unstable list is not checked", () => {
    const unstable = new Set(["packages/core/src/x.ts:4:2"]);
    expect(checkMutants([[mutant("Killed")]], [mutant("Survived")], unstable).failures).toEqual([]);
  });

  test("a mutant that is killed in one before run only is noise", () => {
    expect(checkMutants([[mutant("Killed")], [mutant("Survived")]], [mutant("Survived")], new Set()).failures).toEqual(
      []
    );
  });

  test("a mutant on one side only is listed and does not fail", () => {
    const result = checkMutants([[mutant("Killed")]], [mutant("Killed", "packages/core/src/x.ts", 5)], new Set());
    expect(result.failures).toEqual([]);
    expect(result.oneSided).toEqual([
      "packages/core/src/x.ts:4:2 ConditionalExpression true (Killed -> absent)",
      "packages/core/src/x.ts:5:2 ConditionalExpression true (absent -> Killed)",
    ]);
  });
});

describe("serial time", () => {
  test("the time is the time of the root testsuites element", () => {
    const xml = '<testsuites name="bun test" tests="2" time="12.5">\n<testsuite name="a" time="3">';
    expect(junitSeconds(xml)).toBe(12.5);
  });

  test("an XML with no root time gives null", () => {
    expect(junitSeconds("<testsuite name='a' time='3'>")).toBeNull();
  });
});
