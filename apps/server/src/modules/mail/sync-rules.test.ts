import { describe, expect, test } from "bun:test";

import type { FolderMessageMeta, MessageMeta } from "./port";
import type { MovedRow } from "./repo";
import {
  baseDedupKey,
  CHECK_FOLDER_MAX_CANDIDATES,
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

function copy(input: {
  id: string;
  key: string;
  folder: string;
  sourceFolder?: string;
  uid?: number;
  movePendingAt?: Date | null;
}): KnownCopy {
  return {
    id: input.id,
    dedupKey: input.key,
    folder: input.folder,
    sourceFolder: input.sourceFolder ?? "INBOX",
    uid: input.uid ?? 1,
    contentHash: HASH,
    from: "boss@example.test",
    receivedAt: new Date("2026-11-03T10:05:00Z"),
    movePendingAt: input.movePendingAt ?? null,
  };
}

describe("otherCopyUids", () => {
  test("keeps the UIDs of the other rows in the folder only", () => {
    const copies = [
      copy({ id: "e1", key: BASE, folder: "AI/Spam", uid: 5 }),
      copy({ id: "e2", key: `${BASE}#2`, folder: "AI/Spam", uid: 6 }),
      copy({ id: "e3", key: `${BASE}#3`, folder: "AI/Info", uid: 7 }),
    ];
    expect(otherCopyUids(copies, "e1", "AI/Spam")).toEqual(new Set([6]));
    expect(otherCopyUids(copies, "e3", "AI/Spam")).toEqual(new Set([5, 6]));
    expect(otherCopyUids([], "e1", "AI/Spam")).toEqual(new Set());
  });
});

describe("decideIncoming", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  const none = new Map<string, string>();
  const decide = (folder: string, copies: KnownCopy[], matched: ReadonlyMap<string, string> = none) =>
    decideIncoming({ folder, baseKey: BASE, copies, matched, now });

  test("no copies gives new with the base key", () => {
    expect(decide("INBOX", [])).toEqual({ kind: "new", dedupKey: BASE });
  });

  test("one INBOX copy gives update_uid, isSource true", () => {
    expect(decide("INBOX", [copy({ id: "e1", key: BASE, folder: "INBOX" })])).toEqual({
      kind: "update_uid",
      emailId: "e1",
      isSource: true,
    });
  });

  test("a rescued copy in INBOX (source spam folder) gives update_uid, isSource false", () => {
    const copies = [copy({ id: "e1", key: BASE, folder: "INBOX", sourceFolder: "Wiadomości-śmieci" })];
    expect(decide("INBOX", copies)).toEqual({ kind: "update_uid", emailId: "e1", isSource: false });
  });

  test("S Oferty, a copy in INBOX gives check_folder INBOX, not system moved", () => {
    expect(decide("Oferty", [copy({ id: "e1", key: BASE, folder: "INBOX" })])).toEqual({
      kind: "check_folder",
      candidates: [{ emailId: "e1", folder: "INBOX", systemMoved: false }],
      seenElsewhere: false,
    });
  });

  test("S Oferty, a copy in AI/Info gives check_folder AI/Info, system moved", () => {
    expect(decide("Oferty", [copy({ id: "e1", key: BASE, folder: "AI/Info" })])).toEqual({
      kind: "check_folder",
      candidates: [{ emailId: "e1", folder: "AI/Info", systemMoved: true }],
      seenElsewhere: false,
    });
  });

  test("a fresh move marker gives move_in_flight, also when the copy is matched", () => {
    const copies = [copy({ id: "e1", key: BASE, folder: "AI/Info", movePendingAt: new Date("2026-11-08T11:00:00Z") })];
    expect(decide("INBOX", copies)).toEqual({ kind: "move_in_flight", emailId: "e1" });
    expect(decide("INBOX", copies, new Map([["e1", "INBOX"]]))).toEqual({ kind: "move_in_flight", emailId: "e1" });
  });

  test("a move marker of 25 h is a leftover: the normal rules apply", () => {
    const copies = [copy({ id: "e1", key: BASE, folder: "AI/Info", movePendingAt: new Date("2026-11-07T11:00:00Z") })];
    expect(decide("INBOX", copies)).toMatchObject({ kind: "check_folder", candidates: [{ emailId: "e1" }] });
  });

  test("a copy in S wins over an earlier copy in another folder", () => {
    const copies = [
      copy({ id: "e1", key: BASE, folder: "AI/Info" }),
      copy({ id: "e2", key: `${BASE}#2`, folder: "Oferty", sourceFolder: "Oferty" }),
    ];
    expect(decide("Oferty", copies)).toEqual({ kind: "update_uid", emailId: "e2", isSource: true });
  });

  test("the only copy in S is matched: new #2", () => {
    const copies = [copy({ id: "e1", key: BASE, folder: "Oferty", sourceFolder: "Oferty" })];
    expect(decide("Oferty", copies, new Map([["e1", "Oferty"]]))).toEqual({ kind: "new", dedupKey: `${BASE}#2` });
  });

  test("the copy in S is matched: the next free copy is checked", () => {
    const copies = [
      copy({ id: "e1", key: BASE, folder: "Oferty", sourceFolder: "Oferty" }),
      copy({ id: "e2", key: `${BASE}#2`, folder: "AI/Info" }),
    ];
    expect(decide("Oferty", copies, new Map([["e1", "Oferty"]]))).toMatchObject({
      kind: "check_folder",
      candidates: [{ emailId: "e2" }],
    });
  });

  test("copies sort by number: #10 comes after #2", () => {
    const copies = [
      copy({ id: "e10", key: `${BASE}#10`, folder: "INBOX" }),
      copy({ id: "e2", key: `${BASE}#2`, folder: "INBOX" }),
      copy({ id: "e1", key: BASE, folder: "INBOX" }),
    ];
    expect(decide("INBOX", copies, new Map([["e1", "INBOX"]]))).toEqual({
      kind: "update_uid",
      emailId: "e2",
      isSource: true,
    });
  });

  test("all copies matched in S gives new with the next number", () => {
    const copies = [
      copy({ id: "e1", key: BASE, folder: "INBOX" }),
      copy({ id: "e2", key: `${BASE}#2`, folder: "INBOX" }),
    ];
    const matched = new Map([
      ["e1", "INBOX"],
      ["e2", "INBOX"],
    ]);
    expect(decide("INBOX", copies, matched)).toEqual({ kind: "new", dedupKey: `${BASE}#3` });
  });

  test("S Oferty, the only copy is matched in INBOX gives cross_copy, no check_folder", () => {
    const copies = [copy({ id: "e1", key: BASE, folder: "INBOX" })];
    expect(decide("Oferty", copies, new Map([["e1", "INBOX"]]))).toEqual({ kind: "cross_copy", emailId: "e1" });
  });

  test("S Oferty, a free copy in AI/Info and a copy matched in INBOX: check_folder with seenElsewhere", () => {
    const copies = [
      copy({ id: "e1", key: BASE, folder: "AI/Info" }),
      copy({ id: "e2", key: `${BASE}#2`, folder: "INBOX" }),
    ];
    expect(decide("Oferty", copies, new Map([["e2", "INBOX"]]))).toEqual({
      kind: "check_folder",
      candidates: [{ emailId: "e1", folder: "AI/Info", systemMoved: true }],
      seenElsewhere: true,
    });
  });

  test("a free copy #1 in S and a copy #2 with a fresh marker: move_in_flight wins", () => {
    const copies = [
      copy({ id: "e1", key: BASE, folder: "INBOX" }),
      copy({ id: "e2", key: `${BASE}#2`, folder: "AI/Info", movePendingAt: new Date("2026-11-08T11:00:00Z") }),
    ];
    expect(decide("INBOX", copies)).toEqual({ kind: "move_in_flight", emailId: "e2" });
  });

  test("S INBOX, an INBOX copy that is already matched gives new #2", () => {
    const copies = [copy({ id: "e1", key: BASE, folder: "INBOX" })];
    expect(decide("INBOX", copies, new Map([["e1", "INBOX"]]))).toEqual({ kind: "new", dedupKey: `${BASE}#2` });
  });

  test("S INBOX, a copy in another folder gives check_folder, system moved", () => {
    expect(decide("INBOX", [copy({ id: "e1", key: BASE, folder: "AI/Info" })])).toEqual({
      kind: "check_folder",
      candidates: [{ emailId: "e1", folder: "AI/Info", systemMoved: true }],
      seenElsewhere: false,
    });
  });

  test("S INBOX, e1 INBOX matched and e2 AI/Info free: check_folder e2, not seen elsewhere", () => {
    const copies = [
      copy({ id: "e2", key: `${BASE}#2`, folder: "AI/Info" }),
      copy({ id: "e1", key: BASE, folder: "INBOX" }),
    ];
    expect(decide("INBOX", copies, new Map([["e1", "INBOX"]]))).toEqual({
      kind: "check_folder",
      candidates: [{ emailId: "e2", folder: "AI/Info", systemMoved: true }],
      seenElsewhere: false,
    });
  });

  test("S INBOX, INBOX copies come before copies in other folders", () => {
    const copies = [
      copy({ id: "e1", key: BASE, folder: "AI/Info" }),
      copy({ id: "e2", key: `${BASE}#2`, folder: "INBOX" }),
    ];
    expect(decide("INBOX", copies)).toEqual({ kind: "update_uid", emailId: "e2", isSource: true });
  });

  test("S INBOX, e1 INBOX and e2 AI/Info both matched with INBOX gives new #3", () => {
    const copies = [
      copy({ id: "e1", key: BASE, folder: "INBOX" }),
      copy({ id: "e2", key: `${BASE}#2`, folder: "AI/Info" }),
    ];
    const matched = new Map([
      ["e1", "INBOX"],
      ["e2", "INBOX"],
    ]);
    expect(decide("INBOX", copies, matched)).toEqual({ kind: "new", dedupKey: `${BASE}#3` });
  });

  test("S INBOX, two free copies in AI/Spam: both are candidates in copy order", () => {
    const copies = [
      copy({ id: "e1", key: BASE, folder: "AI/Spam" }),
      copy({ id: "e2", key: `${BASE}#2`, folder: "AI/Spam" }),
    ];
    expect(decide("INBOX", copies)).toEqual({
      kind: "check_folder",
      candidates: [
        { emailId: "e1", folder: "AI/Spam", systemMoved: true },
        { emailId: "e2", folder: "AI/Spam", systemMoved: true },
      ],
      seenElsewhere: false,
    });
  });

  test("S INBOX, candidates follow the copy number, not the input order", () => {
    const copies = [
      copy({ id: "e2", key: `${BASE}#2`, folder: "AI/Info" }),
      copy({ id: "e1", key: BASE, folder: "Oferty", sourceFolder: "Oferty" }),
    ];
    expect(decide("INBOX", copies)).toEqual({
      kind: "check_folder",
      candidates: [
        { emailId: "e1", folder: "Oferty", systemMoved: false },
        { emailId: "e2", folder: "AI/Info", systemMoved: true },
      ],
      seenElsewhere: false,
    });
  });

  test("S INBOX, seven free copies: only the first five are candidates", () => {
    const copies = Array.from({ length: 7 }, (_, index) =>
      copy({ id: `e${index + 1}`, key: index === 0 ? BASE : `${BASE}#${index + 1}`, folder: "AI/Spam" })
    );
    const decision = decide("INBOX", copies);
    expect(decision.kind).toBe("check_folder");
    if (decision.kind !== "check_folder") return;
    expect(decision.candidates.map((candidate) => candidate.emailId)).toEqual(["e1", "e2", "e3", "e4", "e5"]);
  });

  test("S INBOX, a copy matched in Oferty is no candidate: the free copy is, seen elsewhere", () => {
    const copies = [
      copy({ id: "e1", key: BASE, folder: "AI/Spam" }),
      copy({ id: "e2", key: `${BASE}#2`, folder: "AI/Spam" }),
    ];
    expect(decide("INBOX", copies, new Map([["e1", "Oferty"]]))).toEqual({
      kind: "check_folder",
      candidates: [{ emailId: "e2", folder: "AI/Spam", systemMoved: true }],
      seenElsewhere: true,
    });
  });

  test("the folder check tries at most 5 copies", () => {
    expect(CHECK_FOLDER_MAX_CANDIDATES).toBe(5);
  });

  test("a run copy stored in INBOX: cross_copy for S Oferty, new #2 for S INBOX", () => {
    const run = copy({ id: `run:${BASE}`, key: BASE, folder: "INBOX" });
    const matched = new Map([[run.id, "INBOX"]]);
    expect(decide("Oferty", [run], matched)).toEqual({ kind: "cross_copy", emailId: run.id });
    expect(decide("INBOX", [run], matched)).toEqual({ kind: "new", dedupKey: `${BASE}#2` });
  });
});

