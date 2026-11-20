import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareGaps, functionGaps, functionOf, newCaseKills, runCli } from "./mutation-gaps";

describe("functionOf", () => {
  test.each([
    ["function declaration", "function a() { return 1 + 2; }", 1, 25, "a", "a"],
    ["arrow in a variable", "const b = (x: number) => x + 1;", 1, 28, "b", "b"],
    [
      "arrow in an object property",
      'export const texts = { tries: (n: number) => (n === 1 ? "x" : "y") };',
      1,
      49,
      "tries",
      "texts.tries",
    ],
    [
      "method of a class passes over an anonymous callback",
      "class C { m() { return [1].map((v) => v * 2); } }",
      1,
      41,
      "m",
      "C.m",
    ],
    [
      "anonymous callback at module level",
      "export const s = z.object({}).superRefine((v, ctx) => { if (v) ctx.addIssue(1); });",
      1,
      66,
      "(module level)",
      "(module level)",
    ],
    ["initializer at module level", "const LIMIT = 5 > 3 ? 1 : 2;", 1, 15, "(module level)", "(module level)"],
  ])("%s", (_name, source, line, column, fn, id) => {
    expect(functionOf(source, line, column)).toEqual({ fn, id });
  });

  test("two functions with one short name get different chains", () => {
    const source = 'const en = { a: { rejected: (x: string) => x + "1" }, b: { rejected: (x: string) => x + "2" } };';
    expect([functionOf(source, 1, 46), functionOf(source, 1, 91)]).toEqual([
      { fn: "rejected", id: "en.a.rejected" },
      { fn: "rejected", id: "en.b.rejected" },
    ]);
  });
});

interface FixtureMutant {
  id: string;
  status: string;
  line?: number;
  column?: number;
  mutator?: string;
  replacement?: string;
  killedBy?: string[];
}

const mutantOf = (m: FixtureMutant) => ({
  id: m.id,
  mutatorName: m.mutator ?? "ConditionalExpression",
  replacement: m.replacement ?? "true",
  status: m.status,
  location: { start: { line: m.line ?? 1, column: m.column ?? 25 }, end: { line: m.line ?? 1, column: 30 } },
  ...(m.killedBy === undefined ? {} : { killedBy: m.killedBy }),
});

const SOURCE_A = "function a() { return 1 + 2; }\nfunction b() { return 3 + 4; }\n";

const reportOf = (mutants: FixtureMutant[], tests: [string, string][] = [], file = "src/x.ts") => ({
  files: { [file]: { source: SOURCE_A, mutants: mutants.map(mutantOf) } },
  testFiles: {
    "src/x.test.ts": {
      tests: tests.map(([id, name]) => ({ id, name, location: { start: { line: 1, column: 1 } } })),
    },
  },
});

describe("functionGaps", () => {
  test("counts survived and no-coverage mutants of one function and ignores the other statuses", () => {
    const json = reportOf(
      ["Survived", "Survived", "NoCoverage", "Killed", "Timeout"].map((status, i) => ({ id: String(i), status }))
    );
    expect(functionGaps(json)).toEqual([
      { file: "packages/core/src/x.ts", fn: "a", id: "a", survived: 2, noCoverage: 1 },
    ]);
  });

  test("sorts by total, then file and id; the short name groups with --by fn", () => {
    const json = reportOf([
      { id: "1", status: "Survived", line: 1 },
      { id: "2", status: "Survived", line: 2 },
      { id: "3", status: "NoCoverage", line: 2, column: 26 },
    ]);
    expect(functionGaps(json).map((r) => [r.id, r.survived, r.noCoverage])).toEqual([
      ["b", 1, 1],
      ["a", 1, 0],
    ]);
    expect(functionGaps(json, "fn").map((r) => r.fn)).toEqual(["b", "a"]);
  });

  test("a short name used twice in a file becomes the dotted chain, with the start line when that repeats", () => {
    const source =
      "const en = { a: { r: () => 1 + 1 }, b: { r: () => 2 + 2 } };\nconst fr = { a: { r: () => 3 + 3 } };\n";
    const json = {
      files: {
        "src/y.ts": {
          source,
          mutants: [
            mutantOf({ id: "1", status: "Survived", line: 1, column: 31 }),
            mutantOf({ id: "2", status: "Survived", line: 1, column: 55 }),
            mutantOf({ id: "3", status: "Survived", line: 2, column: 31 }),
          ],
        },
      },
    };
    expect(functionGaps(json).map((r) => r.id)).toEqual(["en.a.r", "en.b.r", "fr.a.r"]);
    expect(functionGaps(json, "fn").map((r) => [r.id, r.survived])).toEqual([["r", 3]]);
  });
});

