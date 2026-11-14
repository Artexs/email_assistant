import { describe, expect, test } from "bun:test";

import {
  type Callback,
  encodeCallback,
  type FeedbackCallback,
  isFeedbackCallback,
  isReviewCallback,
  labelCategories,
  parseCallback,
  reviewLabelCategories,
} from "./callback";
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
  [{ kind: "went_out", actionId: ID }, `gw:${ID}`],
  [{ kind: "delegation_done", delegationId: ID }, `dd:${ID}`],
  [{ kind: "mistake", actionId: ID }, `mk:${ID}`],
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

describe("reject reason callback data", () => {
  test.each([
    ["wrong_person", "p"],
    ["wrong_content", "c"],
    ["not_needed", "n"],
  ] as const)("round trip %s", (reason, code) => {
    const callback: Callback = { kind: "reject_reason", reason, actionId: ID };
    const data = encodeCallback(callback);
    expect(data).toBe(`rw:${code}:${ID}`);
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(CALLBACK_MAX_BYTES);
    expect(parseCallback(data)).toEqual(callback);
  });

  test.each([`rw:x:${ID}`, `rw:${ID}`, `rw:p:${ID.toUpperCase()}`, `rw:p:${ID}:x`, "rw:p:not-a-uuid"])(
    "rejects %p",
    (data) => {
      expect(parseCallback(data)).toBeNull();
    }
  );

  test("encode refuses a bad id", () => {
    expect(() => encodeCallback({ kind: "reject_reason", reason: "not_needed", actionId: "x" })).toThrow("bad id");
    expect(() => encodeCallback({ kind: "mistake", actionId: "x" })).toThrow("bad id");
  });
});

const reviewAll: FeedbackCallback[] = [
  ...reviewLabelCategories.flatMap((category): FeedbackCallback[] => [
    { kind: "review_right", category, emailId: ID },
    { kind: "review_pick", category, emailId: ID },
  ]),
  { kind: "review_edit", emailId: ID },
  { kind: "review_cancel", emailId: ID },
];

describe("review callback data", () => {
  test.each(reviewAll)("round trip %o, at most 64 bytes", (callback) => {
    const data = encodeCallback(callback);
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(CALLBACK_MAX_BYTES);
    expect(parseCallback(data)).toEqual(callback);
    expect(isReviewCallback(callback)).toBe(true);
    expect(isFeedbackCallback(callback)).toBe(true);
  });

  test("uses the documented formats", () => {
    expect(encodeCallback({ kind: "review_right", category: "info", emailId: ID })).toBe(`vr:i:${ID}`);
    expect(encodeCallback({ kind: "review_pick", category: "spam", emailId: ID })).toBe(`vc:s:${ID}`);
    expect(encodeCallback({ kind: "review_edit", emailId: ID })).toBe(`ve:${ID}`);
    expect(encodeCallback({ kind: "review_cancel", emailId: ID })).toBe(`vx:${ID}`);
  });

  test("the review prefixes take delegation (d), the digest prefixes do not", () => {
    expect(parseCallback(`vr:d:${ID}`)).toEqual({ kind: "review_right", category: "delegation", emailId: ID });
    expect(parseCallback(`vc:d:${ID}`)).toEqual({ kind: "review_pick", category: "delegation", emailId: ID });
    expect(parseCallback(`fr:d:${ID}`)).toBeNull();
    expect(parseCallback(`fc:d:${ID}`)).toBeNull();
  });

  test.each([`vr:z:${ID}`, `vq:${ID}`, `vr:i:${ID.toUpperCase()}`, `ve:${ID}:x`, `vx:not-a-uuid`])(
    "rejects %p",
    (data) => {
      expect(parseCallback(data)).toBeNull();
    }
  );

  test("only the four review kinds are review callbacks", () => {
    for (const callback of all) expect(isReviewCallback(callback)).toBe(false);
    expect(isReviewCallback({ kind: "approve", actionId: ID })).toBe(false);
  });
});
