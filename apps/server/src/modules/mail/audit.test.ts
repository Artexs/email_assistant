import { describe, expect, test } from "bun:test";

import { auditExitCode, compareFolderWithDb, compareInboxWithDb } from "./audit";

const a = { messageId: "<a@x.test>", hash: "h1" };
const b = { messageId: "<b@x.test>", hash: "h2" };

describe("compareInboxWithDb", () => {
  test("equal sets have no missing and no duplicate", () => {
    expect(compareInboxWithDb([a, b], [b, a])).toEqual({ mail: 2, stored: 2, missing: 0, duplicates: 0, cross: 0 });
  });

  test("an inbox mail without a row is missing", () => {
    expect(compareInboxWithDb([a, b], [a])).toEqual({ mail: 2, stored: 1, missing: 1, duplicates: 0, cross: 0 });
  });

  test("two rows for one inbox mail are one duplicate", () => {
    expect(compareInboxWithDb([a], [a, a])).toEqual({ mail: 1, stored: 2, missing: 0, duplicates: 1, cross: 0 });
  });

  test("two identical inbox copies with two rows are fine", () => {
    expect(compareInboxWithDb([a, a], [a, a])).toEqual({ mail: 2, stored: 2, missing: 0, duplicates: 0, cross: 0 });
  });

  test("a null Message-ID is a key of its own, and the same id with another hash differs", () => {
    const noId = { messageId: null, hash: "h1" };
    expect(compareInboxWithDb([noId], [a])).toEqual({ mail: 1, stored: 1, missing: 1, duplicates: 1, cross: 0 });
    expect(compareInboxWithDb([a], [{ ...a, hash: "h9" }])).toEqual({
      mail: 1,
      stored: 1,
      missing: 1,
      duplicates: 1,
      cross: 0,
    });
  });
});

describe("compareFolderWithDb", () => {
  test("a mail with a row only in another synced folder is cross, not missing", () => {
    expect(compareFolderWithDb([a, b], [b], [a])).toEqual({ mail: 2, stored: 1, missing: 0, duplicates: 0, cross: 1 });
  });

  test("a mail with no row anywhere is missing", () => {
    expect(compareFolderWithDb([a], [], [b])).toEqual({ mail: 1, stored: 0, missing: 1, duplicates: 0, cross: 0 });
  });

  test("one row elsewhere covers one missing copy only", () => {
    expect(compareFolderWithDb([a, a], [], [a])).toEqual({ mail: 2, stored: 0, missing: 1, duplicates: 0, cross: 1 });
  });
});

describe("auditExitCode", () => {
  const clean = { mail: 1, stored: 1, missing: 0, duplicates: 0, cross: 0 };

  test("0 for a clean INBOX, and when cross is set", () => {
    expect(auditExitCode(clean)).toBe(0);
    expect(auditExitCode({ ...clean, cross: 3 })).toBe(0);
  });

  test("2 for a missing or a duplicate INBOX mail", () => {
    expect(auditExitCode({ ...clean, missing: 1 })).toBe(2);
    expect(auditExitCode({ ...clean, duplicates: 1 })).toBe(2);
  });

  test("1 when the INBOX counts are null or missing (the server does not list INBOX)", () => {
    expect(auditExitCode(null)).toBe(1);
    expect(auditExitCode(undefined)).toBe(1);
  });
});
