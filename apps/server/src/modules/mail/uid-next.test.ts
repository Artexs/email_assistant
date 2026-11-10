import { describe, expect, test } from "bun:test";

import { resolveUidNext } from "./uid-next";

describe("resolveUidNext", () => {
  test("a wrong STATUS value of 1 loses against highestUid + 1", () => {
    expect(resolveUidNext({ statusUidNext: 1, selectUidNext: undefined, highestUid: 38964 })).toBe(38965);
  });

  test("no value and an empty folder give 1", () => {
    expect(resolveUidNext({ statusUidNext: undefined, selectUidNext: undefined, highestUid: 0 })).toBe(1);
  });

  test("a larger STATUS value wins", () => {
    expect(resolveUidNext({ statusUidNext: 40000, selectUidNext: undefined, highestUid: 38964 })).toBe(40000);
  });

  test("a value that is not finite is left out", () => {
    expect(resolveUidNext({ statusUidNext: Number.NaN, selectUidNext: 12, highestUid: 3 })).toBe(12);
  });
});
