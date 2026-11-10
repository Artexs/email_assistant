import { describe, expect, test } from "bun:test";

import { compareInboxWithDb } from "./audit";

const a = { messageId: "<a@x.test>", hash: "h1" };
const b = { messageId: "<b@x.test>", hash: "h2" };

describe("compareInboxWithDb", () => {
  test("equal sets have no missing and no duplicate", () => {
    expect(compareInboxWithDb([a, b], [b, a])).toEqual({ inbox: 2, stored: 2, missing: 0, duplicates: 0 });
  });

  test("an inbox mail without a row is missing", () => {
    expect(compareInboxWithDb([a, b], [a])).toEqual({ inbox: 2, stored: 1, missing: 1, duplicates: 0 });
  });

  test("two rows for one inbox mail are one duplicate", () => {
    expect(compareInboxWithDb([a], [a, a])).toEqual({ inbox: 1, stored: 2, missing: 0, duplicates: 1 });
  });

  test("two identical inbox copies with two rows are fine", () => {
    expect(compareInboxWithDb([a, a], [a, a])).toEqual({ inbox: 2, stored: 2, missing: 0, duplicates: 0 });
  });

  test("a null Message-ID is a key of its own, and the same id with another hash differs", () => {
    const noId = { messageId: null, hash: "h1" };
    expect(compareInboxWithDb([noId], [a])).toEqual({ inbox: 1, stored: 1, missing: 1, duplicates: 1 });
    expect(compareInboxWithDb([a], [{ ...a, hash: "h9" }])).toEqual({ inbox: 1, stored: 1, missing: 1, duplicates: 1 });
  });
});
