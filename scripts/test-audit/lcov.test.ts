import { describe, expect, test } from "bun:test";
import { parseLcov, unionHits } from "./lcov";

const REPORT = `TN:
SF:packages/core/src/a.ts
DA:1,3
DA:2,1
DA:3,0
LF:3
LH:2
end_of_record
SF:apps/server/src/b.ts
DA:5,0
LF:1
LH:0
end_of_record
SF:apps/server/src/b.test.ts
DA:1,1
LF:1
LH:1
end_of_record
`;

describe("parseLcov", () => {
  test("1 reads two source files with found, hit and hit lines; a zero count is not a hit; test files are dropped", () => {
    const report = parseLcov(REPORT);
    expect([...report.keys()]).toEqual(["packages/core/src/a.ts", "apps/server/src/b.ts"]);
    expect(report.get("packages/core/src/a.ts")).toEqual({ found: 3, hit: 2, hitLines: new Set([1, 2]) });
    expect(report.get("apps/server/src/b.ts")).toEqual({ found: 1, hit: 0, hitLines: new Set() });
  });
});

describe("unionHits", () => {
  test("1 hit lines {1,2} and {2,3} of one file give {1,2,3}", () => {
    const make = (lines: number[]) =>
      parseLcov(
        `SF:x.ts\n${lines.map((line) => `DA:${line},1`).join("\n")}\nLF:3\nLH:${lines.length}\nend_of_record\n`
      );
    const union = unionHits(make([1, 2]), make([2, 3])).get("x.ts");
    expect(union?.hitLines).toEqual(new Set([1, 2, 3]));
    expect(union?.hit).toBe(3);
  });

  test("2 a file in one report only stays in the union", () => {
    const union = unionHits(parseLcov(REPORT), new Map());
    expect(union.get("packages/core/src/a.ts")?.hit).toBe(2);
  });
});
