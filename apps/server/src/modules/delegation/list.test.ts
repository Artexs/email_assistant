import { describe, expect, test } from "bun:test";

import { decodeDelegationCursor, encodeDelegationCursor } from "./list";

const cursor = { createdAtKey: "2026-11-11T10:00:00.123456Z", id: "6b0e9f0a-5d1c-4c1e-8f53-0d7a3c9a1b22" };

describe("the cursor of the delegation list", () => {
  test("a cursor decodes to what was encoded", () => {
    expect(decodeDelegationCursor(encodeDelegationCursor(cursor))).toEqual(cursor);
  });

  test("text that is no cursor gives null", () => {
    const encode = (text: string) => Buffer.from(text, "utf8").toString("base64url");
    for (const text of [
      "x",
      "%%%",
      encode("no separator"),
      encode(`${cursor.createdAtKey}|${cursor.id}|more`),
      encode(`${cursor.createdAtKey}|not-a-uuid`),
      encode(`2026-11-11T10:00:00Z|${cursor.id}`), // no microseconds
      encode(`2026-02-30T10:00:00.123456Z|${cursor.id}`), // a date that does not exist
      encode(`0000-01-01T10:00:00.123456Z|${cursor.id}`),
    ]) {
      expect([text, decodeDelegationCursor(text)]).toEqual([text, null]);
    }
  });
});
