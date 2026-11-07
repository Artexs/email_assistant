import { describe, expect, test } from "bun:test";

import { type Callback, encodeCallback, type FeedbackCallback, labelCategories, parseCallback } from "./callback";
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
    expect(() => encodeCallback({ kind: "approve", actionId: "not-a-uuid" })).toThrow("bad id");
  });
});

const approvals: [Callback, string][] = [
  [{ kind: "approve", actionId: ID }, `ap:${ID}`],
  [{ kind: "reject", actionId: ID }, `ar:${ID}`],
  [{ kind: "approve_set", setId: ID }, `as:${ID}`],
  [{ kind: "reject_set", setId: ID }, `rs:${ID}`],
  [{ kind: "send_again", actionId: ID }, `ag:${ID}`],
  [{ kind: "delegation_done", delegationId: ID }, `dd:${ID}`],
];

describe("approval callback data", () => {
  test.each(approvals)("round trip %o", (callback, data) => {
    expect(encodeCallback(callback)).toBe(data);
    expect(Buffer.byteLength(data)).toBe(39);
    expect(parseCallback(data)).toEqual(callback);
  });

  test.each(["ap:not-a-uuid", `ap:${ID.toUpperCase()}`, `ap:${ID}:x`, `xx:${ID}`, `ap:${ID.slice(1)}`])(
    "rejects %p",
    (data) => {
      expect(parseCallback(data)).toBeNull();
    }
  );

  test("the S2 and S3 kinds still parse", () => {
    expect(parseCallback(`fu:${ID}`)).toEqual({ kind: "undo", emailId: ID });
  });
});
