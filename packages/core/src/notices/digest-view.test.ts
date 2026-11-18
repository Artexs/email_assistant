import { describe, expect, test } from "bun:test";

import { noticeViewSchemas } from "./views";

// The digest view carries the ids of the loops that its brief names: they let the switch-off of Sent tracking and the
// erase of a person find the stored text. Only lower-case UUIDs pass, in the plain form, at most 40.
const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const view = (loopIds: unknown) => ({ text: "x", buttons: [], loopIds });
const parses = (loopIds: unknown) => noticeViewSchemas.digest.safeParse(view(loopIds)).success;

describe("the loopIds of a digest view", () => {
  test("a digest of before the brief has none and still parses; a list of ids parses", () => {
    expect(noticeViewSchemas.digest.safeParse({ text: "x", buttons: [] }).success).toBe(true);
    expect(parses([])).toBe(true);
    expect(parses([ID])).toBe(true);
    expect(parses(Array.from({ length: 40 }, () => ID))).toBe(true);
  });

  test.each([
    ["upper case", ID.toUpperCase()],
    ["braces", `{${ID}}`],
    ["urn prefix", `urn:uuid:${ID}`],
    ["trailing newline", `${ID}\n`],
    ["leading space", ` ${ID}`],
    ["a json path", `$.${ID}`],
    ["a quote", `${ID}"`],
    ["no dashes", ID.replaceAll("-", "")],
    ["a look-alike digit (full-width)", `${ID.slice(0, 8)}-c3d4-7e5f-8a9b-0c1d2e3f4a5ｂ`],
    ["a nul", `${ID.slice(0, 35)}\u0000`],
    ["empty", ""],
  ])("refuses %s", (_name, id) => {
    expect(parses([id])).toBe(false);
  });

  test("refuses more than 40 ids, a non-array and a number in the list", () => {
    expect(parses(Array.from({ length: 41 }, () => ID))).toBe(false);
    expect(parses(ID)).toBe(false);
    expect(parses([1])).toBe(false);
    expect(parses(null)).toBe(false);
  });

  test("the view stays strict: an unknown key is refused", () => {
    expect(noticeViewSchemas.digest.safeParse({ text: "x", buttons: [], loopIds: [], other: 1 }).success).toBe(false);
  });
});
