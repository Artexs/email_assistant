import { describe, expect, test } from "bun:test";

import { encodeCallback, type FeedbackCallback, labelCategories, parseCallback } from "./callback";
import { CALLBACK_MAX_BYTES } from "./message";

const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

const all: FeedbackCallback[] = [
  ...labelCategories.flatMap((category): FeedbackCallback[] => [
    { kind: "right", category, emailId: ID },
    { kind: "pick", category, emailId: ID },
  ]),
  { kind: "edit", emailId: ID },
  { kind: "cancel", emailId: ID },
  { kind: "undo", emailId: ID },
];

describe("callback data", () => {
  test.each(all)("round trip %o", (callback) => {
    const data = encodeCallback(callback);
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(CALLBACK_MAX_BYTES);
    expect(parseCallback(data)).toEqual(callback);
  });

  test("uses the documented formats", () => {
    expect(encodeCallback({ kind: "right", category: "urgent", emailId: ID })).toBe(`fr:u:${ID}`);
    expect(encodeCallback({ kind: "edit", emailId: ID })).toBe(`fe:${ID}`);
    const undo = encodeCallback({ kind: "undo", emailId: ID });
    expect(undo).toBe(`fu:${ID}`);
    expect(Buffer.byteLength(undo)).toBe(39);
  });

  test.each(["", `fr:x:${ID}`, `fr:u:${ID.toUpperCase()}`, `fe:${ID}:x`, `zz:${ID}`, "fu:not-a-uuid"])(
    "rejects %p",
    (data) => {
      expect(parseCallback(data)).toBeNull();
    }
  );

  test("encode refuses a bad id", () => {
    expect(() => encodeCallback({ kind: "edit", emailId: "not-a-uuid" })).toThrow("bad email id");
  });
});
