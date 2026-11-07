import { describe, expect, test } from "bun:test";

import type { FolderMessageMeta, MessageMeta } from "./port";
import type { MovedRow } from "./repo";
import {
  baseDedupKey,
  contentHash,
  copyDedupKey,
  decideIncoming,
  filterAboveCursor,
  isDeleted,
  matchReturned,
  type MailIdentity,
  type KnownCopy,
  normalizeMessageId,
  otherCopyUids,
  resolveFolderCheck,
  sameMailIdentity,
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

function copy(id: string, dedupKey: string, folder: string, uid = 1): KnownCopy {
  return {
    id,
    dedupKey,
    folder,
    uid,
    contentHash: HASH,
    from: "boss@example.test",
    receivedAt: new Date("2026-11-03T10:05:00Z"),
    undoPendingAt: null,
  };
}

describe("otherCopyUids", () => {
  test("keeps the UIDs of the other rows in the folder only", () => {
    const copies = [
      copy("e1", BASE, "AI/Spam", 5),
      copy("e2", `${BASE}#2`, "AI/Spam", 6),
      copy("e3", `${BASE}#3`, "AI/Info", 7),
    ];
    expect(otherCopyUids(copies, "e1", "AI/Spam")).toEqual(new Set([6]));
    expect(otherCopyUids(copies, "e3", "AI/Spam")).toEqual(new Set([5, 6]));
    expect(otherCopyUids([], "e1", "AI/Spam")).toEqual(new Set());
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
    const copies: KnownCopy[] = [copy("e1", BASE, "INBOX")];
    expect(decideIncoming({ baseKey: BASE, copies, matched: none })).toEqual({
      kind: "update_uid",
      emailId: "e1",
    });
  });

  test("an INBOX copy that is already matched gives new #2", () => {
    const copies: KnownCopy[] = [copy("e1", BASE, "INBOX")];
    expect(decideIncoming({ baseKey: BASE, copies, matched: new Set(["e1"]) })).toEqual({
      kind: "new",
      dedupKey: `${BASE}#2`,
    });
  });

  test("a copy in another folder gives check_folder", () => {
    const copies: KnownCopy[] = [copy("e1", BASE, "AI/Info")];
    expect(decideIncoming({ baseKey: BASE, copies, matched: none })).toEqual({
      kind: "check_folder",
      emailId: "e1",
      folder: "AI/Info",
    });
  });

  test("base in INBOX matched and #2 in AI/Info gives check_folder #2", () => {
    const copies: KnownCopy[] = [copy("e2", `${BASE}#2`, "AI/Info"), copy("e1", BASE, "INBOX")];
    expect(decideIncoming({ baseKey: BASE, copies, matched: new Set(["e1"]) })).toEqual({
      kind: "check_folder",
      emailId: "e2",
      folder: "AI/Info",
    });
  });

  test("INBOX copies come before copies in other folders", () => {
    const copies: KnownCopy[] = [copy("e1", BASE, "AI/Info"), copy("e2", `${BASE}#2`, "INBOX")];
    expect(decideIncoming({ baseKey: BASE, copies, matched: none })).toEqual({
      kind: "update_uid",
      emailId: "e2",
    });
  });

  test("copies sort by number: #10 comes after #2", () => {
    const copies: KnownCopy[] = [
      copy("e10", `${BASE}#10`, "INBOX"),
      copy("e2", `${BASE}#2`, "INBOX"),
      copy("e1", BASE, "INBOX"),
    ];
    expect(decideIncoming({ baseKey: BASE, copies, matched: new Set(["e1"]) })).toEqual({
      kind: "update_uid",
      emailId: "e2",
    });
  });

  test("all copies matched gives new with the next number", () => {
    const copies: KnownCopy[] = [copy("e1", BASE, "INBOX"), copy("e2", `${BASE}#2`, "AI/Info")];
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

  test("still in its folder with a fresh undo_pending_at gives undo_in_flight", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    const input = { emailId: "e1", stillInFolder: true, baseKey: BASE, copyCount: 1, now };
    expect(resolveFolderCheck({ ...input, undoPendingAt: new Date(now.getTime() - 3_600_000) })).toEqual({
      kind: "undo_in_flight",
      emailId: "e1",
    });
  });

  test("an undo_pending_at older than 1 day gives the old rule", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    const input = { emailId: "e1", stillInFolder: true, baseKey: BASE, copyCount: 1, now };
    expect(resolveFolderCheck({ ...input, undoPendingAt: new Date(now.getTime() - 25 * 3_600_000) })).toEqual({
      kind: "new",
      dedupKey: `${BASE}#2`,
    });
  });

  test("an undo_pending_at does not stop a return", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(
      resolveFolderCheck({ emailId: "e1", stillInFolder: false, baseKey: BASE, copyCount: 1, undoPendingAt: now, now })
    ).toEqual({ kind: "returned", emailId: "e1" });
  });

  test("gone from its folder gives returned", () => {
    expect(resolveFolderCheck({ emailId: "e1", stillInFolder: false, baseKey: BASE, copyCount: 1 })).toEqual({
      kind: "returned",
      emailId: "e1",
    });
  });
});

