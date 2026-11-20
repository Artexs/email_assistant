import { describe, expect, test } from "bun:test";
import { parseJunit, suitePaths } from "./junit";

const SNIPPET = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="2">
  <testsuite name="a.test.ts" file="a.test.ts" tests="2">
    <testsuite name="outer" file="a.test.ts" line="3" tests="2">
      <testsuite name="inner" file="a.test.ts" line="4" tests="2">
        <testcase name="says &quot;hi&quot; &amp; &#65;&#x42;" classname="outer inner" time="0.5" file="a.test.ts" line="7" assertions="3" />
        <testcase name="waits" classname="outer inner" time="1.25" file="a.test.ts" line="11" assertions="0">
          <skipped />
        </testcase>
      </testsuite>
    </testsuite>
  </testsuite>
</testsuites>
`;

describe("parseJunit", () => {
  test("1 reads two cases with decoded names, line, time and skipped", () => {
    expect(parseJunit(SNIPPET)).toEqual([
      {
        file: "a.test.ts",
        line: 7,
        name: 'says "hi" & AB',
        classname: "outer inner",
        time: 0.5,
        assertions: 3,
        skipped: false,
      },
      {
        file: "a.test.ts",
        line: 11,
        name: "waits",
        classname: "outer inner",
        time: 1.25,
        assertions: 0,
        skipped: true,
      },
    ]);
  });

  test("2 nested testsuite elements do not change the case rows", () => {
    const flat = SNIPPET.replace(/\s*<\/?testsuite\b[^>]*>/g, "");
    expect(parseJunit(flat)).toEqual(parseJunit(SNIPPET));
  });

  test("3 a self-closing case is not skipped even when a later case is", () => {
    const rows = parseJunit(SNIPPET);
    expect(rows.map((row) => row.skipped)).toEqual([false, true]);
  });
});

describe("suitePaths", () => {
  test("1 returns the path tokens after bun test", () => {
    expect(suitePaths("bun test --parallel=4 packages/core apps/server/src")).toEqual([
      "packages/core",
      "apps/server/src",
    ]);
  });

  test("2 the current test:unit script and its F124 form give the same paths", async () => {
    const pkg = (await Bun.file(`${import.meta.dir}/../../package.json`).json()) as { scripts: Record<string, string> };
    const current = pkg.scripts["test:unit"] as string;
    const parallel = current.replace("bun test ", "bun test --parallel=4 ");
    expect(suitePaths(parallel)).toEqual(suitePaths(current));
    expect(suitePaths(current)).toContain("packages/core");
    expect(suitePaths(current).some((token) => token.startsWith("-"))).toBe(false);
  });
});
