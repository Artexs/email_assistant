import { describe, expect, test } from "bun:test";
import { joinCases, namePattern, parseStaticTsv, type StaticRow, type TimedCase } from "./join";

function row(file: string, line: number, name: string, extra: Partial<StaticRow> = {}): StaticRow {
  return {
    fields: {},
    key: `${file}:${line}`,
    file,
    line,
    kind: "unit",
    describePath: "",
    name,
    shared: false,
    flags: [],
    ...extra,
  };
}

function junit(file: string, line: number, name: string, extra: Partial<TimedCase> = {}): TimedCase {
  return { file, line, name, classname: "", time: 0.1, assertions: 1, skipped: false, suite: "unit", ...extra };
}

describe("joinCases", () => {
  test("1 two JUnit rows on one scan line give junit_count 2 and the summed time and assertions", () => {
    const result = joinCases(
      [row("a.test.ts", 5, "each ${x}")],
      [
        junit("a.test.ts", 5, "each 1", { time: 0.25, assertions: 2 }),
        junit("a.test.ts", 5, "each 2", { time: 0.5, assertions: 3 }),
      ]
    );
    const [only] = result.rows;
    expect(only?.junitCount).toBe(2);
    expect(only?.timeS).toBeCloseTo(0.75);
    expect(only?.assertions).toBe(5);
    expect(only?.outFlags).toEqual([]);
  });

  test("2 a JUnit case with no scan row is unscanned; a scan row with no JUnit case is not-run", () => {
    const result = joinCases([row("a.test.ts", 5, "scanned")], [junit("b.test.ts", 9, "lonely")]);
    expect(result.cases.map((item) => item.key)).toEqual(["unscanned"]);
    expect(result.rows[0]?.outFlags).toEqual(["not-run"]);
  });

  test("3 a scan row at the same line with another name is not joined", () => {
    const result = joinCases([row("a.test.ts", 5, "one name")], [junit("a.test.ts", 5, "another name")]);
    expect(result.cases[0]?.key).toBe("unscanned");
    expect(result.rows[0]?.junitCount).toBe(0);
  });

  test("4 S9 comes from one case at 1 s (unit) or 2 s (int)", () => {
    const unit = joinCases([row("a.test.ts", 1, "a")], [junit("a.test.ts", 1, "a", { time: 1 })]);
    expect(unit.rows[0]?.outFlags).toContain("S9");
    const fastInt = joinCases(
      [row("i.test.ts", 1, "i", { kind: "int" })],
      [junit("i.test.ts", 1, "i", { time: 1.5, suite: "int" })]
    );
    expect(fastInt.rows[0]?.outFlags).toEqual([]);
    const slowInt = joinCases(
      [row("i.test.ts", 1, "i", { kind: "int" })],
      [junit("i.test.ts", 1, "i", { time: 2, suite: "int" })]
    );
    expect(slowInt.rows[0]?.outFlags).toEqual(["S9"]);
  });

  test("5 two cases of 0.6 s on one row are not S9: the flag needs one slow case", () => {
    const result = joinCases(
      [row("a.test.ts", 1, "x ${n}")],
      [junit("a.test.ts", 1, "x 1", { time: 0.6 }), junit("a.test.ts", 1, "x 2", { time: 0.6 })]
    );
    expect(result.rows[0]?.timeS).toBeCloseTo(1.2);
    expect(result.rows[0]?.outFlags).toEqual([]);
  });
});

describe("joinCases with shared rows", () => {
  const shared = row("contract.ts", 12, "refuses ${x}", { shared: true, kind: "int" });

  test("1 runner cases of two files at the module line join to the shared row", () => {
    const result = joinCases(
      [shared],
      [
        junit("a.test.ts", 12, "refuses login", { suite: "int" }),
        junit("b.test.ts", 12, "refuses login", { suite: "int" }),
      ]
    );
    expect(result.rows[0]?.junitCount).toBe(2);
    expect(result.cases.map((item) => item.key)).toEqual(["contract.ts:12", "contract.ts:12"]);
  });

  test("2 a runner row at the same line with another name keeps only its own case", () => {
    const own = row("a.test.ts", 12, "its own case", { kind: "int" });
    const result = joinCases(
      [own, shared],
      [
        junit("a.test.ts", 12, "its own case", { suite: "int" }),
        junit("a.test.ts", 12, "refuses login", { suite: "int" }),
        junit("b.test.ts", 12, "refuses login", { suite: "int" }),
      ]
    );
    const byKey = Object.fromEntries(result.rows.map((one) => [one.key, one.junitCount]));
    expect(byKey).toEqual({ "a.test.ts:12": 1, "contract.ts:12": 2 });
  });

  test("3 the describe path must end the path of the case (the classname lists the inner describe first)", () => {
    const suite = row("contract.ts", 12, "refuses ${x}", {
      shared: true,
      kind: "int",
      describePath: "Contract: ${name}",
    });
    const other = row("other.ts", 12, "refuses ${x}", { shared: true, kind: "int", describePath: "Other: ${name}" });
    const result = joinCases(
      [suite, other],
      [junit("a.test.ts", 12, "refuses login", { classname: "Contract: fake > runner describe", suite: "int" })]
    );
    expect(result.cases[0]?.key).toBe("contract.ts:12");
  });

  test("4 two shared rows that both match are unscanned with the reason ambiguous", () => {
    const twin = row("twin.ts", 12, "refuses ${x}", { shared: true, kind: "int" });
    const result = joinCases([shared, twin], [junit("a.test.ts", 12, "refuses login", { suite: "int" })]);
    expect(result.cases[0]).toMatchObject({ key: "unscanned", reason: "ambiguous" });
  });
});

describe("namePattern", () => {
  test("1 wildcards for template parts, printf marks and each variables; the rest is literal", () => {
    expect(namePattern("a ${x.y} (b) %s $name").test("a 1 (b) 2 3")).toBe(true);
    expect(namePattern("a (b)").test("a b")).toBe(false);
    expect(namePattern("${a + `${b}`} end").test("1 end")).toBe(true);
  });
});

describe("parseStaticTsv", () => {
  test("1 reads columns by header name", () => {
    const [first] = parseStaticTsv(
      "key\tfile\tline\tkind\tdescribePath\tname\tflags\tshared\nk\tf\t3\tunit\t\tn\tS1,S2\ttrue\n"
    );
    expect(first).toMatchObject({ key: "k", file: "f", line: 3, flags: ["S1", "S2"], shared: true });
  });
});
