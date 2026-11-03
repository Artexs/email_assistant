import { describe, expect, test } from "bun:test";

import type { MessageMeta } from "./port";
import {
  baseDedupKey,
  contentHash,
  copyDedupKey,
  decideIncoming,
  filterAboveCursor,
  type KnownCopy,
  normalizeMessageId,
  resolveFolderCheck,
  threadKey,
} from "./sync-rules";

function meta(overrides: Partial<MessageMeta> = {}): MessageMeta {
  return {
    uid: 1,
    size: 1200,
    internalDate: new Date("2026-11-03T10:05:00Z"),
    date: new Date("2026-11-03T10:00:00Z"),
    messageId: "<a1@example.test>",
    inReplyTo: null,
    references: [],
    from: "boss@example.test",
    to: ["me@example.test"],
    cc: [],
    subject: "Hello",
    actionId: null,
    ...overrides,
  };
}

const HASH = "a".repeat(64);
const BASE = `mid:<a1@example.test>:${HASH}`;

describe("normalizeMessageId", () => {
  test("trims and keeps the angle brackets", () => {
    expect(normalizeMessageId("  <a1@example.test> ")).toBe("<a1@example.test>");
  });

  test("empty, null and undefined give null", () => {
    expect(normalizeMessageId("")).toBeNull();
    expect(normalizeMessageId("   ")).toBeNull();
    expect(normalizeMessageId(null)).toBeNull();
    expect(normalizeMessageId(undefined)).toBeNull();
  });
});

describe("contentHash", () => {
  test("is a stable SHA-256 hex string", () => {
    const hash = contentHash(meta());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash(meta())).toBe(hash);
  });

  test("changes with from, date and size", () => {
    const hash = contentHash(meta());
    expect(contentHash(meta({ from: "other@example.test" }))).not.toBe(hash);
    expect(contentHash(meta({ date: new Date("2026-11-03T10:00:01Z") }))).not.toBe(hash);
    expect(contentHash(meta({ size: 1201 }))).not.toBe(hash);
  });

  test("From in other case and with spaces gives the same hash", () => {
    expect(contentHash(meta({ from: "  Boss@Example.TEST " }))).toBe(contentHash(meta()));
  });

  test("date null uses internalDate", () => {
    const internalDate = new Date("2026-11-03T10:05:00Z");
    expect(contentHash(meta({ date: null, internalDate }))).toBe(
      contentHash(meta({ date: internalDate, internalDate }))
    );
    expect(contentHash(meta({ date: null }))).not.toBe(contentHash(meta()));
  });

  test("invalid date uses internalDate", () => {
    expect(contentHash(meta({ date: new Date("not a date") }))).toBe(contentHash(meta({ date: null })));
  });

  test("from null is allowed", () => {
    expect(contentHash(meta({ from: null }))).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash(meta({ from: null }))).not.toBe(contentHash(meta()));
  });
});

describe("dedup keys", () => {
  test("no Message-ID gives a hash: key", () => {
    expect(baseDedupKey(null, HASH)).toBe(`hash:${HASH}`);
  });

  test("Message-ID gives a mid: key with the hash", () => {
    expect(baseDedupKey("<a1@example.test>", HASH)).toBe(BASE);
  });

  test("same Message-ID with another hash gives another key", () => {
    const other = contentHash(meta({ size: 999 }));
    expect(baseDedupKey("<a1@example.test>", other)).not.toBe(baseDedupKey("<a1@example.test>", contentHash(meta())));
  });

  test("copyDedupKey 1, 2, 3", () => {
    expect(copyDedupKey(BASE, 1)).toBe(BASE);
    expect(copyDedupKey(BASE, 2)).toBe(`${BASE}#2`);
    expect(copyDedupKey(BASE, 3)).toBe(`${BASE}#3`);
  });
});

describe("threadKey", () => {
  const full = {
    references: ["<root@x>", "<mid@x>"],
    inReplyTo: "<parent@x>",
    messageId: "<own@x>",
  };

  test("first reference first", () => {
    expect(threadKey(full, "fb")).toBe("<root@x>");
  });

  test("then in-reply-to", () => {
    expect(threadKey({ ...full, references: [] }, "fb")).toBe("<parent@x>");
  });

  test("then the own Message-ID", () => {
    expect(threadKey({ ...full, references: [], inReplyTo: null }, "fb")).toBe("<own@x>");
  });

  test("then the fallback", () => {
    expect(threadKey({ references: [], inReplyTo: null, messageId: null }, "fb")).toBe("fb");
  });
});