describe("resolveFolderCheck", () => {
  const input = { emailId: "e1", baseKey: BASE, copyCount: 2 };

  test("system moved, still there: new with the next copy key", () => {
    expect(resolveFolderCheck({ ...input, stillInFolder: true, systemMoved: true, seenElsewhere: false })).toEqual({
      kind: "new",
      dedupKey: `${BASE}#3`,
    });
  });

  test("system moved, still there, seen elsewhere: cross_copy", () => {
    expect(resolveFolderCheck({ ...input, stillInFolder: true, systemMoved: true, seenElsewhere: true })).toEqual({
      kind: "cross_copy",
      emailId: "e1",
    });
  });

  test("system moved, gone: returned", () => {
    expect(resolveFolderCheck({ ...input, stillInFolder: false, systemMoved: true, seenElsewhere: false })).toEqual({
      kind: "returned",
      emailId: "e1",
    });
  });

  test("in its source folder, still there: cross_copy", () => {
    expect(resolveFolderCheck({ ...input, stillInFolder: true, systemMoved: false, seenElsewhere: false })).toEqual({
      kind: "cross_copy",
      emailId: "e1",
    });
  });

  test("in its source folder, gone: relocated", () => {
    expect(resolveFolderCheck({ ...input, stillInFolder: false, systemMoved: false, seenElsewhere: false })).toEqual({
      kind: "relocated",
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
    source_folder: "INBOX",
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