test("a chain that repeats in one file gets the start line", () => {
  const source = "if (a) {\n  function k() { return 1 + 1; }\n} else {\n  function k() { return 2 + 2; }\n}\n";
  const json = {
    files: {
      "src/z.ts": {
        source,
        mutants: [
          mutantOf({ id: "1", status: "Survived", line: 2, column: 29 }),
          mutantOf({ id: "2", status: "Survived", line: 4, column: 29 }),
        ],
      },
    },
  };
  expect(functionGaps(json).map((r) => r.id)).toEqual(["k@2", "k@4"]);
});

describe("compareGaps", () => {
  test("lists each function with its count before and after; a missing side is 0", () => {
    const before = reportOf([
      ...Array.from({ length: 7 }, (_, i) => ({ id: `a${i}`, status: "Survived", line: 1 })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, status: "NoCoverage", line: 2 })),
    ]);
    const after = reportOf(Array.from({ length: 2 }, (_, i) => ({ id: `a${i}`, status: "Survived", line: 1 })));
    const file = "packages/core/src/x.ts";
    expect(compareGaps(before, after)).toEqual([
      { file, id: "a", before: 7, after: 2 },
      { file, id: "b", before: 5, after: 0 },
    ]);
  });
});

describe("newCaseKills", () => {
  const before = reportOf(
    [
      { id: "m1", status: "Survived", line: 1 },
      { id: "m2", status: "Killed", line: 2, killedBy: ["t1"] },
    ],
    [["t1", "x > old"]]
  );
  const after = (killedByNew: string[]) =>
    reportOf(
      [
        { id: "m1", status: "Killed", line: 1, killedBy: killedByNew.includes("m1") ? ["t2"] : ["t1"] },
        { id: "m2", status: "Killed", line: 2, killedBy: killedByNew.includes("m2") ? ["t1", "t2"] : ["t1"] },
      ],
      [
        ["t1", "x > old"],
        ["t2", "x > new"],
      ]
    );

  test("a new case counts only the mutants that survived before", () => {
    expect(newCaseKills(before, after(["m1", "m2"]))).toEqual([
      { file: "packages/core/src/x.test.ts", name: "x > new", kills: 1 },
    ]);
  });

  test("a new case that kills only an already killed mutant has 0 kills", () => {
    expect(newCaseKills(before, after(["m2"]))).toEqual([
      { file: "packages/core/src/x.test.ts", name: "x > new", kills: 0 },
    ]);
  });
});

describe("command line", () => {
  const withFiles = async (reports: Record<string, unknown>, run: (paths: Record<string, string>) => Promise<void>) => {
    const dir = await mkdtemp(join(tmpdir(), "mutation-gaps-"));
    try {
      const paths: Record<string, string> = {};
      for (const [name, json] of Object.entries(reports)) {
        paths[name] = join(dir, `${name}.json`);
        await Bun.write(paths[name] as string, JSON.stringify(json));
      }
      await run(paths);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  const base = reportOf(
    [
      { id: "m1", status: "Survived", line: 1 },
      { id: "m2", status: "Killed", line: 2, killedBy: ["t1"] },
    ],
    [["t1", "x > old"]]
  );
  const tests: [string, string][] = [
    ["t1", "x > old"],
    ["t2", "x > new"],
  ];

  test("exits 1 and names the count when the only new case kills no before-survivor", async () => {
    const next = reportOf(
      [
        { id: "m1", status: "Survived", line: 1 },
        { id: "m2", status: "Killed", line: 2, killedBy: ["t1", "t2"] },
      ],
      tests
    );
    await withFiles({ base, next }, async (p) => {
      const result = await runCli(["--before", p.base as string, "--after", p.next as string]);
      expect(result.code).toBe(1);
      expect(result.out.trimEnd().split("\n").pop()).toBe("1 new case kills no before-survivor");
    });
  });

  test("exits 0 and prints both tables when the new case kills a before-survivor", async () => {
    const next = reportOf(
      [
        { id: "m1", status: "Killed", line: 1, killedBy: ["t2"] },
        { id: "m2", status: "Killed", line: 2, killedBy: ["t1"] },
      ],
      tests
    );
    await withFiles({ base, next }, async (p) => {
      const result = await runCli(["--before", p.base as string, "--after", p.next as string]);
      expect(result.code).toBe(0);
      expect(result.out).toBe(
        [
          "| file | function | before | after |",
          "| --- | --- | --- | --- |",
          "| packages/core/src/x.ts | a | 1 | 0 |",
          "",
          "| test file | case | kills |",
          "| --- | --- | --- |",
          "| packages/core/src/x.test.ts | x > new | 1 |",
          "",
          "0 new cases kill no before-survivor",
          "",
        ].join("\n")
      );
    });
  });

  test("prints the gap table of one report as TSV and keeps only functions with --min mutants", async () => {
    await withFiles({ base }, async (p) => {
      expect((await runCli(["--in", p.base as string, "--min", "1"])).out).toBe(
        "file\tid\tsurvived\tno_coverage\ttotal\npackages/core/src/x.ts\ta\t1\t0\t1\n"
      );
      expect((await runCli(["--in", p.base as string])).out).toBe("file\tid\tsurvived\tno_coverage\ttotal\n");
    });
  });
});
