import { describe, expect, test } from "bun:test";
import ts from "typescript";
import { assignGroups, scanFile, type BodyText, type CaseRow } from "./scan";
import { createAssertingResolver, createScanProgram } from "./scan-program";

const TEST_FILE = "apps/server/src/modules/x/a.test.ts";
const IMPORT = `import { describe, expect, test, it } from "bun:test";\nimport { prod } from "./service";\n`;

function scan(text: string, file = TEST_FILE): { rows: CaseRow[]; bodies: Map<string, BodyText> } {
  const options: ts.CompilerOptions = { noLib: true, types: [], noResolve: true, target: ts.ScriptTarget.ESNext };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, ...rest) =>
    name === file ? ts.createSourceFile(name, text, languageVersion, true) : original(name, languageVersion, ...rest);
  host.fileExists = (name) => name === file;
  const program = createScanProgram([file], options, host);
  return scanFile(file, text, createAssertingResolver(program));
}

function only(text: string, file = TEST_FILE): CaseRow {
  const { rows } = scan(text, file);
  expect(rows).toHaveLength(1);
  return rows[0] as CaseRow;
}

describe("scanSource", () => {
  test("1 counts one expect and its matcher", () => {
    const row = only(`${IMPORT}test("a", () => { expect(1).toBe(1); });`);
    expect(row.expectCalls).toBe(1);
    expect(row.matchers).toEqual(["toBe"]);
    expect(row.flags).toEqual([]);
    expect(row.key).toBe(`${TEST_FILE}:3`);
    expect(row.kind).toBe("unit");
    expect(row.shared).toBe(false);
  });

  test("2 flags a body with no expect as S1", () => {
    expect(only(`${IMPORT}test("b", () => { doThing(); });`).flags).toEqual(["S1"]);
  });

  test("3 flags weak-only matchers as S2 until a strong one joins", () => {
    const weak = `expect(x).toBeDefined(); expect(y).toBeTruthy();`;
    expect(only(`${IMPORT}test("w", () => { ${weak} });`).flags).toEqual(["S2"]);
    expect(only(`${IMPORT}test("w", () => { ${weak} expect(z).toBe(3); });`).flags).toEqual([]);
  });

  test("4 flags mock-only matchers as S3", () => {
    const both = `expect(spy).toHaveBeenCalled(); expect(spy).toHaveBeenCalledTimes(2);`;
    expect(only(`${IMPORT}test("m", () => { ${both} });`).flags).toEqual(["S3"]);
    expect(only(`${IMPORT}test("m", () => { expect(spy).toHaveBeenCalled(); });`).flags).toEqual(["S2", "S3"]);
  });

  test("5 joins nested describe titles", () => {
    const row = only(
      `${IMPORT}describe("d", () => { describe("e", () => { it("f", () => { expect(1).toBe(1); }); }); });`
    );
    expect(row.describePath).toBe("d > e");
    expect(row.name).toBe("f");
  });

  test("6 records the condition of describe.skipIf as S7", () => {
    const row = only(`${IMPORT}describe.skipIf(url === "")("g", () => { test("h", () => { expect(1).toBe(1); }); });`);
    expect(row.skipCondition).toBe(`url === ""`);
    expect(row.flags).toEqual(["S7"]);
  });

  test("7 marks test.each rows and never gives them S6", () => {
    const text = (n: number) => `test.each([[1, 2]])("sum %p ${n}", (a) => { expect(f(${n})).toBe(a); });`;
    const { rows, bodies } = scan(`${IMPORT}${text(1)}\n${text(2)}\n${text(3)}`);
    assignGroups(rows, bodies);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.each && !row.flags.includes("S6"))).toBe(true);
  });

  test("8 groups three same-shape cases of one file as one T group", () => {
    const body = (input: number, output: number) =>
      `test("x${input}", () => { expect(f(${input})).toBe(${output}); });`;
    const { rows, bodies } = scan(`${IMPORT}${body(1, 2)}\n${body(2, 3)}\n${body(5, 6)}`);
    assignGroups(rows, bodies);
    expect(rows.map((row) => row.shapeGroup)).toEqual(["T1", "T1", "T1"]);
    expect(rows.every((row) => row.flags.includes("S6"))).toBe(true);
  });

  test("9 groups identical bodies across files as one B group", () => {
    const text = `${IMPORT}test("same", () => { expect(f(1)).toBe(2); });`;
    const first = scan(text, "packages/core/src/a.test.ts");
    const second = scan(text, "packages/core/src/b.test.ts");
    const rows = [...first.rows, ...second.rows];
    assignGroups(rows, new Map([...first.bodies, ...second.bodies]));
    expect(rows.map((row) => row.bodyGroup)).toEqual(["B1", "B1"]);
    expect(rows.every((row) => row.flags.includes("S5"))).toBe(true);
    expect(rows.some((row) => row.shapeGroup !== "")).toBe(false);
  });

  test("10 counts a local asserting helper as one expect call", () => {
    const row = only(`${IMPORT}function check(v: number) { expect(v).toBe(1); }\ntest("c", () => { check(1); });`);
    expect(row.expectCalls).toBe(1);
    expect(row.flags).toEqual([]);
  });

  test("11 joins the property names after expect() into the matcher", () => {
    const row = only(`${IMPORT}test("r", async () => { await expect(p).rejects.toThrow("x"); });`);
    expect(row.matchers).toEqual(["rejects.toThrow"]);
  });

  test("12 gives the same group ids for the same input", () => {
    const run = () => {
      const a = scan(
        `${IMPORT}test("p", () => { expect(f(1)).toBe(1); });\ntest("q", () => { expect(f(1)).toBe(1); });`
      );
      assignGroups(a.rows, a.bodies);
      return a.rows.map((row) => [row.key, row.bodyGroup, row.shapeGroup, row.flags.join(",")]);
    };
    expect(run()).toEqual(run());
  });

  test("13 flags S8 only for unit and int files with no production import", () => {
    const body = `test("t", () => { expect(1).toBe(1); });`;
    const support = `import { it } from "bun:test";\nimport { make } from "../../test/helpers";\n`;
    expect(only(`${support}${body}`).flags).toEqual(["S8"]);
    expect(only(`${support}import { run } from "./service";\n${body}`).flags).toEqual([]);
    expect(only(`${support}${body}`, "apps/web/e2e/tests/x.spec.ts").flags).toEqual([]);
  });

  test("14 scans a shared suite module only with a bun:test import", () => {
    const suite = `export function suite() { describe("c", () => { test("t", () => { expect(1).toBe(1); }); }); }`;
    const row = only(`${IMPORT}${suite}`, "apps/server/test/contract/mail-provider.ts");
    expect(row.shared).toBe(true);
    expect(row.kind).toBe("int");
    expect(row.key).toBe("apps/server/test/contract/mail-provider.ts:3");
    expect(scan(suite, "apps/server/test/contract/mail-provider.ts").rows).toHaveLength(0);
  });
});
