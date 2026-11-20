import { describe, expect, test } from "bun:test";
import {
  caseKills,
  compareRuns,
  fileScores,
  greedyCover,
  joinKey,
  readReport,
  survivedTsv,
  testsTsv,
  UNJOINED,
  type JunitKeyRow,
} from "./mutation-summary";

const mutant = (id: string, status: string, killedBy?: string[], line = 1) => ({
  id,
  mutatorName: "ConditionalExpression",
  replacement: "false",
  status,
  location: { start: { line, column: 3 }, end: { line, column: 9 } },
  ...(killedBy === undefined ? {} : { killedBy }),
});

const testEntry = (id: string, name: string, line: number) => ({ id, name, location: { start: { line, column: 1 } } });

const report = {
  files: {
    "src/a.ts": {
      mutants: [mutant("m1", "Killed", ["t1"]), mutant("m2", "Killed", ["t1", "t2"]), mutant("m3", "Survived")],
    },
  },
  testFiles: {
    "src/a.test.ts": {
      tests: [
        testEntry("t1", "src/a.test.ts > a > one", 5),
        testEntry("t2", "src/a.test.ts > a > two", 9),
        testEntry("t3", "src/a.test.ts > a > three", 13),
      ],
    },
  },
};

describe("caseKills", () => {
  test("1 three mutants and three tests give kills 2/1/0, unique kills 1/0/0 and the cover {t1}", () => {
    const kills = caseKills(readReport(report));
    expect(kills.map((k) => [k.testId, k.kills, k.uniqueKills, k.inCover])).toEqual([
      ["t1", 2, 1, true],
      ["t2", 1, 0, false],
      ["t3", 0, 0, false],
    ]);
    expect(kills[0]?.file).toBe("packages/core/src/a.test.ts");
  });

  test("2 a Survived mutant has no killedBy and counts in no kill set", () => {
    const withBy = {
      files: { "src/a.ts": { mutants: [mutant("m3", "Survived", ["t3"])] } },
      testFiles: report.testFiles,
    };
    const kills = caseKills(readReport(withBy));
    expect(kills.map((k) => k.kills)).toEqual([0, 0, 0]);
    expect(readReport(report).mutants[2]?.killedBy).toEqual([]);
  });

  test("3 two calls with the same input give the same cover, ties go to the lower test id", () => {
    const sets = new Map([
      ["b", new Set(["1", "2"])],
      ["a", new Set(["1", "2"])],
      ["c", new Set(["3"])],
    ]);
    expect([...greedyCover(sets)]).toEqual(["a", "c"]);
    expect([...greedyCover(sets)]).toEqual([...greedyCover(sets)]);
  });
});

describe("joinKey", () => {
  const rows: JunitKeyRow[] = [
    { file: "packages/core/src/a.test.ts", line: 4, name: "one", key: "packages/core/src/a.test.ts:4" },
    { file: "packages/core/src/a.test.ts", line: 20, name: "one", key: "packages/core/src/a.test.ts:20" },
    { file: "packages/core/src/a.test.ts", line: 9, name: "x > y", key: "packages/core/src/a.test.ts:9" },
  ];
  const test_ = (name: string, line: number) => ({ file: "packages/core/src/a.test.ts", line, name });

  test("4 the same file, the name ending the Stryker name and the nearest line decide", () => {
    expect(joinKey(test_("src/a.test.ts > a > one", 5), rows)).toBe("packages/core/src/a.test.ts:4");
    expect(joinKey(test_("src/a.test.ts > b > one", 21), rows)).toBe("packages/core/src/a.test.ts:20");
    expect(joinKey(test_("src/a.test.ts > a > x > y", 10), rows)).toBe("packages/core/src/a.test.ts:9");
  });

  test("4b Stryker's [n] suffix on a repeated each name is dropped when the full name has no row", () => {
    expect(joinKey(test_("src/a.test.ts > a > one [2]", 5), rows)).toBe("packages/core/src/a.test.ts:4");
  });

  test("5 a test with no JUnit row of that file and name is unjoined and counted", () => {
    expect(joinKey(test_("src/a.test.ts > a > other", 5), rows)).toBe(UNJOINED);
    const out = testsTsv(caseKills(readReport(report)), rows);
    expect(out.unjoined).toBe(2);
    const lines = out.tsv.split("\n");
    expect(lines[1]).toBe(
      [
        "packages/core/src/a.test.ts:4",
        "packages/core/src/a.test.ts",
        5,
        "src/a.test.ts > a > one",
        2,
        1,
        true,
        "",
      ].join("\t")
    );
    expect(lines[3]).toBe(
      ["unjoined", "packages/core/src/a.test.ts", 13, "src/a.test.ts > a > three", 0, 0, false, "S11"].join("\t")
    );
    expect(lines[2]?.endsWith("\tS10")).toBe(true);
  });
});

describe("files and survived", () => {
  test("6 the file score counts killed and timeout over killed, timeout, survived and no coverage", () => {
    const mutants = readReport({
      files: {
        "src/a.ts": {
          mutants: [
            mutant("1", "Killed", ["t1"]),
            mutant("2", "Timeout"),
            mutant("3", "Survived"),
            mutant("4", "NoCoverage"),
            mutant("5", "RuntimeError"),
          ],
        },
      },
    }).mutants;
    const [score] = fileScores(mutants);
    expect([score?.mutants, score?.killed, score?.timeout, score?.survived, score?.noCoverage, score?.errors]).toEqual([
      5, 1, 1, 1, 1, 1,
    ]);
    expect(score?.score).toBe(50);
    expect(survivedTsv(mutants).trimEnd().split("\n")).toHaveLength(3);
  });
});

describe("compareRuns", () => {
  test("7 the same mutants with one flipped status and one missing mutant give two differences", () => {
    const one = readReport({
      files: {
        "src/a.ts": {
          mutants: [
            mutant("1", "Killed", ["t1"], 1),
            mutant("2", "Timeout", undefined, 2),
            mutant("3", "Survived", undefined, 3),
          ],
        },
      },
    }).mutants;
    const two = readReport({
      files: { "src/a.ts": { mutants: [mutant("1", "Killed", ["t1"], 1), mutant("2", "Killed", ["t1"], 2)] } },
    }).mutants;
    const result = compareRuns(one, two);
    expect([result.first, result.second]).toEqual([3, 2]);
    expect(result.differences.map((d) => [d.first, d.second])).toEqual([
      ["Timeout", "Killed"],
      ["Survived", "absent"],
    ]);
    expect(compareRuns(one, one).differences).toEqual([]);
  });

  test("8 two mutants that start at one place and end at two others are compared one by one", () => {
    const at = (id: string, status: string, endColumn: number) => ({
      ...mutant(id, status, status === "Killed" ? ["t1"] : undefined),
      location: { start: { line: 4, column: 7 }, end: { line: 4, column: endColumn } },
    });
    const one = readReport({ files: { "src/a.ts": { mutants: [at("1", "Survived", 12), at("2", "Killed", 30)] } } });
    const two = readReport({ files: { "src/a.ts": { mutants: [at("2", "Killed", 30), at("1", "Survived", 12)] } } });
    expect(compareRuns(one.mutants, two.mutants).differences).toEqual([]);
  });
});