describe("filterAboveCursor", () => {
  test("a message below the cursor is ignored", () => {
    expect(filterAboveCursor([meta({ uid: 7 })], 9)).toEqual({ kept: [], ignored: 1 });
  });

  test("the cursor uid itself is ignored", () => {
    expect(filterAboveCursor([meta({ uid: 9 })], 9)).toEqual({ kept: [], ignored: 1 });
  });

  test("repeated uids are dropped and the rest is sorted", () => {
    const result = filterAboveCursor(
      [meta({ uid: 12 }), meta({ uid: 10 }), meta({ uid: 12 }), meta({ uid: 3 }), meta({ uid: 11 })],
      9
    );
    expect(result.kept.map((m) => m.uid)).toEqual([10, 11, 12]);
    expect(result.ignored).toBe(2);
  });
});

describe("decideIncoming", () => {
  const none = new Set<string>();

  test("no copies gives new with the base key", () => {
    expect(decideIncoming({ baseKey: BASE, copies: [], matched: none })).toEqual({
      kind: "new",
      dedupKey: BASE,
    });
  });

  test("one INBOX copy gives update_uid", () => {
    const copies: KnownCopy[] = [{ id: "e1", dedupKey: BASE, folder: "INBOX" }];
    expect(decideIncoming({ baseKey: BASE, copies, matched: none })).toEqual({
      kind: "update_uid",
      emailId: "e1",
    });
  });

  test("an INBOX copy that is already matched gives new #2", () => {
    const copies: KnownCopy[] = [{ id: "e1", dedupKey: BASE, folder: "INBOX" }];
    expect(decideIncoming({ baseKey: BASE, copies, matched: new Set(["e1"]) })).toEqual({
      kind: "new",
      dedupKey: `${BASE}#2`,
    });
  });

  test("a copy in another folder gives check_folder", () => {
    const copies: KnownCopy[] = [{ id: "e1", dedupKey: BASE, folder: "AI/Info" }];
    expect(decideIncoming({ baseKey: BASE, copies, matched: none })).toEqual({
      kind: "check_folder",
      emailId: "e1",
      folder: "AI/Info",
    });
  });

  test("base in INBOX matched and #2 in AI/Info gives check_folder #2", () => {
    const copies: KnownCopy[] = [
      { id: "e2", dedupKey: `${BASE}#2`, folder: "AI/Info" },
      { id: "e1", dedupKey: BASE, folder: "INBOX" },
    ];
    expect(decideIncoming({ baseKey: BASE, copies, matched: new Set(["e1"]) })).toEqual({
      kind: "check_folder",
      emailId: "e2",
      folder: "AI/Info",
    });
  });

  test("INBOX copies come before copies in other folders", () => {
    const copies: KnownCopy[] = [
      { id: "e1", dedupKey: BASE, folder: "AI/Info" },
      { id: "e2", dedupKey: `${BASE}#2`, folder: "INBOX" },
    ];
    expect(decideIncoming({ baseKey: BASE, copies, matched: none })).toEqual({
      kind: "update_uid",
      emailId: "e2",
    });
  });

  test("copies sort by number: #10 comes after #2", () => {
    const copies: KnownCopy[] = [
      { id: "e10", dedupKey: `${BASE}#10`, folder: "INBOX" },
      { id: "e2", dedupKey: `${BASE}#2`, folder: "INBOX" },
      { id: "e1", dedupKey: BASE, folder: "INBOX" },
    ];
    expect(decideIncoming({ baseKey: BASE, copies, matched: new Set(["e1"]) })).toEqual({
      kind: "update_uid",
      emailId: "e2",
    });
  });

  test("all copies matched gives new with the next number", () => {
    const copies: KnownCopy[] = [
      { id: "e1", dedupKey: BASE, folder: "INBOX" },
      { id: "e2", dedupKey: `${BASE}#2`, folder: "AI/Info" },
    ];
    expect(decideIncoming({ baseKey: BASE, copies, matched: new Set(["e1", "e2"]) })).toEqual({
      kind: "new",
      dedupKey: `${BASE}#3`,
    });
  });
});

describe("resolveFolderCheck", () => {
  test("still in its folder gives new with the next copy key", () => {
    expect(resolveFolderCheck({ emailId: "e1", stillInFolder: true, baseKey: BASE, copyCount: 1 })).toEqual({
      kind: "new",
      dedupKey: `${BASE}#2`,
    });
  });

  test("gone from its folder gives returned", () => {
    expect(resolveFolderCheck({ emailId: "e1", stillInFolder: false, baseKey: BASE, copyCount: 1 })).toEqual({
      kind: "returned",
      emailId: "e1",
    });
  });
});
