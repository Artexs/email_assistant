import { describe, expect, test } from "bun:test";
import {
  groupKeys,
  resolveKey,
  rowsToTsv,
  splitKeys,
  tripleMap,
  underArea,
  type KeyData,
  type ScanCase,
  type Triple,
} from "./cut-keys";

function triple(file: string, name: string, describePath = ""): Triple {
  return { file, describePath, name };
}

function fresh(file: string, line: number, name: string, describePath = ""): ScanCase {
  return { key: `${file}:${line}`, ...triple(file, name, describePath) };
}

function data(parts: {
  reject?: string[];
  approved?: Record<string, Triple>;
  cases?: Record<string, Triple>;
}): KeyData {
  return {
    reject: new Set(parts.reject ?? []),
    approved: new Map(Object.entries(parts.approved ?? {})),
    cases: new Map(Object.entries(parts.cases ?? {})),
  };
}

describe("resolveKey", () => {
  test("a case that moved from line 30 to line 34 is ok with the new key", () => {
    const old = triple("a.test.ts", "adds one", "math");
    const row = resolveKey("a.test.ts:30", data({ cases: { "a.test.ts:30": old } }), [
      fresh("a.test.ts", 34, "adds one", "math"),
      fresh("a.test.ts", 40, "adds two", "math"),
    ]);
    expect(row).toEqual({ oldKey: "a.test.ts:30", newKey: "a.test.ts:34", status: "ok", ...old });
  });

  test("two fresh cases with one triple are deferred-two and none is deferred-none", () => {
    const old = triple("a.test.ts", "adds one");
    const known = data({ cases: { "a.test.ts:30": old } });
    const two = resolveKey("a.test.ts:30", known, [
      fresh("a.test.ts", 5, "adds one"),
      fresh("a.test.ts", 9, "adds one"),
    ]);
    const none = resolveKey("a.test.ts:30", known, [fresh("a.test.ts", 5, "adds two")]);
    expect([two.status, two.newKey, two.name]).toEqual(["deferred-two", "", "adds one"]);
    expect([none.status, none.newKey, none.name]).toEqual(["deferred-none", "", "adds one"]);
  });

  test("a rejected key with no old row and no fresh file is rejected", () => {
    const row = resolveKey("gone.test.ts:43", data({ reject: ["gone.test.ts:43"] }), []);
    expect(row).toEqual({
      oldKey: "gone.test.ts:43",
      newKey: "",
      status: "rejected",
      file: "",
      describePath: "",
      name: "",
    });
  });

  test("the approved-keys triple wins over the cases triple", () => {
    const row = resolveKey(
      "a.test.ts:30",
      data({
        approved: { "a.test.ts:30": triple("a.test.ts", "new name") },
        cases: { "a.test.ts:30": triple("a.test.ts", "old name") },
      }),
      [fresh("a.test.ts", 31, "old name"), fresh("a.test.ts", 36, "new name")]
    );
    expect([row.status, row.newKey, row.name]).toEqual(["ok", "a.test.ts:36", "new name"]);
  });

  test("a key in no source is missing", () => {
    const row = resolveKey("a.test.ts:30", data({}), [fresh("a.test.ts", 30, "adds one")]);
    expect([row.status, row.newKey]).toEqual(["missing", ""]);
  });

  test("a file::name item matches the fresh scan by file and name", () => {
    const row = resolveKey("x.test.ts::a name", data({}), [
      fresh("x.test.ts", 8, "other name"),
      fresh("x.test.ts", 12, "a name", "suite"),
      fresh("y.test.ts", 3, "a name"),
    ]);
    expect(row).toEqual({
      oldKey: "x.test.ts::a name",
      newKey: "x.test.ts:12",
      status: "ok",
      file: "x.test.ts",
      describePath: "",
      name: "a name",
    });
  });
});

describe("key lists", () => {
  test("splitKeys keeps a comma inside a file::name item", () => {
    expect(splitKeys("a.test.ts:3,b.test.ts::one, two and three,c.test.ts:9")).toEqual([
      "a.test.ts:3",
      "b.test.ts::one, two and three",
      "c.test.ts:9",
    ]);
  });

  test("groupKeys reads the keys of one group and rejects an unknown group", () => {
    const text = "group\tkeys\nG01\ta:1,b:2\nG02\tc:3\n";
    expect(groupKeys(text, "G01")).toEqual(["a:1", "b:2"]);
    expect(() => groupKeys(text, "G09")).toThrow("group G09");
  });

  test("underArea keeps keys under the prefix only", () => {
    expect([underArea("packages/core/a.ts:1", "packages/core"), underArea("apps/web/a.ts:1", "packages/core")]).toEqual(
      [true, false]
    );
  });

  test("tripleMap reads the columns of a data file by name", () => {
    const map = tripleMap("key\tfile\tdescribePath\tname\tbase\na.ts:1\ta.ts\tsuite\tdoes it\tabc\n");
    expect(map.get("a.ts:1")).toEqual(triple("a.ts", "does it", "suite"));
  });

  test("rowsToTsv writes the header and one tab row per key", () => {
    const text = rowsToTsv([{ oldKey: "a:1", newKey: "a:2", status: "ok", ...triple("a", "n", "d") }]);
    expect(text).toBe("old_key\tnew_key\tstatus\tfile\tdescribePath\tname\na:1\ta:2\tok\ta\td\tn\n");
  });
});