describe("sameMailIdentity", () => {
  function key(overrides: Partial<MailIdentity> = {}): MailIdentity {
    return {
      messageId: "<a1@example.test>",
      contentHash: contentHash(meta()),
      from: "boss@example.test",
      receivedAt: new Date("2026-11-03T10:05:00.250Z"),
      ...overrides,
    };
  }

  test("strict: same id and same hash", () => {
    expect(sameMailIdentity(meta(), key(), "strict")).toBe(true);
  });

  test("strict: same id and other size", () => {
    expect(sameMailIdentity(meta({ size: 1300 }), key(), "strict")).toBe(false);
  });

  test("strict: other id", () => {
    expect(sameMailIdentity(meta({ messageId: "<b@example.test>" }), key(), "strict")).toBe(false);
  });

  test("strict: no id and same hash", () => {
    expect(sameMailIdentity(meta({ messageId: null }), key({ messageId: null }), "strict")).toBe(true);
  });

  test("no id and other size is not found, in both modes", () => {
    for (const mode of ["strict", "no_size"] as const) {
      expect(sameMailIdentity(meta({ messageId: null, size: 1300 }), key({ messageId: null }), mode)).toBe(false);
    }
  });

  test("no_size: other size, same id, from and INTERNALDATE second", () => {
    expect(sameMailIdentity(meta({ size: 1300, from: "Boss@Example.test" }), key(), "no_size")).toBe(true);
  });

  test("no_size: other from", () => {
    expect(sameMailIdentity(meta({ size: 1300, from: "other@example.test" }), key(), "no_size")).toBe(false);
  });

  test("no_size: INTERNALDATE one second off", () => {
    const off = new Date("2026-11-03T10:05:01Z");
    expect(sameMailIdentity(meta({ size: 1300, internalDate: off }), key(), "no_size")).toBe(false);
  });

  test("no_size: the Date header does not matter", () => {
    const other = new Date("2026-01-01T00:00:00Z");
    expect(sameMailIdentity(meta({ size: 1300, date: other }), key(), "no_size")).toBe(true);
  });
});

describe("isDeleted", () => {
  const withFlags = (flags: string[]): FolderMessageMeta => ({ ...meta(), flags });

  test("true only with \\Deleted", () => {
    expect(isDeleted(withFlags(["\\Seen", "\\Deleted"]))).toBe(true);
    expect(isDeleted(withFlags(["\\Seen", "\\Flagged"]))).toBe(false);
    expect(isDeleted(withFlags([]))).toBe(false);
  });
});

describe("matchReturned", () => {
  const withFlags = (overrides: Partial<FolderMessageMeta>): FolderMessageMeta => ({
    ...meta(),
    flags: [],
    ...overrides,
  });
  const movedRow = (id: string, inboxUid: number, overrides: Partial<MovedRow> = {}): MovedRow => ({
    id,
    uid: 3,
    inbox_uid: inboxUid,
    folder: "AI/Info",
    message_id_header: "<a1@example.test>",
    content_hash: contentHash(meta()),
    from_address: "boss@example.test",
    received_at: new Date("2026-11-03T10:05:00Z"),
    moved_at: new Date("2026-11-03T11:00:00Z"),
    ...overrides,
  });

  test("a meta at the inbox_uid of a row with the same identity is a hit", () => {
    expect(matchReturned([withFlags({ uid: 10 })], [movedRow("e1", 10)])).toEqual([{ emailId: "e1", uid: 10 }]);
  });

  test("a meta at the folder uid of a row (inbox_uid differs) with the same identity is a hit", () => {
    expect(matchReturned([withFlags({ uid: 4 })], [movedRow("e1", 1, { uid: 4 })])).toEqual([
      { emailId: "e1", uid: 4 },
    ]);
  });

  test("metas at both uids of one row give one hit", () => {
    const metas = [withFlags({ uid: 1 }), withFlags({ uid: 4 })];
    expect(matchReturned(metas, [movedRow("e1", 1, { uid: 4 })])).toEqual([{ emailId: "e1", uid: 1 }]);
  });

  test("the same meta with \\Deleted is no hit", () => {
    expect(matchReturned([withFlags({ uid: 10, flags: ["\\Deleted"] })], [movedRow("e1", 10)])).toEqual([]);
  });

  test("the same uid with another identity is no hit", () => {
    const other = withFlags({ uid: 10, messageId: "<other@example.test>" });
    expect(matchReturned([other], [movedRow("e1", 10)])).toEqual([]);
  });

  test("a meta at the folder uid of a row with another identity is no hit", () => {
    const other = withFlags({ uid: 4, messageId: "<other@example.test>" });
    expect(matchReturned([other], [movedRow("e1", 1, { uid: 4 })])).toEqual([]);
  });

  test("one meta matching several rows prefers the row whose inbox_uid is the meta uid", () => {
    const rows = [movedRow("e1", 1, { uid: 9 }), movedRow("e2", 9, { uid: 3 })];
    expect(matchReturned([withFlags({ uid: 9 })], rows)).toEqual([{ emailId: "e2", uid: 9 }]);
  });

  test("a meta with the uid of no row is ignored", () => {
    expect(matchReturned([withFlags({ uid: 11 })], [movedRow("e1", 10)])).toEqual([]);
  });

  test("two rows and one hit", () => {
    const metas = [withFlags({ uid: 10 }), withFlags({ uid: 12, messageId: "<z@example.test>" })];
    const rows = [movedRow("e1", 10), movedRow("e2", 12)];
    expect(matchReturned(metas, rows)).toEqual([{ emailId: "e1", uid: 10 }]);
  });
});
