import { format } from "node:util";

import { afterAll, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { isOwnActionId } from "../../src/modules/actions";
import {
  CursorMovedError,
  findUserMoves,
  refreshFlags,
  syncMailbox,
  type MailboxSyncResult,
  type MailProvider,
  type SeedMessage,
  type SyncDeps,
} from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { forceRescan, updateCursor } from "../../src/modules/mail/repo";
import { RETURN_CHECK_LIMIT } from "../../src/modules/mail/sync";
import type { DB, Db, TenantContext } from "../../src/platform/db";
import { HardError, SoftError } from "../../src/platform/errors";
import { setLogLevel } from "../../src/platform/log";

import { createOrgWithMailbox, insertAction, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const UID_VALIDITY = 7;

interface Setup {
  ctx: TenantContext;
  mailboxId: string;
  address: string;
  fake: FakeMailProvider;
}

async function setup(trx: Transaction<DB>): Promise<Setup> {
  const { orgId, mailboxId } = await createOrgWithMailbox(trx);
  const ctx = { orgId };
  const moved = await updateCursor(
    trx,
    ctx,
    mailboxId,
    { uidValidity: null, lastUid: null },
    { uidValidity: UID_VALIDITY, lastUid: 0 }
  );
  expect(moved).toBe(true);
  const mailbox = await trx
    .selectFrom("mailboxes")
    .select("address")
    .where("id", "=", mailboxId)
    .executeTakeFirstOrThrow();
  return { ctx, mailboxId, address: mailbox.address, fake: createFakeMailProvider({ uidValidity: UID_VALIDITY }) };
}

const NOW = new Date("2026-11-03T12:00:00Z");

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 3_600_000);
}

function deps(trx: Db | Transaction<DB>, provider: MailProvider, overrides: Partial<SyncDeps> = {}): SyncDeps {
  return {
    db: trx,
    provider,
    isOwnActionId: async () => false,
    now: () => NOW,
    ...overrides,
  };
}

function seed(n: number, overrides: Partial<SeedMessage> = {}): SeedMessage {
  return {
    messageId: `<m${n}@x.test>`,
    from: `sender${n}@x.test`,
    to: ["box@x.test"],
    subject: `Mail ${n}`,
    date: new Date(Date.UTC(2026, 10, 3, 8, 0, n)),
    text: `Body ${n}`,
    ...overrides,
  };
}

async function emails(trx: Db | Transaction<DB>, mailboxId: string) {
  return trx
    .selectFrom("emails")
    .select([
      "id",
      "dedup_key",
      "message_id_header",
      "uid",
      "folder",
      "returned_at",
      "status",
      "body_text",
      "thread_key",
      "references_header",
    ])
    .where("mailbox_id", "=", mailboxId)
    .orderBy("uid")
    .execute();
}

async function cursorOf(trx: Db | Transaction<DB>, mailboxId: string) {
  const row = await trx
    .selectFrom("mailbox_folders")
    .select(["uidvalidity", "last_uid"])
    .where("mailbox_id", "=", mailboxId)
    .where("key", "=", "inbox")
    .executeTakeFirstOrThrow();
  return { uidValidity: Number(row.uidvalidity), lastUid: Number(row.last_uid) };
}

// Runs `hook` before the n-th call of fetchContent, then calls the fake.
function onBodyCall(fake: FakeMailProvider, hook: (call: number) => Promise<void>): MailProvider {
  let call = 0;
  return {
    ...fake,
    serverInfo: () => fake.serverInfo(),
    folderStatus: (folder) => fake.folderStatus(folder),
    fetchAbove: (folder, lastUid) => fake.fetchAbove(folder, lastUid),
    fetchContent: async (folder, uid) => {
      call += 1;
      await hook(call);
      return fake.fetchContent(folder, uid);
    },
    close: () => fake.close(),
  };
}

// Runs `hook` once, right after the first call of `method` returns.
function afterFirstCall(
  fake: FakeMailProvider,
  method: "folderStatus" | "searchSinceIn",
  hook: () => void
): MailProvider {
  let done = false;
  const once = <T>(value: T): T => {
    if (!done) {
      done = true;
      hook();
    }
    return value;
  };
  return {
    ...fake,
    serverInfo: () => fake.serverInfo(),
    folderStatus: async (folder) => {
      const status = await fake.folderStatus(folder);
      return method === "folderStatus" ? once(status) : status;
    },
    fetchAbove: (folder, lastUid) => fake.fetchAbove(folder, lastUid),
    searchSinceIn: async (folder, since) => {
      const uids = await fake.searchSinceIn(folder, since);
      return method === "searchSinceIn" ? once(uids) : uids;
    },
    fetchByUidsIn: (folder, uids) => fake.fetchByUidsIn(folder, uids),
    fetchContent: (folder, uid) => fake.fetchContent(folder, uid),
    close: () => fake.close(),
  };
}

describe("syncMailbox: incremental", () => {
  test("a message below the cursor from UID FETCH n:* is ignored", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      s.fake.deliver("INBOX", seed(1));
      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.mode).toBe("incremental");
      expect(result.ignoredBelowCursor).toBe(1);
      expect(result.stored).toBe(0);
      expect(await emails(trx, s.mailboxId)).toHaveLength(1);
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: 1 });
    });
  });

  test("a mail without Message-ID is stored once with a hash: key", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      s.fake.deliver("INBOX", seed(1, { messageId: undefined }));

      const first = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(first.stored).toBe(1);
      const second = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(second.stored).toBe(0);

      const rows = await emails(trx, s.mailboxId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.dedup_key.startsWith("hash:")).toBe(true);
      expect(rows[0]?.thread_key).toBe(rows[0]?.dedup_key);
    });
  });

  test("a Message-ID with spaces around it is stored trimmed", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      s.fake.deliver("INBOX", seed(1, { messageId: " <m1@x.test> " }));

      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      const rows = await emails(trx, s.mailboxId);
      expect(rows[0]?.message_id_header).toBe("<m1@x.test>");
      expect(rows[0]?.thread_key).toBe("<m1@x.test>");
    });
  });

  test("a blank Message-ID counts as no Message-ID", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      s.fake.deliver("INBOX", seed(1, { messageId: "   " }));

      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      const rows = await emails(trx, s.mailboxId);
      expect(rows[0]?.message_id_header).toBeNull();
      expect(rows[0]?.dedup_key.startsWith("hash:")).toBe(true);
      expect(rows[0]?.thread_key).toBe(rows[0]?.dedup_key);
    });
  });

  test("the same Message-ID with a different content hash is a new mail", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      s.fake.deliver("INBOX", seed(1), { size: 1000 });
      s.fake.deliver("INBOX", seed(1), { size: 2000 });

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.stored).toBe(2);
      const rows = await emails(trx, s.mailboxId);
      expect(rows).toHaveLength(2);
      expect(rows[0]?.dedup_key).not.toBe(rows[1]?.dedup_key);
    });
  });

  test("a known mail that the user moves back to INBOX gets returned_at and is not triaged again", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = s.fake.deliver("INBOX", seed(1));
      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      await trx.updateTable("emails").set({ folder: "AI/Info" }).where("mailbox_id", "=", s.mailboxId).execute();
      const archived = s.fake.userMove("INBOX", uid, "AI/Info");
      const back = s.fake.userMove("AI/Info", archived, "INBOX");

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.returned).toBe(1);
      expect(result.stored).toBe(0);
      const rows = await emails(trx, s.mailboxId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.returned_at).toBeInstanceOf(Date);
      expect(rows[0]?.folder).toBe("INBOX");
      expect(Number(rows[0]?.uid)).toBe(back);
      expect(rows[0]?.status).toBe("pending");
    });
  });

  test("a known mail without Message-ID that comes back to INBOX is returned, not stored again", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = s.fake.deliver("INBOX", seed(1, { messageId: undefined }));
      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      await trx.updateTable("emails").set({ folder: "AI/Info" }).where("mailbox_id", "=", s.mailboxId).execute();
      const archived = s.fake.userMove("INBOX", uid, "AI/Info");
      const back = s.fake.userMove("AI/Info", archived, "INBOX");

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.returned).toBe(1);
      expect(result.stored).toBe(0);
      const rows = await emails(trx, s.mailboxId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.folder).toBe("INBOX");
      expect(Number(rows[0]?.uid)).toBe(back);
    });
  });

  test("a second identical copy while the first one is still in its folder is stored with #2", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = s.fake.deliver("INBOX", seed(1));
      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      await trx.updateTable("emails").set({ folder: "AI/Info" }).where("mailbox_id", "=", s.mailboxId).execute();
      s.fake.userMove("INBOX", uid, "AI/Info");
      s.fake.deliver("INBOX", seed(1));

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.stored).toBe(1);
      expect(result.returned).toBe(0);
      const rows = await emails(trx, s.mailboxId);
      expect(rows).toHaveLength(2);
      expect(rows[1]?.dedup_key).toBe(`${rows[0]?.dedup_key}#2`);
      expect(rows[0]?.returned_at).toBeNull();
    });
  });

  test("Interia shape: the copy in the folder keeps the INBOX uid and a new identical INBOX copy is stored with #2", async () => {
    await withRollback(db, async (trx) => {
      const base = await setup(trx);
      const s = { ...base, fake: createFakeMailProvider({ uidValidity: UID_VALIDITY, keepUidOnUserMove: true }) };
      const uid = s.fake.deliver("INBOX", seed(1));
      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      await trx.updateTable("emails").set({ folder: "AI/Info" }).where("mailbox_id", "=", s.mailboxId).execute();
      expect(s.fake.userMove("INBOX", uid, "AI/Info")).toBe(uid);
      const fresh = s.fake.deliver("INBOX", seed(1));
      expect(fresh).not.toBe(uid);

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.stored).toBe(1);
      expect(result.returned).toBe(0);
      const rows = await emails(trx, s.mailboxId);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ folder: "AI/Info", returned_at: null });
      expect(Number(rows[0]?.uid)).toBe(uid);
      expect(rows[1]?.dedup_key).toBe(`${rows[0]?.dedup_key}#2`);
      expect(Number(rows[1]?.uid)).toBe(fresh);
    });
  });

  test("a known mail without Message-ID that is still in its folder: a new identical copy is stored with #2", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = s.fake.deliver("INBOX", seed(1, { messageId: undefined }));
      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      await trx.updateTable("emails").set({ folder: "AI/Info" }).where("mailbox_id", "=", s.mailboxId).execute();
      s.fake.userMove("INBOX", uid, "AI/Info");
      s.fake.deliver("INBOX", seed(1, { messageId: undefined }));

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.stored).toBe(1);
      expect(result.returned).toBe(0);
      const rows = await emails(trx, s.mailboxId);
      expect(rows).toHaveLength(2);
      expect(rows[1]?.dedup_key).toBe(`${rows[0]?.dedup_key}#2`);
    });
  });

  test("two rows of one identity in AI/Spam and only the copy of #2 there: a new INBOX copy marks #1 returned", async () => {
    await withRollback(db, async (trx) => {
      const base = await setup(trx);
      const s = { ...base, fake: createFakeMailProvider({ uidValidity: UID_VALIDITY, keepUidOnUserMove: true }) };
      s.fake.deliver("INBOX", seed(1));
      const second = s.fake.deliver("INBOX", seed(1));
      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      await trx.updateTable("emails").set({ folder: "AI/Spam" }).where("mailbox_id", "=", s.mailboxId).execute();
      s.fake.userMove("INBOX", second, "AI/Spam");
      s.fake.remove("INBOX", 1);
      const fresh = s.fake.deliver("INBOX", seed(1));

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.returned).toBe(1);
      expect(result.stored).toBe(0);
      const rows = await emails(trx, s.mailboxId);
      expect(rows).toHaveLength(2);
      const first = rows.find((row) => !row.dedup_key.endsWith("#2"));
      const kept = rows.find((row) => row.dedup_key.endsWith("#2"));
      expect(first).toMatchObject({ folder: "INBOX" });
      expect(first?.returned_at).toBeInstanceOf(Date);
      expect(Number(first?.uid)).toBe(fresh);
      expect(kept).toMatchObject({ folder: "AI/Spam", returned_at: null });
      expect(Number(kept?.uid)).toBe(second);
    });
  });

  // Two identical mails of INBOX, both moved by the system into AI/Spam: rows #1 and #2 hold the folder UIDs.
  async function twoCopiesInSpam(trx: Transaction<DB>, s: Setup) {
    const first = s.fake.deliver("INBOX", seed(1));
    const second = s.fake.deliver("INBOX", seed(1));
    await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
    const spamFirst = s.fake.userMove("INBOX", first, "AI/Spam");
    const spamSecond = s.fake.userMove("INBOX", second, "AI/Spam");
    for (const [suffix, uid] of [
      ["", spamFirst],
      ["#2", spamSecond],
    ] as const) {
      const row = (await emails(trx, s.mailboxId)).find(
        (candidate) => candidate.dedup_key.endsWith("#2") === (suffix !== "")
      );
      await trx
        .updateTable("emails")
        .set({ folder: "AI/Spam", uid, moved_at: hoursAgo(1) })
        .where("id", "=", row?.id ?? "")
        .execute();
    }
    return { spamFirst, spamSecond };
  }

  function rowOfCopy(rows: Awaited<ReturnType<typeof emails>>, copy: 1 | 2) {
    return rows.find((row) => row.dedup_key.endsWith("#2") === (copy === 2));
  }

  test("two identical copies in AI/Spam: the user moves the later one back to INBOX, it is returned and no #3 is stored", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { spamFirst, spamSecond } = await twoCopiesInSpam(trx, s);
      const back = s.fake.userMove("AI/Spam", spamSecond, "INBOX");

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.returned).toBe(1);
      expect(result.stored).toBe(0);
      const rows = await emails(trx, s.mailboxId);
      expect(rows).toHaveLength(2);
      expect(rows.some((row) => row.dedup_key.endsWith("#3"))).toBe(false);
      const later = rowOfCopy(rows, 2);
      expect(later).toMatchObject({ folder: "INBOX" });
      expect(Number(later?.uid)).toBe(back);
      expect(later?.returned_at).toEqual(NOW);
      const earlier = rowOfCopy(rows, 1);
      expect(earlier).toMatchObject({ folder: "AI/Spam", returned_at: null });
      expect(Number(earlier?.uid)).toBe(spamFirst);
    });
  });

  test("two identical copies in AI/Spam: the user moves the earlier one back, the first copy is gone and the second is not located", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { spamFirst, spamSecond } = await twoCopiesInSpam(trx, s);
      s.fake.userMove("AI/Spam", spamFirst, "INBOX");
      const callsBefore = s.fake.folderCalls.length;

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.returned).toBe(1);
      expect(result.stored).toBe(0);
      const rows = await emails(trx, s.mailboxId);
      expect(rows).toHaveLength(2);
      expect(rowOfCopy(rows, 1)).toMatchObject({ folder: "INBOX" });
      expect(rowOfCopy(rows, 1)?.returned_at).toEqual(NOW);
      const later = rowOfCopy(rows, 2);
      expect(later).toMatchObject({ folder: "AI/Spam", returned_at: null });
      expect(Number(later?.uid)).toBe(spamSecond);
      const spamReads = s.fake.folderCalls
        .slice(callsBefore)
        .filter((call) => call.method === "fetchMetaIn" && call.folder === "AI/Spam");
      expect(spamReads).toHaveLength(1);
    });
  });

  test("two identical copies in AI/Spam and a third identical INBOX copy: both copies are located and #3 is stored", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const { spamFirst, spamSecond } = await twoCopiesInSpam(trx, s);
      s.fake.deliver("INBOX", seed(1));
      const callsBefore = s.fake.folderCalls.length;

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.stored).toBe(1);
      expect(result.returned).toBe(0);
      const rows = await emails(trx, s.mailboxId);
      expect(rows).toHaveLength(3);
      const base = rowOfCopy(rows, 1)?.dedup_key ?? "";
      expect(rows.some((row) => row.dedup_key === `${base}#3`)).toBe(true);
      expect(rowOfCopy(rows, 1)).toMatchObject({ folder: "AI/Spam", returned_at: null });
      expect(Number(rowOfCopy(rows, 1)?.uid)).toBe(spamFirst);
      expect(rowOfCopy(rows, 2)).toMatchObject({ folder: "AI/Spam", returned_at: null });
      expect(Number(rowOfCopy(rows, 2)?.uid)).toBe(spamSecond);
      const spamReads = s.fake.folderCalls
        .slice(callsBefore)
        .filter((call) => call.method === "fetchMetaIn" && call.folder === "AI/Spam");
      expect(spamReads).toHaveLength(2);
    });
  });

  test("Interia shape: two identical copies in AI/Spam, the later one comes back below the INBOX cursor and is returned", async () => {
    await withRollback(db, async (trx) => {
      const base = await setup(trx);
      const s = { ...base, fake: createFakeMailProvider({ uidValidity: UID_VALIDITY, keepUidOnUserMove: true }) };
      const { spamFirst, spamSecond } = await twoCopiesInSpam(trx, s);
      expect([spamFirst, spamSecond]).toEqual([1, 2]);
      s.fake.deliver("INBOX", seed(2));
      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(s.fake.userMove("AI/Spam", spamSecond, "INBOX")).toBe(spamSecond);

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.returnedBelowCursor).toBe(1);
      expect(result.stored).toBe(0);
      const rows = (await emails(trx, s.mailboxId)).filter((row) => row.message_id_header === "<m1@x.test>");
      expect(rows).toHaveLength(2);
      expect(rowOfCopy(rows, 2)).toMatchObject({ folder: "INBOX" });
      expect(rowOfCopy(rows, 2)?.returned_at).toEqual(NOW);
      expect(rowOfCopy(rows, 1)).toMatchObject({ folder: "AI/Spam", returned_at: null });
    });
  });

  test("a first copy still in its source folder does not hide a gone later copy: the later copy is returned", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const first = s.fake.deliver("INBOX", seed(1));
      const second = s.fake.deliver("INBOX", seed(1));
      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      const rows = await emails(trx, s.mailboxId);
      const offersUid = s.fake.userMove("INBOX", first, "Oferty");
      await trx
        .updateTable("emails")
        .set({ folder: "Oferty", source_folder: "Oferty", uid: offersUid })
        .where("id", "=", rowOfCopy(rows, 1)?.id ?? "")
        .execute();
      const infoUid = s.fake.userMove("INBOX", second, "AI/Info");
      await trx
        .updateTable("emails")
        .set({ folder: "AI/Info", uid: infoUid, moved_at: hoursAgo(1) })
        .where("id", "=", rowOfCopy(rows, 2)?.id ?? "")
        .execute();
      const back = s.fake.userMove("AI/Info", infoUid, "INBOX");

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.returned).toBe(1);
      expect(result.crossCopies).toBe(0);
      expect(result.stored).toBe(0);
      const after = await emails(trx, s.mailboxId);
      expect(after).toHaveLength(2);
      const later = rowOfCopy(after, 2);
      expect(later).toMatchObject({ folder: "INBOX" });
      expect(Number(later?.uid)).toBe(back);
      expect(later?.returned_at).toEqual(NOW);
      expect(rowOfCopy(after, 1)).toMatchObject({ folder: "Oferty", returned_at: null });
      expect(Number(rowOfCopy(after, 1)?.uid)).toBe(offersUid);
    });
  });

  test("two identical new copies in one chunk are both stored", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      s.fake.deliver("INBOX", seed(1));
      s.fake.deliver("INBOX", seed(1));

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.stored).toBe(2);
      const rows = await emails(trx, s.mailboxId);
      expect(rows[1]?.dedup_key).toBe(`${rows[0]?.dedup_key}#2`);
    });
  });

  test("two identical new copies in two chunks of one run are both stored", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      s.fake.deliver("INBOX", seed(1));
      s.fake.deliver("INBOX", seed(1));

      const result = await syncMailbox(deps(trx, s.fake, { chunkSize: 1 }), s.ctx, s.mailboxId);
      expect(result.stored).toBe(2);
      expect(result.uidUpdated).toBe(0);
      const rows = await emails(trx, s.mailboxId);
      expect(rows.map((row) => Number(row.uid))).toEqual([1, 2]);
      expect(rows[1]?.dedup_key).toBe(`${rows[0]?.dedup_key}#2`);
    });
  });

  test("a mail with the owner's address in From: is stored", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      s.fake.deliver("INBOX", seed(1, { from: s.address }));

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.stored).toBe(1);
      expect(result.skippedOwn).toBe(0);
    });
  });

  test("a mail with a known X-EA-Action-Id is skipped and the cursor moves past it", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      s.fake.deliver("INBOX", seed(1, { headers: { "X-EA-Action-Id": "act-1" } }));
      const isOwnActionId = async (_ctx: TenantContext, _mailboxId: string, actionId: string) => actionId === "act-1";

      const result = await syncMailbox(deps(trx, s.fake, { isOwnActionId }), s.ctx, s.mailboxId);
      expect(result.skippedOwn).toBe(1);
      expect(result.stored).toBe(0);
      expect(await emails(trx, s.mailboxId)).toHaveLength(0);
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: 1 });
    });
  });

  test("the real isOwnActionId skips the mail of a draft of this mailbox and stores a random uuid", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const emailId = await insertTestEmail(trx, s.ctx, s.mailboxId);
      const draftId = await insertAction(trx, s.ctx, emailId, { type: "create_draft", status: "ready" });
      s.fake.deliver("INBOX", seed(1, { headers: { "X-EA-Action-Id": draftId } }));
      s.fake.deliver("INBOX", seed(2, { headers: { "X-EA-Action-Id": crypto.randomUUID() } }));
      const own = (ctx: TenantContext, mailboxId: string, id: string) => isOwnActionId(trx, ctx, mailboxId, id);

      const result = await syncMailbox(deps(trx, s.fake, { isOwnActionId: own }), s.ctx, s.mailboxId);
      expect(result.skippedOwn).toBe(1);
      expect(result.stored).toBe(1);
      const stored = (await emails(trx, s.mailboxId)).filter((row) => row.message_id_header?.startsWith("<m"));
      expect(stored.map((row) => row.message_id_header)).toEqual(["<m2@x.test>"]);
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: 2 });
    });
  });

  test("two syncs in a row store each mail once", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      s.fake.deliver("INBOX", seed(1));
      s.fake.deliver("INBOX", seed(2));

      const first = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      const { folders, failed, skipped, added, ...inboxResult } = first;
      expect(folders).toHaveLength(1);
      expect([failed, skipped, added]).toEqual([[], [], []]);
      expect(inboxResult).toEqual({
        folder: "inbox",
        mode: "incremental",
        fetched: 2,
        stored: 2,
        captureMissing: 0,
        uidUpdated: 0,
        returned: 0,
        relocated: 0,
        crossCopies: 0,
        returnedBelowCursor: 0,
        copiesBelowCursor: 0,
        copiesStored: 0,
        moveInFlight: 0,
        skippedOwn: 0,
        ignoredBelowCursor: 0,
      });
      s.fake.deliver("INBOX", seed(3));
      const second = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(second.stored).toBe(1);

      const rows = await emails(trx, s.mailboxId);
      expect(rows.map((row) => Number(row.uid))).toEqual([1, 2, 3]);
      expect(rows[0]?.body_text).toBe("Body 1");
      expect(rows[0]?.status).toBe("pending");
      expect(rows[0]?.references_header).toBeNull();
    });
  });

  test("120 mails with chunkSize 50 commit in 3 chunks", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      for (let n = 1; n <= 120; n += 1) s.fake.deliver("INBOX", seed(n));
      const cursorsSeen = new Set<number>();
      const provider = onBodyCall(s.fake, async () => {
        cursorsSeen.add((await cursorOf(trx, s.mailboxId)).lastUid);
      });

      const result = await syncMailbox(deps(trx, provider, { chunkSize: 50 }), s.ctx, s.mailboxId);
      expect(result.stored).toBe(120);
      expect([...cursorsSeen]).toEqual([0, 50, 100]);
      expect(await emails(trx, s.mailboxId)).toHaveLength(120);
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: 120 });
    });
  });

  test("the body text is cut to 100 000 characters", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      s.fake.deliver("INBOX", seed(1, { text: "a".repeat(100_010) }));

      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      const rows = await emails(trx, s.mailboxId);
      expect(rows[0]?.body_text).toHaveLength(100_000);
    });
  });

  test("a crash in the second chunk keeps chunk 1 and the next run stores the rest", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      for (let n = 1; n <= 5; n += 1) s.fake.deliver("INBOX", seed(n));
      const provider = onBodyCall(s.fake, async (call) => {
        if (call === 3) s.fake.failOn("fetchContent", new SoftError("x"), 1);
      });

      await expect(syncMailbox(deps(trx, provider, { chunkSize: 2 }), s.ctx, s.mailboxId)).rejects.toBeInstanceOf(
        SoftError
      );
      expect((await emails(trx, s.mailboxId)).map((row) => Number(row.uid))).toEqual([1, 2]);
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: 2 });

      const next = await syncMailbox(deps(trx, s.fake, { chunkSize: 2 }), s.ctx, s.mailboxId);
      expect(next.stored).toBe(3);
      const rows = await emails(trx, s.mailboxId);
      expect(rows.map((row) => Number(row.uid))).toEqual([1, 2, 3, 4, 5]);
      expect(new Set(rows.map((row) => row.dedup_key)).size).toBe(5);
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: 5 });
    });
  });

  test("a cursor moved by another run between two chunks gives CursorMovedError", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      s.fake.deliver("INBOX", seed(1));
      s.fake.deliver("INBOX", seed(2));
      const provider = onBodyCall(s.fake, async (call) => {
        if (call === 2) {
          await trx
            .updateTable("mailbox_folders")
            .set({ last_uid: 99 })
            .where("mailbox_id", "=", s.mailboxId)
            .where("key", "=", "inbox")
            .execute();
        }
      });

      await expect(syncMailbox(deps(trx, provider, { chunkSize: 1 }), s.ctx, s.mailboxId)).rejects.toBeInstanceOf(
        CursorMovedError
      );
      expect((await emails(trx, s.mailboxId)).map((row) => Number(row.uid))).toEqual([1]);
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: 99 });
    });
  });

  test("without an outer transaction each chunk commits in its own transaction", async () => {
    const created = await db.transaction().execute((trx) => createOrgWithMailbox(trx));
    const ctx = { orgId: created.orgId };
    try {
      expect(
        await updateCursor(
          db,
          ctx,
          created.mailboxId,
          { uidValidity: null, lastUid: null },
          { uidValidity: UID_VALIDITY, lastUid: 0 }
        )
      ).toBe(true);
      const fake = createFakeMailProvider({ uidValidity: UID_VALIDITY });
      for (let n = 1; n <= 3; n += 1) fake.deliver("INBOX", seed(n));
      const provider = onBodyCall(fake, async (call) => {
        if (call === 3) fake.failOn("fetchContent", new SoftError("x"), 1);
      });

      await expect(syncMailbox(deps(db, provider, { chunkSize: 2 }), ctx, created.mailboxId)).rejects.toBeInstanceOf(
        SoftError
      );
      expect((await emails(db, created.mailboxId)).map((row) => Number(row.uid))).toEqual([1, 2]);
      expect(await cursorOf(db, created.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: 2 });

      const next = await syncMailbox(deps(db, fake, { chunkSize: 2 }), ctx, created.mailboxId);
      expect(next.stored).toBe(1);
      expect((await emails(db, created.mailboxId)).map((row) => Number(row.uid))).toEqual([1, 2, 3]);
      expect(await cursorOf(db, created.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: 3 });
    } finally {
      await db.deleteFrom("organizations").where("id", "=", created.orgId).execute();
      await db.deleteFrom("users").where("id", "=", created.userId).execute();
    }
  });

  test("after an outage all 50 mails above the cursor are stored", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      for (let n = 1; n <= 50; n += 1) s.fake.deliver("INBOX", seed(n), { internalDate: hoursAgo(24 * 10) });

      const result = await syncMailbox(deps(trx, s.fake, { chunkSize: 20 }), s.ctx, s.mailboxId);
      expect(result.mode).toBe("incremental");
      expect(result.stored).toBe(50);
      expect(await emails(trx, s.mailboxId)).toHaveLength(50);
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: 50 });
    });
  });
});

// Mailbox with no cursor: the first sync is `initial`.
async function setupNew(trx: Transaction<DB>): Promise<Setup> {
  const { orgId, mailboxId } = await createOrgWithMailbox(trx);
  const mailbox = await trx
    .selectFrom("mailboxes")
    .select("address")
    .where("id", "=", mailboxId)
    .executeTakeFirstOrThrow();
  return {
    ctx: { orgId },
    mailboxId,
    address: mailbox.address,
    fake: createFakeMailProvider({ uidValidity: UID_VALIDITY }),
  };
}

// Three known mails at uids 3, 4, 5, then a UIDVALIDITY change renumbers them to 1, 2, 3.
async function setupKnown(trx: Transaction<DB>): Promise<Setup> {
  const s = await setup(trx);
  for (let n = 1; n <= 2; n += 1) s.fake.remove("INBOX", s.fake.deliver("INBOX", seed(100 + n)));
  for (let n = 1; n <= 3; n += 1) s.fake.deliver("INBOX", seed(n), { internalDate: hoursAgo(24 * n) });
  const first = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
  expect(first.stored).toBe(3);
  expect((await emails(trx, s.mailboxId)).map((row) => Number(row.uid))).toEqual([3, 4, 5]);
  return s;
}

describe("syncMailbox: initial", () => {
  test("the first sync stores only the last 24 hours and sets the cursor", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupNew(trx);
      s.fake.deliver("INBOX", seed(1), { internalDate: hoursAgo(24 * 3) });
      s.fake.deliver("INBOX", seed(2), { internalDate: hoursAgo(25) });
      s.fake.deliver("INBOX", seed(3), { internalDate: hoursAgo(23) });
      s.fake.deliver("INBOX", seed(4), { internalDate: hoursAgo(2) });

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.mode).toBe("initial");
      expect(result.stored).toBe(2);
      expect((await emails(trx, s.mailboxId)).map((row) => Number(row.uid))).toEqual([3, 4]);
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: 4 });

      s.fake.deliver("INBOX", seed(5), { internalDate: hoursAgo(1) });
      const next = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(next.mode).toBe("incremental");
      expect(next.stored).toBe(1);
      expect((await emails(trx, s.mailboxId)).map((row) => Number(row.uid))).toEqual([3, 4, 5]);
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: 5 });
    });
  });

  test("a mail delivered after folderStatus and before the search is stored and sets the cursor", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupNew(trx);
      s.fake.deliver("INBOX", seed(1), { internalDate: hoursAgo(2) });
      let late = 0;
      const provider = afterFirstCall(s.fake, "folderStatus", () => {
        late = s.fake.deliver("INBOX", seed(2), { internalDate: hoursAgo(1) });
      });

      const result = await syncMailbox(deps(trx, provider), s.ctx, s.mailboxId);
      expect(result.mode).toBe("initial");
      expect(result.stored).toBe(2);
      expect(late).toBe(2);
      expect((await emails(trx, s.mailboxId)).map((row) => Number(row.uid))).toEqual([1, late]);
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: late });
    });
  });

  test("a mail delivered after the search is left for the next incremental sync", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupNew(trx);
      s.fake.deliver("INBOX", seed(1), { internalDate: hoursAgo(2) });
      const { uidNext } = await s.fake.folderStatus("INBOX");
      let late = 0;
      const provider = afterFirstCall(s.fake, "searchSinceIn", () => {
        late = s.fake.deliver("INBOX", seed(2), { internalDate: hoursAgo(1) });
      });

      const result = await syncMailbox(deps(trx, provider), s.ctx, s.mailboxId);
      expect(result.mode).toBe("initial");
      expect(result.stored).toBe(1);
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: uidNext - 1 });

      const next = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(next.mode).toBe("incremental");
      expect(next.stored).toBe(1);
      expect((await emails(trx, s.mailboxId)).map((row) => Number(row.uid))).toEqual([1, late]);
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: late });
    });
  });

  test("an empty INBOX sets the cursor to uidNext - 1", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupNew(trx);
      s.fake.remove("INBOX", s.fake.deliver("INBOX", seed(1)));
      s.fake.remove("INBOX", s.fake.deliver("INBOX", seed(2)));

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.mode).toBe("initial");
      expect(result.stored).toBe(0);
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: 2 });
    });
  });

  test("chunks of the first sync do not move the cursor; it is set after the last chunk", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupNew(trx);
      for (let n = 1; n <= 5; n += 1) s.fake.deliver("INBOX", seed(n), { internalDate: hoursAgo(1) });
      const cursorsSeen: unknown[] = [];
      const provider = onBodyCall(s.fake, async () => {
        cursorsSeen.push(
          await trx
            .selectFrom("mailbox_folders")
            .select(["uidvalidity", "last_uid"])
            .where("mailbox_id", "=", s.mailboxId)
            .where("key", "=", "inbox")
            .executeTakeFirstOrThrow()
        );
      });

      const result = await syncMailbox(deps(trx, provider, { chunkSize: 2 }), s.ctx, s.mailboxId);
      expect(result.stored).toBe(5);
      expect(cursorsSeen).toEqual(Array.from({ length: 5 }, () => ({ uidvalidity: null, last_uid: null })));
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: 5 });
    });
  });

  test("a crash in the middle of the first sync keeps no cursor; the next run has no duplicate", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupNew(trx);
      for (let n = 1; n <= 3; n += 1) s.fake.deliver("INBOX", seed(n), { internalDate: hoursAgo(1) });
      const provider = onBodyCall(s.fake, async (call) => {
        if (call === 3) s.fake.failOn("fetchContent", new SoftError("x"), 1);
      });

      await expect(syncMailbox(deps(trx, provider, { chunkSize: 2 }), s.ctx, s.mailboxId)).rejects.toBeInstanceOf(
        SoftError
      );
      expect((await emails(trx, s.mailboxId)).map((row) => Number(row.uid))).toEqual([1, 2]);
      const row = await trx
        .selectFrom("mailbox_folders")
        .select(["uidvalidity", "last_uid"])
        .where("mailbox_id", "=", s.mailboxId)
        .where("key", "=", "inbox")
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ uidvalidity: null, last_uid: null });

      const next = await syncMailbox(deps(trx, s.fake, { chunkSize: 2 }), s.ctx, s.mailboxId);
      expect(next.mode).toBe("initial");
      expect(next.stored).toBe(1);
      expect(next.uidUpdated).toBe(2);
      expect((await emails(trx, s.mailboxId)).map((row) => Number(row.uid))).toEqual([1, 2, 3]);
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: 3 });
    });
  });
});

describe("syncMailbox: rescan", () => {
  test("a UIDVALIDITY change gives known mail its new uid and stores only the new mail", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupKnown(trx);
      await trx.updateTable("emails").set({ status: "triaged" }).where("mailbox_id", "=", s.mailboxId).execute();
      s.fake.resetUidValidity(UID_VALIDITY + 1);
      s.fake.deliver("INBOX", seed(4), { internalDate: hoursAgo(1) });

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.mode).toBe("rescan");
      expect(result.stored).toBe(1);
      expect(result.uidUpdated).toBe(3);
      const rows = await emails(trx, s.mailboxId);
      expect(rows).toHaveLength(4);
      expect(rows.map((row) => [Number(row.uid), row.message_id_header, row.status])).toEqual([
        [1, "<m1@x.test>", "triaged"],
        [2, "<m2@x.test>", "triaged"],
        [3, "<m3@x.test>", "triaged"],
        [4, "<m4@x.test>", "pending"],
      ]);
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY + 1, lastUid: 4 });

      const next = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(next.mode).toBe("incremental");
      expect(next.stored).toBe(0);
    });
  });

  test("forceRescan makes the next sync a rescan that stores no duplicate", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupKnown(trx);
      expect(await forceRescan(trx, s.ctx, s.mailboxId)).toBe(true);

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.mode).toBe("rescan");
      expect(result.stored).toBe(0);
      expect(await emails(trx, s.mailboxId)).toHaveLength(3);
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: 5 });

      expect((await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId)).mode).toBe("incremental");
    });
  });

  test("a crash in the middle of a rescan keeps the old UIDVALIDITY; the next run has no duplicate", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupKnown(trx);
      s.fake.resetUidValidity(UID_VALIDITY + 1);
      s.fake.deliver("INBOX", seed(4), { internalDate: hoursAgo(1) });
      s.fake.failOn("fetchContent", new SoftError("x"), 1);

      await expect(syncMailbox(deps(trx, s.fake, { chunkSize: 2 }), s.ctx, s.mailboxId)).rejects.toBeInstanceOf(
        SoftError
      );
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: 5 });
      expect((await emails(trx, s.mailboxId)).map((row) => Number(row.uid))).toEqual([1, 2, 5]);

      const next = await syncMailbox(deps(trx, s.fake, { chunkSize: 2 }), s.ctx, s.mailboxId);
      expect(next.mode).toBe("rescan");
      expect(next.stored).toBe(1);
      const rows = await emails(trx, s.mailboxId);
      expect(rows.map((row) => Number(row.uid))).toEqual([1, 2, 3, 4]);
      expect(new Set(rows.map((row) => row.dedup_key)).size).toBe(4);
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY + 1, lastUid: 4 });
    });
  });

  test("a mail 8 days old in INBOX is not read again by a rescan", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupKnown(trx);
      s.fake.deliver("INBOX", seed(9), { internalDate: hoursAgo(24 * 8) });
      s.fake.resetUidValidity(UID_VALIDITY + 1);

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.mode).toBe("rescan");
      expect(result.stored).toBe(0);
      expect(result.uidUpdated).toBe(3);
      const rows = await emails(trx, s.mailboxId);
      expect(rows.map((row) => row.message_id_header)).toEqual(["<m1@x.test>", "<m2@x.test>", "<m3@x.test>"]);
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY + 1, lastUid: 4 });

      const next = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(next.mode).toBe("incremental");
      expect(next.stored).toBe(0);
      expect(await emails(trx, s.mailboxId)).toHaveLength(3);
    });
  });
});

interface FolderCall {
  method: "fetchMetaIn" | "searchSinceIn" | "fetchByUidsIn";
  folder: string;
  uids?: number[];
}

// The fake with a record of the folder-aware read calls.
function spyFolderReads(fake: FakeMailProvider): { provider: MailProvider; folderCalls: FolderCall[] } {
  const folderCalls: FolderCall[] = [];
  const provider: MailProvider = {
    ...fake,
    fetchMetaIn: (folder, uid) => {
      folderCalls.push({ method: "fetchMetaIn", folder, uids: [uid] });
      return fake.fetchMetaIn(folder, uid);
    },
    searchSinceIn: (folder, since) => {
      folderCalls.push({ method: "searchSinceIn", folder });
      return fake.searchSinceIn(folder, since);
    },
    fetchByUidsIn: (folder, uids) => {
      folderCalls.push({ method: "fetchByUidsIn", folder, uids });
      return fake.fetchByUidsIn(folder, uids);
    },
  };
  return { provider, folderCalls };
}

async function movedRowOf(trx: Db | Transaction<DB>, mailboxId: string) {
  const row = await trx
    .selectFrom("emails")
    .select(["id", "uid", "source_uid", "folder", "returned_at", "moved_at"])
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirstOrThrow();
  return { ...row, uid: Number(row.uid), source_uid: Number(row.source_uid) };
}

// Every row of the mailbox with its capture row, in UID order.
async function copyRowsOf(trx: Db | Transaction<DB>, mailboxId: string) {
  const rows = await trx
    .selectFrom("emails")
    .leftJoin("email_headers", "email_headers.email_id", "emails.id")
    .select([
      "emails.id",
      "emails.dedup_key",
      "emails.folder",
      "emails.source_folder",
      "emails.uid",
      "emails.source_uid",
      "emails.status",
      "emails.body_text",
      "emails.received_at",
      "emails.returned_at",
      "emails.move_pending_at",
      "email_headers.email_id as header_id",
    ])
    .where("emails.mailbox_id", "=", mailboxId)
    .orderBy("emails.dedup_key")
    .execute();
  return rows.map((row) => ({ ...row, uid: Number(row.uid), source_uid: Number(row.source_uid) }));
}

// Runs `fn` with the debug level on and returns the lines that the logger wrote. Resets the level.
async function withDebugLines(fn: () => Promise<void>): Promise<string[]> {
  const out = spyOn(console, "log").mockImplementation(() => undefined);
  const err = spyOn(console, "error").mockImplementation(() => undefined);
  setLogLevel("debug");
  try {
    await fn();
    return [...out.mock.calls, ...err.mock.calls].map((call) => format(...call));
  } finally {
    setLogLevel("info");
    out.mockRestore();
    err.mockRestore();
  }
}

describe("syncMailbox: returned mail below the cursor", () => {
  const interia = (): FakeMailProvider =>
    createFakeMailProvider({ uidValidity: UID_VALIDITY, keepUidOnUserMove: true, capabilities: { move: false } });

  // A stored mail (INBOX uid `uid`) that the system "moved" to AI/Info an hour ago.
  async function storeAndMark(trx: Transaction<DB>, s: Setup, movedAt: Date = hoursAgo(1)): Promise<number> {
    const uid = s.fake.deliver("INBOX", seed(1));
    await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
    await trx
      .updateTable("emails")
      .set({ folder: "AI/Info", moved_at: movedAt })
      .where("mailbox_id", "=", s.mailboxId)
      .execute();
    return uid;
  }

  test("a user move back that keeps the uid sets returned_at after the folder check found nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      const uid = await storeAndMark(trx, s);
      expect(s.fake.userMove("INBOX", uid, "AI/Info")).toBe(uid);
      expect(s.fake.userMove("AI/Info", uid, "INBOX")).toBe(uid);
      const before = await cursorOf(trx, s.mailboxId);
      const spy = spyFolderReads(s.fake);

      const result = await syncMailbox(deps(trx, spy.provider), s.ctx, s.mailboxId);
      expect(result.returnedBelowCursor).toBe(1);
      expect(result.copiesBelowCursor).toBe(0);
      expect(result.returned).toBe(0);
      expect(result.stored).toBe(0);
      const row = await movedRowOf(trx, s.mailboxId);
      expect(row.returned_at).toBeInstanceOf(Date);
      expect(row).toMatchObject({ folder: "INBOX", uid, source_uid: uid });
      expect(await cursorOf(trx, s.mailboxId)).toEqual(before);
      expect(await emails(trx, s.mailboxId)).toHaveLength(1);
      expect(spy.folderCalls.filter((call) => call.folder === "AI/Info").map((call) => call.method)).toEqual([
        "fetchMetaIn",
        "searchSinceIn",
      ]);
    });
  });

  test("a copy back to INBOX that leaves the mail in its folder is stored as #2", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      const uid = await storeAndMark(trx, s);
      const inFolder = s.fake.deliver("AI/Info", seed(1));
      await trx.updateTable("emails").set({ uid: inFolder }).where("mailbox_id", "=", s.mailboxId).execute();
      const [moved] = await copyRowsOf(trx, s.mailboxId);
      const before = await cursorOf(trx, s.mailboxId);
      const copyMeta = await s.fake.fetchMetaIn("INBOX", uid);

      let result: MailboxSyncResult | undefined;
      const debugLines = await withDebugLines(async () => {
        result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      });
      expect(debugLines.filter((line) => line.includes("sync_below_cursor_copy "))).toEqual([
        `[mail] sync_below_cursor_copy org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} email_id=${moved?.id}`,
      ]);
      if (result === undefined) throw new Error("no result");
      expect(result.copiesBelowCursor).toBe(1);
      expect(result.copiesStored).toBe(1);
      expect(result.stored).toBe(1);
      expect(result.captureMissing).toBe(0);
      expect(result.returnedBelowCursor).toBe(0);

      const rows = await copyRowsOf(trx, s.mailboxId);
      expect(rows).toHaveLength(2);
      const copy = rows.find((row) => row.id !== moved?.id);
      expect(copy).toMatchObject({
        dedup_key: `${moved?.dedup_key}#2`,
        folder: "INBOX",
        source_folder: "INBOX",
        uid,
        source_uid: uid,
        status: "pending",
        body_text: "Body 1",
        returned_at: null,
      });
      expect(copy?.received_at.getTime()).toBe(copyMeta?.internalDate.getTime());
      // The copy has a capture row (2.5).
      expect(copy?.header_id).toBe(copy?.id);
      expect(rows.find((row) => row.id === moved?.id)).toEqual(moved);
      expect(await cursorOf(trx, s.mailboxId)).toEqual(before);

      // A second sync counts and stores nothing (2.2).
      const info = await withDebugLines(async () => {
        const again = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
        expect(again.copiesBelowCursor).toBe(0);
        expect(again.copiesStored).toBe(0);
        expect(again.stored).toBe(0);
        expect(again.returnedBelowCursor).toBe(0);
      });
      expect(
        info.some((line) =>
          line.endsWith(
            `sync_below_cursor_done org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} folder_key=inbox checked=1 returned=0 copies=0`
          )
        )
      ).toBe(true);
      expect(info.some((line) => line.includes("sync_below_cursor_copies_stored"))).toBe(false);
      expect(await copyRowsOf(trx, s.mailboxId)).toHaveLength(2);
    });
  });

  test("a stored copy logs the stored count once and no skip line", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      await storeAndMark(trx, s);
      const inFolder = s.fake.deliver("AI/Info", seed(1));
      await trx.updateTable("emails").set({ uid: inFolder }).where("mailbox_id", "=", s.mailboxId).execute();

      const lines = await withDebugLines(async () => {
        await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      });
      const stored = lines.filter((line) => line.includes("sync_below_cursor_copies_stored"));
      expect(stored).toHaveLength(1);
      expect(stored[0]).toContain(`mailbox_id=${s.mailboxId}`);
      expect(stored[0]).toContain("folder_key=inbox");
      expect(stored[0]).toContain("count=1");
      expect(lines.some((line) => line.includes("sync_below_cursor_copy_skipped"))).toBe(false);
    });
  });

  test("a copy that another run stored while this check fetched the body is not stored again", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      const uid = await storeAndMark(trx, s);
      const inFolder = s.fake.deliver("AI/Info", seed(1));
      await trx.updateTable("emails").set({ uid: inFolder }).where("mailbox_id", "=", s.mailboxId).execute();
      const [moved] = await copyRowsOf(trx, s.mailboxId);
      if (moved === undefined) throw new Error("no moved row");
      const full = await trx.selectFrom("emails").selectAll().where("id", "=", moved.id).executeTakeFirstOrThrow();
      const provider = onBodyCall(s.fake, async () => {
        await insertTestEmail(trx, s.ctx, s.mailboxId, {
          // Another number than the planned #2: only the re-check inside the lock stops this check.
          dedup_key: `${moved.dedup_key}#3`,
          message_id_header: full.message_id_header,
          content_hash: full.content_hash,
          folder: "INBOX",
          uid,
          source_uid: uid,
        });
      });

      let result: MailboxSyncResult | undefined;
      const lines = await withDebugLines(async () => {
        result = await syncMailbox(deps(trx, provider), s.ctx, s.mailboxId);
      });
      expect(result?.copiesBelowCursor).toBe(1);
      expect(result?.copiesStored).toBe(0);
      expect(result?.stored).toBe(0);
      const rows = await copyRowsOf(trx, s.mailboxId);
      expect(rows.filter((row) => row.folder === "INBOX")).toHaveLength(1);
      expect(rows).toHaveLength(2);
      const skipped = lines.filter((line) => line.includes("sync_below_cursor_copy_skipped"));
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toContain("kind=held");
      // The id is the moved row's id, never a run id (a run id holds the Message-ID).
      expect(skipped[0]).toContain(`email_id=${moved.id}`);
      expect(skipped[0]).toContain(`mailbox_id=${s.mailboxId}`);
    });
  });

  test("a copy whose mail gets an Undo marker while this check fetched the body is not stored", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      await storeAndMark(trx, s);
      const inFolder = s.fake.deliver("AI/Info", seed(1));
      await trx.updateTable("emails").set({ uid: inFolder }).where("mailbox_id", "=", s.mailboxId).execute();
      const [moved] = await copyRowsOf(trx, s.mailboxId);
      const provider = onBodyCall(s.fake, async () => {
        await trx
          .updateTable("emails")
          .set({ move_pending_at: NOW })
          .where("id", "=", moved?.id ?? "")
          .execute();
      });

      let result: MailboxSyncResult | undefined;
      const lines = await withDebugLines(async () => {
        result = await syncMailbox(deps(trx, provider), s.ctx, s.mailboxId);
      });
      expect(result?.copiesStored).toBe(0);
      expect(result?.stored).toBe(0);
      expect(await copyRowsOf(trx, s.mailboxId)).toHaveLength(1);
      const skipped = lines.filter((line) => line.includes("sync_below_cursor_copy_skipped"));
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toContain("kind=move_in_flight");
      expect(skipped[0]).toContain(`email_id=${moved?.id}`);
    });
  });

  test("an identical copy that stays in INBOX at the hit uid is no return", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      const uid = await storeAndMark(trx, s);
      const moved = await trx
        .selectFrom("emails")
        .selectAll()
        .where("mailbox_id", "=", s.mailboxId)
        .executeTakeFirstOrThrow();
      await insertTestEmail(trx, s.ctx, s.mailboxId, {
        message_id_header: moved.message_id_header,
        content_hash: moved.content_hash,
        folder: "INBOX",
        uid,
        source_uid: uid,
      });

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.returnedBelowCursor).toBe(0);
      expect(result.copiesBelowCursor).toBe(0);
      const after = await trx.selectFrom("emails").selectAll().where("id", "=", moved.id).executeTakeFirstOrThrow();
      expect(after).toEqual(moved);
    });
  });

  test("a mail back at its uid with \\Deleted is no hit and gets no folder check", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      const uid = await storeAndMark(trx, s);
      s.fake.userMove("INBOX", uid, "AI/Info");
      s.fake.userMove("AI/Info", uid, "INBOX");
      await s.fake.setFlags("INBOX", uid, { add: ["\\Deleted"] });
      const spy = spyFolderReads(s.fake);

      const result = await syncMailbox(deps(trx, spy.provider), s.ctx, s.mailboxId);
      expect(result.returnedBelowCursor).toBe(0);
      expect(result.copiesBelowCursor).toBe(0);
      expect(spy.folderCalls.map((call) => call.method)).toEqual(["fetchByUidsIn"]);
      expect((await movedRowOf(trx, s.mailboxId)).returned_at).toBeNull();
    });
  });

  test("a move older than 7 days is not checked", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      const uid = await storeAndMark(trx, s, hoursAgo(8 * 24));
      s.fake.userMove("INBOX", uid, "AI/Info");
      s.fake.userMove("AI/Info", uid, "INBOX");
      const spy = spyFolderReads(s.fake);

      const result = await syncMailbox(deps(trx, spy.provider), s.ctx, s.mailboxId);
      expect(result.returnedBelowCursor).toBe(0);
      expect(spy.folderCalls).toEqual([]);
      expect((await movedRowOf(trx, s.mailboxId)).returned_at).toBeNull();
    });
  });

  test("a row with folder INBOX is not in the list", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      s.fake.deliver("INBOX", seed(1));
      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      await trx
        .updateTable("emails")
        .set({ moved_at: hoursAgo(1) })
        .where("mailbox_id", "=", s.mailboxId)
        .execute();
      const spy = spyFolderReads(s.fake);

      const result = await syncMailbox(deps(trx, spy.provider), s.ctx, s.mailboxId);
      expect(result.returnedBelowCursor).toBe(0);
      expect(spy.folderCalls).toEqual([]);
    });
  });

  test("120 moved rows give two fetchByUidsIn calls; the first holds the newest rows", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      for (let n = 1; n <= 120; n += 1) {
        await insertTestEmail(trx, s.ctx, s.mailboxId, {
          dedup_key: `moved:${n}`,
          message_id_header: `<moved${n}@x.test>`,
          folder: "AI/Info",
          uid: n,
          source_uid: n,
          moved_at: new Date(NOW.getTime() - n * 60_000),
        });
      }
      const spy = spyFolderReads(s.fake);

      const result = await syncMailbox(deps(trx, spy.provider), s.ctx, s.mailboxId);
      expect(result.returnedBelowCursor).toBe(0);
      expect(spy.folderCalls.map((call) => call.method)).toEqual(["fetchByUidsIn", "fetchByUidsIn"]);
      expect(spy.folderCalls.map((call) => call.folder)).toEqual(["INBOX", "INBOX"]);
      expect(spy.folderCalls[0]?.uids).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
      expect(spy.folderCalls[1]?.uids).toEqual(Array.from({ length: 20 }, (_, i) => i + 101));
    });
  });

  test("another mail at the uid of a moved row is no return", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      const uid = s.fake.deliver("INBOX", seed(2));
      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      const movedId = await insertTestEmail(trx, s.ctx, s.mailboxId, {
        dedup_key: "moved:1",
        message_id_header: "<m1@x.test>",
        folder: "AI/Info",
        uid: 1,
        source_uid: uid,
        moved_at: hoursAgo(1),
      });

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.returnedBelowCursor).toBe(0);
      expect(result.copiesBelowCursor).toBe(0);
      const row = await trx
        .selectFrom("emails")
        .select(["returned_at", "folder"])
        .where("id", "=", movedId)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ returned_at: null, folder: "AI/Info" });
    });
  });

  test("RFC shape: a returned mail above the cursor is marked once by the normal path", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = await storeAndMark(trx, s);
      const inFolder = s.fake.userMove("INBOX", uid, "AI/Info");
      await trx.updateTable("emails").set({ uid: inFolder }).where("mailbox_id", "=", s.mailboxId).execute();
      const back = s.fake.userMove("AI/Info", inFolder, "INBOX");
      expect(back).toBeGreaterThan(uid);

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.returned).toBe(1);
      expect(result.returnedBelowCursor).toBe(0);
      const row = await movedRowOf(trx, s.mailboxId);
      expect(row.returned_at).toBeInstanceOf(Date);
      expect(row).toMatchObject({ folder: "INBOX", uid: back, source_uid: back });
    });
  });

  test("the system COPY shape: the folder uid differs, the cursor passed it, the user move back is found", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      const sourceUid = s.fake.deliver("INBOX", seed(1));
      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      // Three mails in AI/Info already: the system COPY gives the moved mail the folder uid 4.
      for (const n of [11, 12, 13]) s.fake.deliver("AI/Info", seed(n));
      const folderUid = s.fake.userMove("INBOX", sourceUid, "AI/Info");
      expect(folderUid).toBe(4);
      expect(folderUid).not.toBe(sourceUid);
      await trx
        .updateTable("emails")
        .set({ folder: "AI/Info", uid: folderUid, moved_at: hoursAgo(1) })
        .where("mailbox_id", "=", s.mailboxId)
        .execute();
      // New INBOX mail moves the cursor past the folder uid; the INBOX uid 4 stays free.
      for (const n of [2, 3, 4, 5, 6]) s.fake.deliver("INBOX", seed(n));
      s.fake.remove("INBOX", 4);
      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect((await cursorOf(trx, s.mailboxId)).lastUid).toBeGreaterThan(folderUid);

      expect(s.fake.userMove("AI/Info", folderUid, "INBOX")).toBe(folderUid);
      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.returnedBelowCursor).toBe(1);
      expect(result.copiesBelowCursor).toBe(0);
      const row = await trx
        .selectFrom("emails")
        .select(["uid", "source_uid", "folder", "returned_at"])
        .where("mailbox_id", "=", s.mailboxId)
        .where("folder", "=", "INBOX")
        .where("returned_at", "is not", null)
        .executeTakeFirstOrThrow();
      expect({ uid: Number(row.uid), source_uid: Number(row.source_uid), folder: row.folder }).toEqual({
        uid: folderUid,
        source_uid: folderUid,
        folder: "INBOX",
      });
      expect(row.returned_at).toBeInstanceOf(Date);
    });
  });

  // The Interia shape with one UID counter for the mailbox (UIDs never collide across folders by chance).
  const interiaGlobal = (): FakeMailProvider =>
    createFakeMailProvider({
      uidValidity: UID_VALIDITY,
      globalUids: true,
      keepUidOnUserMove: true,
      capabilities: { move: false },
    });

  const skipLines = (lines: string[]): string[] =>
    lines.filter((line) => line.includes("sync_below_cursor_copy_skipped"));

  // The mail of the only row sits in AI/Info too (a copy at the folder UID); the row points at that UID.
  async function putInFolder(trx: Transaction<DB>, s: Setup): Promise<number> {
    const inFolder = s.fake.deliver("AI/Info", seed(1));
    await trx.updateTable("emails").set({ uid: inFolder }).where("mailbox_id", "=", s.mailboxId).execute();
    return inFolder;
  }

  test("3.1 a fresh move marker holds the copy back; an old marker does not", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      await storeAndMark(trx, s);
      const inFolder = s.fake.deliver("AI/Info", seed(1));
      await trx
        .updateTable("emails")
        .set({ uid: inFolder, move_pending_at: hoursAgo(1) })
        .where("mailbox_id", "=", s.mailboxId)
        .execute();
      const [moved] = await copyRowsOf(trx, s.mailboxId);
      if (moved === undefined) throw new Error("no moved row");

      let held: MailboxSyncResult | undefined;
      const lines = await withDebugLines(async () => {
        held = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      });
      expect(held?.copiesBelowCursor).toBe(1);
      expect(held?.copiesStored).toBe(0);
      expect(held?.stored).toBe(0);
      expect(await copyRowsOf(trx, s.mailboxId)).toEqual([moved]);
      const skipped = skipLines(lines);
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toContain("kind=move_in_flight");
      expect(skipped[0]).toContain(`email_id=${moved.id}`);

      await trx
        .updateTable("emails")
        .set({ move_pending_at: hoursAgo(25) })
        .where("id", "=", moved.id)
        .execute();
      const later = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(later.copiesBelowCursor).toBe(1);
      expect(later.copiesStored).toBe(1);
      const rows = await copyRowsOf(trx, s.mailboxId);
      expect(rows.map((row) => row.dedup_key)).toEqual([moved.dedup_key, `${moved.dedup_key}#2`]);
    });
  });

  test("3.4 a copy number that another row of the identity holds is not stored and raises no error", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      await storeAndMark(trx, s);
      await putInFolder(trx, s);
      const [moved] = await copyRowsOf(trx, s.mailboxId);
      if (moved === undefined) throw new Error("no moved row");
      const full = await trx.selectFrom("emails").selectAll().where("id", "=", moved.id).executeTakeFirstOrThrow();
      // Not moved, in a folder that no pass reads, so the count is 2 and the key #3 is taken.
      await insertTestEmail(trx, s.ctx, s.mailboxId, {
        dedup_key: `${moved.dedup_key}#3`,
        message_id_header: full.message_id_header,
        content_hash: full.content_hash,
        folder: "AI/Spam",
        source_folder: "AI/Spam",
        uid: 9000,
        source_uid: 9000,
      });

      let result: MailboxSyncResult | undefined;
      const lines = await withDebugLines(async () => {
        result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      });
      expect(result?.copiesBelowCursor).toBe(1);
      expect(result?.copiesStored).toBe(0);
      expect(result?.stored).toBe(0);
      expect(await copyRowsOf(trx, s.mailboxId)).toHaveLength(2);
      const skipped = skipLines(lines);
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toContain("kind=not_inserted");
      expect(skipped[0]).toContain(`email_id=${moved.id}`);
    });
  });

  // Two rows of one identity (#1, #2), both moved to AI/Info with an own folder UID, both originals still in INBOX.
  async function twoMovedRows(trx: Transaction<DB>, s: Setup): Promise<{ key: string; ids: string[] }> {
    s.fake.deliver("INBOX", seed(1));
    s.fake.deliver("INBOX", seed(1));
    await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
    const rows = await copyRowsOf(trx, s.mailboxId);
    expect(rows).toHaveLength(2);
    const ids: string[] = [];
    for (const row of rows) {
      const inFolder = s.fake.deliver("AI/Info", seed(1));
      await trx
        .updateTable("emails")
        .set({ folder: "AI/Info", uid: inFolder, moved_at: hoursAgo(rows.indexOf(row) === 0 ? 1 / 60 : 5) })
        .where("id", "=", row.id)
        .execute();
      ids.push(row.id);
    }
    return { key: rows[0]?.dedup_key ?? "", ids };
  }

  test("3.5 two moved rows of one identity: one sync stores #3 and #4", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interiaGlobal() };
      const { key } = await twoMovedRows(trx, s);

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.copiesBelowCursor).toBe(2);
      expect(result.copiesStored).toBe(2);
      expect(result.stored).toBe(2);
      const rows = await copyRowsOf(trx, s.mailboxId);
      expect(rows.map((row) => row.dedup_key)).toEqual([key, `${key}#2`, `${key}#3`, `${key}#4`]);
    });
  });

  test("3.6 the two hits fall in two chunks: #3 and #4, no #5", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interiaGlobal() };
      const { key } = await twoMovedRows(trx, s);
      // Row 1 is the newest move, row 2 the oldest: 100 other moved rows sit between them.
      const [first, second] = await copyRowsOf(trx, s.mailboxId);
      await trx
        .updateTable("emails")
        .set({ moved_at: new Date(NOW.getTime() - 60_000) })
        .where("id", "=", first?.id ?? "")
        .execute();
      await trx
        .updateTable("emails")
        .set({ moved_at: new Date(NOW.getTime() - 300 * 60_000) })
        .where("id", "=", second?.id ?? "")
        .execute();
      for (let n = 1; n <= 100; n += 1) {
        await insertTestEmail(trx, s.ctx, s.mailboxId, {
          dedup_key: `moved:${n}`,
          message_id_header: `<other${n}@x.test>`,
          folder: "AI/Info",
          uid: 10000 + n,
          source_uid: 10000 + n,
          moved_at: new Date(NOW.getTime() - (1 + n) * 60_000),
        });
      }
      const spy = spyFolderReads(s.fake);

      const result = await syncMailbox(deps(trx, spy.provider), s.ctx, s.mailboxId);
      expect(spy.folderCalls.filter((call) => call.folder === "INBOX" && call.method === "fetchByUidsIn")).toHaveLength(
        2
      );
      expect(result.copiesBelowCursor).toBe(2);
      expect(result.copiesStored).toBe(2);
      const rows = (await copyRowsOf(trx, s.mailboxId)).filter((row) => !row.dedup_key.startsWith("moved:"));
      expect(rows.map((row) => row.dedup_key)).toEqual([key, `${key}#2`, `${key}#3`, `${key}#4`]);
    });
  });

  test("3.7 a cursor moved during the check ends it: the copy is stored at the next run", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      await storeAndMark(trx, s);
      await putInFolder(trx, s);
      const provider: MailProvider = {
        ...s.fake,
        fetchByUidsIn: async (folder, uids) => {
          const metas = await s.fake.fetchByUidsIn(folder, uids);
          await trx
            .updateTable("mailbox_folders")
            .set({ last_uid: 99 })
            .where("mailbox_id", "=", s.mailboxId)
            .where("key", "=", "inbox")
            .execute();
          return metas;
        },
      };
      const warn = spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const result = await syncMailbox(deps(trx, provider), s.ctx, s.mailboxId);
        expect(result.copiesStored).toBe(0);
        expect(result.stored).toBe(0);
        expect(warn.mock.calls.map((call) => format(...call))).toContain(
          `[mail] sync_below_cursor_moved org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} folder_key=inbox`
        );
      } finally {
        warn.mockRestore();
      }
      expect(await copyRowsOf(trx, s.mailboxId)).toHaveLength(1);

      const next = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(next.copiesStored).toBe(1);
      expect(await copyRowsOf(trx, s.mailboxId)).toHaveLength(2);
    });
  });

  test("3.8 per-folder UIDs: another row of the identity with the hit UID number holds the copy back", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      const uid = await storeAndMark(trx, s);
      await putInFolder(trx, s);
      const [moved] = await copyRowsOf(trx, s.mailboxId);
      if (moved === undefined) throw new Error("no moved row");
      const full = await trx.selectFrom("emails").selectAll().where("id", "=", moved.id).executeTakeFirstOrThrow();
      // Not the same mail by chance of number alone: the rule cannot tell (accepted).
      await insertTestEmail(trx, s.ctx, s.mailboxId, {
        dedup_key: `${moved.dedup_key}#2`,
        message_id_header: full.message_id_header,
        content_hash: full.content_hash,
        folder: "AI/Spam",
        source_folder: "AI/Spam",
        uid,
        source_uid: uid,
      });
      const before = await copyRowsOf(trx, s.mailboxId);

      let result: MailboxSyncResult | undefined;
      const lines = await withDebugLines(async () => {
        result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      });
      expect(result?.copiesBelowCursor).toBe(1);
      expect(result?.copiesStored).toBe(0);
      expect(result?.stored).toBe(0);
      expect(await copyRowsOf(trx, s.mailboxId)).toEqual(before);
      expect(before).toHaveLength(2);
      const skipped = skipLines(lines);
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toContain("kind=held");
      expect(skipped[0]).toContain(`email_id=${moved.id}`);
    });
  });

  test("3.9 a hit found in the folder only at another UID is uncertain and not stored", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      await storeAndMark(trx, s);
      // An untracked identical twin in AI/Info; the row points at a UID where no mail is.
      const twin = s.fake.deliver("AI/Info", seed(1));
      await trx
        .updateTable("emails")
        .set({ uid: twin + 50 })
        .where("mailbox_id", "=", s.mailboxId)
        .execute();
      const before = await copyRowsOf(trx, s.mailboxId);
      const [moved] = before;
      if (moved === undefined) throw new Error("no moved row");

      let result: MailboxSyncResult | undefined;
      const lines = await withDebugLines(async () => {
        result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      });
      expect(result?.copiesBelowCursor).toBe(1);
      expect(result?.copiesStored).toBe(0);
      expect(result?.stored).toBe(0);
      expect(result?.returnedBelowCursor).toBe(0);
      expect(await copyRowsOf(trx, s.mailboxId)).toEqual(before);
      const skipped = skipLines(lines);
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toContain("kind=uncertain");
      expect(skipped[0]).toContain(`email_id=${moved.id}`);
    });
  });

  test("a full list warns about the limit", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      for (let n = 1; n <= RETURN_CHECK_LIMIT; n += 1) {
        await insertTestEmail(trx, s.ctx, s.mailboxId, {
          dedup_key: `moved:${n}`,
          message_id_header: `<moved${n}@x.test>`,
          folder: "AI/Info",
          uid: n,
          source_uid: n,
          moved_at: new Date(NOW.getTime() - n * 1000),
        });
      }
      const spy = spyFolderReads(s.fake);
      const warn = spyOn(console, "error").mockImplementation(() => undefined);
      try {
        await syncMailbox(deps(trx, spy.provider), s.ctx, s.mailboxId);
        expect(spy.folderCalls.filter((call) => call.method === "fetchByUidsIn")).toHaveLength(5);
        const lines = warn.mock.calls.map((call) => format(...call));
        expect(
          lines.some(
            (line) =>
              line.includes(`sync_below_cursor_limit`) && line.endsWith(`folder_key=inbox limit=${RETURN_CHECK_LIMIT}`)
          )
        ).toBe(true);
      } finally {
        warn.mockRestore();
      }
    });
  });

  test("a cursor moved during the check ends it: nothing is marked, no error", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      const uid = await storeAndMark(trx, s);
      s.fake.userMove("INBOX", uid, "AI/Info");
      s.fake.userMove("AI/Info", uid, "INBOX");
      const provider: MailProvider = {
        ...s.fake,
        fetchByUidsIn: async (folder, uids) => {
          const metas = await s.fake.fetchByUidsIn(folder, uids);
          await trx
            .updateTable("mailbox_folders")
            .set({ last_uid: 99 })
            .where("mailbox_id", "=", s.mailboxId)
            .where("key", "=", "inbox")
            .execute();
          return metas;
        },
      };
      const warn = spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const result = await syncMailbox(deps(trx, provider), s.ctx, s.mailboxId);
        expect(result.returnedBelowCursor).toBe(0);
        expect(warn.mock.calls.map((call) => format(...call))).toContain(
          `[mail] sync_below_cursor_moved org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} folder_key=inbox`
        );
      } finally {
        warn.mockRestore();
      }
      const row = await movedRowOf(trx, s.mailboxId);
      expect(row).toMatchObject({ folder: "AI/Info", returned_at: null });
    });
  });
});

describe("syncMailbox: sync folders", () => {
  const OFFERS = "Oferty";
  const SOCIAL = "Społeczności";
  const BILLS = "Rachunki";
  const JUNK = "Wiadomości-śmieci";
  const FOLDER_NOW = new Date("2026-11-08T12:00:00Z");

  const ago = (hours: number): { internalDate: Date } => ({
    internalDate: new Date(FOLDER_NOW.getTime() - hours * 3_600_000),
  });
  const folderDeps = (trx: Db | Transaction<DB>, provider: MailProvider, overrides: Partial<SyncDeps> = {}) =>
    deps(trx, provider, { now: () => FOLDER_NOW, ...overrides });

  // The Interia shape: one UID counter for the mailbox, no MOVE, a user move keeps the UID, STATUS UIDNEXT 1.
  async function folderSetup(trx: Transaction<DB>, opts: { keepUidOnUserMove?: boolean } = {}): Promise<Setup> {
    const s = await setup(trx);
    const fake = createFakeMailProvider({
      uidValidity: UID_VALIDITY,
      globalUids: true,
      keepUidOnUserMove: opts.keepUidOnUserMove ?? true,
      uidNextValue: 1,
      capabilities: { move: false },
    });
    return { ...s, fake };
  }

  async function addFolderRow(
    trx: Db | Transaction<DB>,
    s: Setup,
    key: "offers" | "social" | "bills" | "junk",
    path: string,
    opts: { enabled?: boolean; lastUid?: number | null } = {}
  ): Promise<void> {
    await trx
      .insertInto("mailbox_folders")
      .values({
        org_id: s.ctx.orgId,
        mailbox_id: s.mailboxId,
        key,
        path,
        role: key === "junk" ? "junk" : "sort",
        enabled: opts.enabled ?? true,
        uidvalidity: opts.lastUid === undefined || opts.lastUid === null ? null : 1,
        last_uid: opts.lastUid ?? null,
      })
      .execute();
  }

  async function folderRow(trx: Db | Transaction<DB>, mailboxId: string, key: string) {
    const row = await trx
      .selectFrom("mailbox_folders")
      .select(["uidvalidity", "last_uid", "enabled"])
      .where("mailbox_id", "=", mailboxId)
      .where("key", "=", key)
      .executeTakeFirst();
    return (
      row && {
        uidValidity: row.uidvalidity === null ? null : Number(row.uidvalidity),
        lastUid: row.last_uid === null ? null : Number(row.last_uid),
        enabled: row.enabled,
      }
    );
  }

  async function storedRows(trx: Db | Transaction<DB>, mailboxId: string) {
    return trx
      .selectFrom("emails")
      .select(["uid", "source_uid", "folder", "source_folder", "status", "subject"])
      .where("mailbox_id", "=", mailboxId)
      .orderBy("uid")
      .execute();
  }

  const of = (result: MailboxSyncResult, key: string) => result.folders.find((item) => item.folder === key);

  async function withLogs(fn: (lines: { warn: string[]; info: string[] }) => Promise<void>): Promise<void> {
    const warn = spyOn(console, "error").mockImplementation(() => undefined);
    const info = spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await fn({
        get warn() {
          return warn.mock.calls.map((call) => format(...call));
        },
        get info() {
          return info.mock.calls.map((call) => format(...call));
        },
      });
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
  }

  test("1. first run after the deploy: Oferty is added, only the last 24 h are stored, the cursor is the highest UID", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      s.fake.deliver(OFFERS, seed(1), ago(2));
      s.fake.deliver(OFFERS, seed(2), ago(20));
      const old = s.fake.deliver(OFFERS, seed(3), ago(30));

      await withLogs(async (lines) => {
        const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
        expect(result.added).toEqual(["offers"]);
        expect(result.mode).toBe("incremental");
        expect(of(result, "offers")?.mode).toBe("initial");
        expect(result.failed).toEqual([]);
        expect(lines.info).toContain(
          `[mail] sync_folders_added org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} count=1`
        );
        expect(lines.info).toContain(
          `[mail] sync_folder_added org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} folder_key=offers`
        );
      });
      const rows = await storedRows(trx, s.mailboxId);
      expect(rows.map((row) => row.subject)).toEqual(["Mail 1", "Mail 2"]);
      expect(rows.every((row) => row.folder === OFFERS && row.source_folder === OFFERS)).toBe(true);
      expect(rows.map((row) => Number(row.source_uid))).toEqual(rows.map((row) => Number(row.uid)));
      expect((await folderRow(trx, s.mailboxId, "offers"))?.lastUid).toBe(old);
    });
  });

  test("1b. the first VPS run: four default folders are added at once, INBOX stays incremental, AI/Spam is never synced", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await s.fake.ensureFolder("AI/Spam");
      // One UID counter: the UIDs interleave across the folders.
      s.fake.deliver(SOCIAL, seed(1), ago(100));
      const sourceUid = s.fake.deliver("INBOX", seed(2), ago(50));
      s.fake.deliver(OFFERS, seed(3), ago(60));
      s.fake.deliver(BILLS, seed(4), ago(90));
      s.fake.deliver(OFFERS, seed(5), ago(2));
      s.fake.deliver("AI/Spam", seed(6), ago(1));
      const socialTop = s.fake.deliver(SOCIAL, seed(7), ago(48));
      s.fake.deliver(OFFERS, seed(8), ago(5));
      const billsTop = s.fake.deliver(BILLS, seed(9), ago(30));
      const junkTop = s.fake.deliver(JUNK, seed(10), ago(80));
      const offersTop = s.fake.deliver(OFFERS, seed(11), ago(30));
      await trx
        .updateTable("mailbox_folders")
        .set({ last_uid: offersTop + 100 })
        .where("mailbox_id", "=", s.mailboxId)
        .where("key", "=", "inbox")
        .execute();
      await insertTestEmail(trx, s.ctx, s.mailboxId, {
        folder: "INBOX",
        uid: sourceUid,
        source_uid: sourceUid,
        subject: "Migrated",
      });

      await withLogs(async (lines) => {
        const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
        expect(result.added).toEqual(["offers", "social", "bills", "junk"]);
        expect(result.failed).toEqual([]);
        expect(lines.info).toContain(
          `[mail] sync_folders_added org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} count=4`
        );
        expect(
          lines.info.filter((line) => line.includes("sync_folder_added")).map((line) => line.split(" ").pop())
        ).toEqual(["folder_key=offers", "folder_key=social", "folder_key=bills", "folder_key=junk"]);
        expect(result.folders.map((item) => item.folder)).toEqual(["inbox", "offers", "social", "bills", "junk"]);
        expect(of(result, "inbox")?.mode).toBe("incremental");
        expect(of(result, "offers")?.mode).toBe("initial");
        expect(of(result, "offers")?.stored).toBe(2);
        expect(of(result, "social")?.stored).toBe(0);
        expect(of(result, "bills")?.stored).toBe(0);
      });
      expect((await folderRow(trx, s.mailboxId, "offers"))?.lastUid).toBe(offersTop);
      expect((await folderRow(trx, s.mailboxId, "social"))?.lastUid).toBe(socialTop);
      expect((await folderRow(trx, s.mailboxId, "bills"))?.lastUid).toBe(billsTop);
      expect((await folderRow(trx, s.mailboxId, "junk"))?.lastUid).toBe(junkTop);
      const rows = await storedRows(trx, s.mailboxId);
      expect(rows.filter((row) => row.folder !== "INBOX").map((row) => row.subject)).toEqual(["Mail 5", "Mail 8"]);
      expect(rows.some((row) => row.folder === "AI/Spam")).toBe(false);
      expect(s.fake.folderCalls.some((call) => call.folder === "AI/Spam" && call.method !== "ensureFolder")).toBe(
        false
      );
    });
  });

  test("2. a spam folder without mail in 24 h stores nothing and its cursor is the highest UID", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      for (const n of [1, 2, 3]) s.fake.deliver(JUNK, seed(n), ago(72));

      const first = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(first.added).toEqual(["junk"]);
      expect(first.stored).toBe(0);
      expect(await storedRows(trx, s.mailboxId)).toHaveLength(0);
      expect((await folderRow(trx, s.mailboxId, "junk"))?.lastUid).toBe(3);

      const second = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(second, "junk")?.mode).toBe("incremental");
      expect(of(second, "junk")?.stored).toBe(0);
      expect(await storedRows(trx, s.mailboxId)).toHaveLength(0);
    });
  });

  test("3. a new mail in Społeczności above its cursor is stored pending, with the body read from that folder", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "social", SOCIAL, { lastUid: 0 });
      const uid = s.fake.deliver(SOCIAL, seed(1), ago(1));

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "social")?.stored).toBe(1);
      const rows = await storedRows(trx, s.mailboxId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ folder: SOCIAL, source_folder: SOCIAL, status: "pending", uid: String(uid) });
      expect(s.fake.folderCalls).toContainEqual({ method: "fetchContent", folder: SOCIAL });
    });
  });

  test("4. a disabled junk row is not synced and discovery does not enable it", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "junk", JUNK, { enabled: false, lastUid: 0 });
      s.fake.deliver(JUNK, seed(1), ago(1));

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.added).toEqual([]);
      expect(result.folders.map((item) => item.folder)).toEqual(["inbox"]);
      expect(await storedRows(trx, s.mailboxId)).toHaveLength(0);
      expect(await folderRow(trx, s.mailboxId, "junk")).toEqual({ uidValidity: 1, lastUid: 0, enabled: false });
      expect(s.fake.folderCalls.some((call) => call.method === "folderStatus" && call.folder === JUNK)).toBe(false);
    });
  });

  test("5. a row whose path the server does not list is skipped with one warn line", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "bills", BILLS, { lastUid: 0 });
      s.fake.deliver("INBOX", seed(1), ago(1));

      await withLogs(async (lines) => {
        const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
        expect(result.skipped).toEqual(["bills"]);
        expect(result.failed).toEqual([]);
        expect(result.stored).toBe(1);
        expect(lines.warn).toEqual([
          `[mail] sync_folder_missing org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} folder_key=bills`,
        ]);
      });
    });
  });

  test("6. a SoftError in the Oferty read fails only that folder; the next run stores its mail once", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      await addFolderRow(trx, s, "junk", JUNK, { lastUid: 0 });
      s.fake.deliver("INBOX", seed(1), ago(1));
      s.fake.deliver(OFFERS, seed(2), ago(1));
      s.fake.deliver(JUNK, seed(3), ago(1));
      let broken = true;
      const provider: MailProvider = {
        ...s.fake,
        fetchAbove: async (folder, lastUid) => {
          if (broken && folder === OFFERS) throw new SoftError("lost connection for MARKER-ADDR@x.test");
          return s.fake.fetchAbove(folder, lastUid);
        },
      };

      await withLogs(async (lines) => {
        const result = await syncMailbox(folderDeps(trx, provider), s.ctx, s.mailboxId);
        expect(result.stored).toBe(1);
        expect(result.failed).toEqual(["offers"]);
        expect(of(result, "junk")?.stored).toBe(1);
        expect(lines.warn).toContain(
          `[mail] sync_folder_soft_error org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} folder_key=offers error=SoftError`
        );
        expect([...lines.warn, ...lines.info].join("\n")).not.toContain("MARKER");
      });
      expect((await folderRow(trx, s.mailboxId, "offers"))?.lastUid).toBe(0);

      broken = false;
      const next = await syncMailbox(folderDeps(trx, provider), s.ctx, s.mailboxId);
      expect(next.failed).toEqual([]);
      expect(of(next, "offers")?.stored).toBe(1);
      expect((await storedRows(trx, s.mailboxId)).filter((row) => row.folder === OFFERS)).toHaveLength(1);
    });
  });

  test("7. a SoftError in INBOX stops the run before any other folder", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      s.fake.deliver(OFFERS, seed(1), ago(1));
      s.fake.failOn("fetchAbove", new SoftError("lost connection"));

      await expect(syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId)).rejects.toBeInstanceOf(SoftError);
      expect(s.fake.folderCalls.some((call) => call.folder === OFFERS)).toBe(false);
    });
  });

  test("8. a UIDVALIDITY change in Oferty rescans only that folder and gives its known rows the new UIDs", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      s.fake.deliver(OFFERS, seed(1), ago(1));
      s.fake.deliver(OFFERS, seed(2), ago(30));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(await storedRows(trx, s.mailboxId)).toHaveLength(2);

      s.fake.resetUidValidity(9, OFFERS);
      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.mode).toBe("incremental");
      const offers = of(result, "offers");
      expect(offers?.mode).toBe("rescan");
      expect(offers?.stored).toBe(0);
      expect(offers?.uidUpdated).toBe(2);
      const rows = await storedRows(trx, s.mailboxId);
      expect(rows).toHaveLength(2);
      const uids = (await s.fake.fetchAbove(OFFERS, 0)).map((meta) => meta.uid);
      expect(rows.map((row) => Number(row.uid))).toEqual(uids);
      expect(rows.map((row) => Number(row.source_uid))).toEqual(uids);
      expect((await folderRow(trx, s.mailboxId, "offers"))?.uidValidity).toBe(9);
    });
  });

  test("9. a CursorMovedError in the Oferty chunk fails only that folder", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      await addFolderRow(trx, s, "junk", JUNK, { lastUid: 0 });
      s.fake.deliver(OFFERS, seed(1), ago(1));
      s.fake.deliver(JUNK, seed(2), ago(1));
      const provider: MailProvider = {
        ...s.fake,
        fetchContent: async (folder, uid) => {
          if (folder === OFFERS) {
            await trx
              .updateTable("mailbox_folders")
              .set({ last_uid: 99 })
              .where("mailbox_id", "=", s.mailboxId)
              .where("key", "=", "offers")
              .execute();
          }
          return s.fake.fetchContent(folder, uid);
        },
      };

      await withLogs(async (lines) => {
        const result = await syncMailbox(folderDeps(trx, provider), s.ctx, s.mailboxId);
        expect(result.failed).toEqual(["offers"]);
        expect(of(result, "junk")?.stored).toBe(1);
        expect(lines.warn).toContain(
          `[mail] sync_folder_soft_error org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} folder_key=offers error=CursorMovedError`
        );
      });
      expect((await storedRows(trx, s.mailboxId)).map((row) => row.folder)).toEqual([JUNK]);
    });
  });

  test("10. a crash before the Oferty commit leaves no row and no cursor; the next run stores the mail once", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      s.fake.deliver(OFFERS, seed(1), ago(1));
      let crash = true;
      const provider: MailProvider = {
        ...s.fake,
        fetchContent: async (folder, uid) => {
          const body = await s.fake.fetchContent(folder, uid);
          if (crash && folder === OFFERS) throw new SoftError("crash after the plan");
          return body;
        },
      };

      const first = await syncMailbox(folderDeps(trx, provider), s.ctx, s.mailboxId);
      expect(first.failed).toEqual(["offers"]);
      expect(await storedRows(trx, s.mailboxId)).toHaveLength(0);
      expect(await folderRow(trx, s.mailboxId, "offers")).toEqual({ uidValidity: null, lastUid: null, enabled: true });

      crash = false;
      const second = await syncMailbox(folderDeps(trx, provider), s.ctx, s.mailboxId);
      expect(of(second, "offers")?.stored).toBe(1);
      expect(await storedRows(trx, s.mailboxId)).toHaveLength(1);
    });
  });

  test("11. an own sent mail in Oferty is skipped", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      s.fake.deliver(OFFERS, seed(1, { headers: { "X-EA-Action-Id": "act-1" } }), ago(1));
      const isOwnActionId = async (_ctx: TenantContext, _mailboxId: string, actionId: string) => actionId === "act-1";

      const result = await syncMailbox(folderDeps(trx, s.fake, { isOwnActionId }), s.ctx, s.mailboxId);
      expect(of(result, "offers")?.skippedOwn).toBe(1);
      expect(await storedRows(trx, s.mailboxId)).toHaveLength(0);
    });
  });

  // Cross-folder dedup.
  async function crossRows(trx: Db | Transaction<DB>, mailboxId: string) {
    const rows = await trx
      .selectFrom("emails")
      .select(["dedup_key", "uid", "source_uid", "folder", "source_folder", "returned_at", "moved_at"])
      .where("mailbox_id", "=", mailboxId)
      .orderBy("uid")
      .execute();
    return rows.map((row) => ({
      ...row,
      uid: Number(row.uid),
      source_uid: row.source_uid === null ? null : Number(row.source_uid),
    }));
  }

  // The system moved the stored row (one row in the mailbox) to `AI/Info`, and so did the server.
  async function markSystemMoved(trx: Db | Transaction<DB>, s: Setup, from: string, uid: number): Promise<number> {
    await trx
      .updateTable("emails")
      .set({ folder: "AI/Info", moved_at: FOLDER_NOW })
      .where("mailbox_id", "=", s.mailboxId)
      .execute();
    return s.fake.userMove(from, uid, "AI/Info");
  }

  test("7b.1 a row in INBOX and the same mail delivered into Oferty: Oferty stores nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      s.fake.deliver("INBOX", seed(1), ago(1));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      s.fake.deliver(OFFERS, seed(1), ago(1));

      let result: MailboxSyncResult | undefined;
      const lines = await withDebugLines(async () => {
        result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      });
      expect(result?.failed).toEqual([]);
      expect(of(result as MailboxSyncResult, "offers")?.stored).toBe(0);
      expect(of(result as MailboxSyncResult, "offers")?.crossCopies).toBe(1);
      const rows = await crossRows(trx, s.mailboxId);
      expect(rows.map((row) => row.folder)).toEqual(["INBOX"]);
      const [row] = await trx.selectFrom("emails").select("id").where("mailbox_id", "=", s.mailboxId).execute();
      expect(lines.filter((line) => line.includes("sync_cross_copy"))).toEqual([
        `[mail] sync_cross_copy org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} folder_key=offers email_id=${row?.id}`,
      ]);
    });
  });

  test("7b.2 the same mail new in INBOX and in Oferty in one run: INBOX stores it, Oferty counts a cross copy with no locate", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      s.fake.deliver("INBOX", seed(1), ago(1));
      s.fake.deliver(OFFERS, seed(1), ago(1));
      const callsBefore = s.fake.folderCalls.length;

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.failed).toEqual([]);
      expect(of(result, "inbox")?.stored).toBe(1);
      expect(of(result, "offers")?.stored).toBe(0);
      expect(of(result, "offers")?.crossCopies).toBe(1);
      const rows = await crossRows(trx, s.mailboxId);
      expect(rows.map((row) => row.folder)).toEqual(["INBOX"]);
      const methods = s.fake.folderCalls.slice(callsBefore).map((call) => call.method);
      expect(methods).not.toContain("fetchMetaIn");
      expect(methods).not.toContain("searchSinceIn");
    });
  });

  test("7b.3 a rescan of INBOX and Oferty with the anna case: INBOX update_uid, Oferty cross copy, no new row", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      s.fake.deliver("INBOX", seed(1), ago(1));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      s.fake.deliver(OFFERS, seed(1), ago(1));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(await forceRescan(trx, s.ctx, s.mailboxId)).toBe(true);

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "inbox")?.mode).toBe("rescan");
      expect(of(result, "inbox")?.uidUpdated).toBe(1);
      expect(of(result, "offers")?.mode).toBe("rescan");
      expect(of(result, "offers")?.crossCopies).toBe(1);
      expect(of(result, "offers")?.uidUpdated).toBe(0);
      expect(await crossRows(trx, s.mailboxId)).toHaveLength(1);
    });
  });

  test("7b.4 a user move from INBOX into Oferty is relocated: no new row, no feedback", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { keepUidOnUserMove: false });
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      await s.fake.ensureFolder(OFFERS);
      const uid = s.fake.deliver("INBOX", seed(1), ago(1));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      const moved = s.fake.userMove("INBOX", uid, OFFERS);

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "offers")?.relocated).toBe(1);
      expect(of(result, "offers")?.stored).toBe(0);
      const rows = await crossRows(trx, s.mailboxId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        folder: OFFERS,
        source_folder: OFFERS,
        uid: moved,
        source_uid: moved,
        returned_at: null,
      });
      const feedback = await trx.selectFrom("triage_feedback").select("id").where("org_id", "=", s.ctx.orgId).execute();
      expect(feedback).toHaveLength(0);
    });
  });

  test("7b.5 a mail moved back into its source Oferty above the cursor is returned", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { keepUidOnUserMove: false });
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      const uid = s.fake.deliver(OFFERS, seed(1), ago(1));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      const inInfo = await markSystemMoved(trx, s, OFFERS, uid);
      const back = s.fake.userMove("AI/Info", inInfo, OFFERS);

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "offers")?.returned).toBe(1);
      const rows = await crossRows(trx, s.mailboxId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        folder: OFFERS,
        source_folder: OFFERS,
        uid: back,
        source_uid: back,
        returned_at: FOLDER_NOW,
      });
    });
  });

  test("7b.6 a returned mail in INBOX that is also in Oferty: INBOX returned, Oferty cross copy, no new row", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { keepUidOnUserMove: false });
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      const uid = s.fake.deliver("INBOX", seed(1), ago(1));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      const inInfo = await markSystemMoved(trx, s, "INBOX", uid);
      const back = s.fake.userMove("AI/Info", inInfo, "INBOX");
      s.fake.deliver(OFFERS, seed(1), ago(1));

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "inbox")?.returned).toBe(1);
      expect(of(result, "offers")?.crossCopies).toBe(1);
      expect(of(result, "offers")?.stored).toBe(0);
      const rows = await crossRows(trx, s.mailboxId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ folder: "INBOX", source_folder: "INBOX", uid: back, returned_at: FOLDER_NOW });
    });
  });

  test("7b.7 a mail of source INBOX that the user files into Oferty counts as a return", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { keepUidOnUserMove: false });
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      await s.fake.ensureFolder(OFFERS);
      const uid = s.fake.deliver("INBOX", seed(1), ago(1));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      const inInfo = await markSystemMoved(trx, s, "INBOX", uid);
      const filed = s.fake.userMove("AI/Info", inInfo, OFFERS);

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "offers")?.returned).toBe(1);
      const rows = await crossRows(trx, s.mailboxId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        folder: OFFERS,
        source_folder: OFFERS,
        uid: filed,
        source_uid: filed,
        returned_at: FOLDER_NOW,
      });
    });
  });

  test("7b.8 a move in flight: its copies in INBOX and Oferty are not stored and not located", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      const uid = s.fake.deliver("INBOX", seed(1), ago(1));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      await markSystemMoved(trx, s, "INBOX", uid);
      await trx
        .updateTable("emails")
        .set({ move_pending_at: new Date(FOLDER_NOW.getTime() - 60_000) })
        .where("mailbox_id", "=", s.mailboxId)
        .execute();
      s.fake.deliver("INBOX", seed(1), ago(1));
      s.fake.deliver(OFFERS, seed(1), ago(1));
      const callsBefore = s.fake.folderCalls.length;

      let result: MailboxSyncResult | undefined;
      const lines = await withDebugLines(async () => {
        result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      });
      expect(of(result as MailboxSyncResult, "inbox")?.moveInFlight).toBe(1);
      expect(of(result as MailboxSyncResult, "offers")?.moveInFlight).toBe(1);
      const [row] = await trx.selectFrom("emails").select("id").where("mailbox_id", "=", s.mailboxId).execute();
      const target = `[mail] sync_move_target_copy org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} email_id=${row?.id}`;
      expect(lines.filter((line) => line.includes("sync_move_target_copy"))).toEqual([target, target]);
      expect(await crossRows(trx, s.mailboxId)).toHaveLength(1);
      const methods = s.fake.folderCalls.slice(callsBefore).map((call) => call.method);
      expect(methods).not.toContain("fetchMetaIn");
      expect(methods).not.toContain("searchSinceIn");
    });
  });

  test("7b.10 a rescan of INBOX and Oferty: the INBOX copy is a cross copy, the Oferty pass updates the row's UID", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      s.fake.deliver(OFFERS, seed(1), ago(1));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      s.fake.deliver("INBOX", seed(1), ago(1));
      expect(await forceRescan(trx, s.ctx, s.mailboxId)).toBe(true);
      s.fake.resetUidValidity(9, OFFERS);

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "inbox")?.crossCopies).toBe(1);
      expect(of(result, "offers")?.crossCopies).toBe(0);
      expect(of(result, "offers")?.uidUpdated).toBe(1);
      const rows = await crossRows(trx, s.mailboxId);
      const [offersUid] = (await s.fake.fetchAbove(OFFERS, 0)).map((meta) => meta.uid);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ folder: OFFERS, source_folder: OFFERS, uid: offersUid, source_uid: offersUid });
    });
  });

  test("7b.12 a chunk that fails before its commit leaves no run state: the later folder stores the mail", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      await addFolderRow(trx, s, "junk", JUNK, { lastUid: 0 });
      s.fake.deliver(OFFERS, seed(1), ago(1));
      const failing = s.fake.deliver(OFFERS, seed(2), ago(1));
      s.fake.deliver(JUNK, seed(1), ago(1));
      const provider: MailProvider = {
        ...s.fake,
        fetchContent: async (folder, uid) => {
          if (folder === OFFERS && uid === failing) throw new SoftError("lost connection");
          return s.fake.fetchContent(folder, uid);
        },
      };

      await withLogs(async () => {
        const result = await syncMailbox(folderDeps(trx, provider), s.ctx, s.mailboxId);
        expect(result.failed).toEqual(["offers"]);
        expect(of(result, "junk")?.stored).toBe(1);
        expect(of(result, "junk")?.crossCopies).toBe(0);
      });
      const rows = await crossRows(trx, s.mailboxId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ folder: JUNK, source_folder: JUNK });
    });
  });

  for (const chunkSize of [undefined, 1]) {
    test(`7b.9 two identical new copies in Oferty: the second row gets #2 (chunkSize ${chunkSize ?? "default"})`, async () => {
      await withRollback(db, async (trx) => {
        const s = await folderSetup(trx);
        await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
        s.fake.deliver(OFFERS, seed(1), ago(1));
        s.fake.deliver(OFFERS, seed(1), ago(1));

        const overrides = chunkSize === undefined ? {} : { chunkSize };
        const result = await syncMailbox(folderDeps(trx, s.fake, overrides), s.ctx, s.mailboxId);
        expect(of(result, "offers")?.stored).toBe(2);
        const rows = (await emails(trx, s.mailboxId)).filter((row) => row.folder === OFFERS);
        expect(rows).toHaveLength(2);
        expect(rows[1]?.dedup_key).toBe(`${rows[0]?.dedup_key}#2`);
      });
    });
  }

  test("12. a folder that is the trash path in folder_map is not added", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await trx
        .updateTable("mailboxes")
        .set({ folder_map: JSON.stringify({ drafts: "Drafts", trash: OFFERS }) })
        .where("id", "=", s.mailboxId)
        .execute();
      s.fake.deliver(OFFERS, seed(1), ago(1));

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.added).toEqual([]);
      expect(await folderRow(trx, s.mailboxId, "offers")).toBeUndefined();
      expect(await storedRows(trx, s.mailboxId)).toHaveLength(0);
    });
  });

  test("13. a failed discovery gives one warn line and the existing rows sync", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      s.fake.deliver("INBOX", seed(1), ago(1));
      s.fake.deliver(OFFERS, seed(2), ago(1));
      s.fake.failOn("listFolders", new HardError("list failed for MARKER-ADDR@x.test"));

      await withLogs(async (lines) => {
        const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
        expect(result.stored).toBe(1);
        expect(of(result, "offers")?.stored).toBe(1);
        expect(result.added).toEqual([]);
        expect(lines.warn).toEqual([
          `[mail] sync_folder_discovery_failed org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} error=HardError`,
        ]);
        expect(lines.info.join("\n")).not.toContain("MARKER");
      });
    });
  });

  test("16. a failed discovery and no INBOX row: HardError and last_synced_at stays empty", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await trx.deleteFrom("mailbox_folders").where("mailbox_id", "=", s.mailboxId).execute();
      s.fake.failOn("listFolders", new SoftError("lost connection"));

      const error = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(HardError);
      expect((error as Error).message).toBe("mailbox has no INBOX folder row");
      const mailbox = await trx
        .selectFrom("mailboxes")
        .select("last_synced_at")
        .where("id", "=", s.mailboxId)
        .executeTakeFirstOrThrow();
      expect(mailbox.last_synced_at).toBeNull();
    });
  });

  // A mail of source folder `path` (Mail 1) that the system moved to AI/Info an hour ago; `path` has a later mail
  // (Mail 2), so the cursor of `path` is above the UID of Mail 1.
  async function movedFromFolder(
    trx: Transaction<DB>,
    s: Setup,
    key: "offers" | "junk" | "inbox",
    path: string
  ): Promise<{ uid: number; rowId: string }> {
    if (key !== "inbox") await addFolderRow(trx, s, key, path, { lastUid: 0 });
    const uid = s.fake.deliver(path, seed(1), ago(2));
    await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
    s.fake.deliver(path, seed(2), ago(1));
    await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
    const row = await trx
      .selectFrom("emails")
      .select("id")
      .where("mailbox_id", "=", s.mailboxId)
      .where("subject", "=", "Mail 1")
      .executeTakeFirstOrThrow();
    return { uid, rowId: row.id };
  }

  async function markMoved(trx: Transaction<DB>, rowId: string, folder: string, movedAt: Date): Promise<void> {
    await trx.updateTable("emails").set({ folder, moved_at: movedAt }).where("id", "=", rowId).execute();
  }

  async function rowById(trx: Transaction<DB>, rowId: string) {
    const row = await trx
      .selectFrom("emails")
      .select(["uid", "source_uid", "folder", "source_folder", "returned_at"])
      .where("id", "=", rowId)
      .executeTakeFirstOrThrow();
    return { ...row, uid: Number(row.uid), source_uid: Number(row.source_uid) };
  }

  test("8.1 a mail that the user puts back into Oferty with the same UID below the cursor is returned", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      const { uid, rowId } = await movedFromFolder(trx, s, "offers", OFFERS);
      // The system COPY gave the mail another UID in AI/Info than its UID in Oferty.
      const inFolder = s.fake.deliver("AI/Info", seed(1), ago(2));
      s.fake.remove(OFFERS, uid);
      expect(inFolder).not.toBe(uid);
      await trx.updateTable("emails").set({ uid: inFolder }).where("id", "=", rowId).execute();
      await trx
        .updateTable("mailbox_folders")
        .set({ last_uid: inFolder + 10 })
        .where("mailbox_id", "=", s.mailboxId)
        .where("key", "=", "offers")
        .execute();
      await markMoved(trx, rowId, "AI/Info", new Date(FOLDER_NOW.getTime() - 3_600_000));
      expect(s.fake.userMove("AI/Info", inFolder, OFFERS)).toBe(inFolder);

      await withLogs(async (lines) => {
        const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
        expect(of(result, "offers")?.returnedBelowCursor).toBe(1);
        expect(of(result, "inbox")?.returnedBelowCursor).toBe(0);
        expect(lines.info).toContain(
          `[mail] sync_below_cursor_done org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} folder_key=offers checked=1 returned=1 copies=0`
        );
      });
      const row = await rowById(trx, rowId);
      expect(row).toMatchObject({ folder: OFFERS, source_folder: OFFERS, uid: inFolder, source_uid: inFolder });
      expect(row.returned_at).toEqual(FOLDER_NOW);
      expect(await storedRows(trx, s.mailboxId)).toHaveLength(2);
    });
  });

  test("8.1b a cursor of Oferty that moves during the check writes sync_below_cursor_moved with the key offers", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      const { uid, rowId } = await movedFromFolder(trx, s, "offers", OFFERS);
      const inFolder = s.fake.deliver("AI/Info", seed(1), ago(2));
      s.fake.remove(OFFERS, uid);
      await trx.updateTable("emails").set({ uid: inFolder }).where("id", "=", rowId).execute();
      await trx
        .updateTable("mailbox_folders")
        .set({ last_uid: inFolder + 10 })
        .where("mailbox_id", "=", s.mailboxId)
        .where("key", "=", "offers")
        .execute();
      await markMoved(trx, rowId, "AI/Info", new Date(FOLDER_NOW.getTime() - 3_600_000));
      s.fake.userMove("AI/Info", inFolder, OFFERS);
      const provider: MailProvider = {
        ...s.fake,
        fetchByUidsIn: async (folder, uids) => {
          const metas = await s.fake.fetchByUidsIn(folder, uids);
          if (folder === OFFERS) {
            await trx
              .updateTable("mailbox_folders")
              .set({ last_uid: inFolder + 99 })
              .where("mailbox_id", "=", s.mailboxId)
              .where("key", "=", "offers")
              .execute();
          }
          return metas;
        },
      };

      await withLogs(async (lines) => {
        const result = await syncMailbox(folderDeps(trx, provider), s.ctx, s.mailboxId);
        expect(of(result, "offers")?.returnedBelowCursor).toBe(0);
        expect(lines.warn).toContain(
          `[mail] sync_below_cursor_moved org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} folder_key=offers`
        );
      });
    });
  });

  test("8.2 a mail still in AI/Info with an identical copy in Oferty at its UID is a copy, not a return", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      const { uid, rowId } = await movedFromFolder(trx, s, "offers", OFFERS);
      const inFolder = s.fake.deliver("AI/Info", seed(1), ago(2));
      await markMoved(trx, rowId, "AI/Info", new Date(FOLDER_NOW.getTime() - 3_600_000));
      await trx.updateTable("emails").set({ uid: inFolder }).where("id", "=", rowId).execute();

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "offers")?.copiesBelowCursor).toBe(1);
      expect(of(result, "offers")?.copiesStored).toBe(1);
      expect(of(result, "offers")?.returnedBelowCursor).toBe(0);
      const row = await rowById(trx, rowId);
      expect(row).toMatchObject({ folder: "AI/Info", uid: inFolder, source_uid: uid, returned_at: null });
      const moved = await trx
        .selectFrom("emails")
        .select("dedup_key")
        .where("id", "=", rowId)
        .executeTakeFirstOrThrow();
      const copies = await trx
        .selectFrom("emails")
        .select(["dedup_key", "status", "folder", "source_folder", "uid", "source_uid"])
        .where("mailbox_id", "=", s.mailboxId)
        .where("folder", "=", OFFERS)
        .where("subject", "=", "Mail 1")
        .execute();
      expect(copies).toHaveLength(1);
      expect(copies[0]).toMatchObject({
        dedup_key: `${moved.dedup_key}#2`,
        status: "pending",
        folder: OFFERS,
        source_folder: OFFERS,
      });
      expect([Number(copies[0]?.uid), Number(copies[0]?.source_uid)]).toEqual([uid, uid]);
    });
  });

  test("8.2b a user move back of the row's mail after its copy is stored is still a return", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      const uid = s.fake.deliver("INBOX", seed(1), ago(2));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      await trx
        .updateTable("emails")
        .set({ folder: "AI/Info", moved_at: new Date(FOLDER_NOW.getTime() - 3_600_000) })
        .where("mailbox_id", "=", s.mailboxId)
        .execute();
      // The system COPY gave the mail its own UID in AI/Info; the INBOX original stays at its UID.
      const inFolder = s.fake.deliver("AI/Info", seed(1), ago(2));
      await trx.updateTable("emails").set({ uid: inFolder }).where("mailbox_id", "=", s.mailboxId).execute();
      // A newer INBOX mail moves the cursor past the folder UID.
      s.fake.deliver("INBOX", seed(2), ago(1));
      const first = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(first.copiesStored).toBe(1);
      expect(first.stored).toBe(2);
      const before = await copyRowsOf(trx, s.mailboxId);
      const copy = before.find((row) => row.dedup_key.endsWith("#2"));
      expect(copy).toMatchObject({ folder: "INBOX", uid, source_uid: uid });
      const moved = before.find((row) => row.folder === "AI/Info");

      expect(s.fake.userMove("AI/Info", inFolder, "INBOX")).toBe(inFolder);
      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.returnedBelowCursor).toBe(1);
      expect(result.copiesStored).toBe(0);
      const after = await copyRowsOf(trx, s.mailboxId);
      expect(after).toHaveLength(3);
      const returned = after.find((row) => row.id === moved?.id);
      expect(returned).toMatchObject({ folder: "INBOX", uid: inFolder });
      expect(returned?.returned_at?.getTime()).toBe(FOLDER_NOW.getTime());
      expect(after.find((row) => row.id === copy?.id)).toEqual(copy);
    });
  });

  test("8.3 a mail of source INBOX returned into INBOX below the cursor is returned by the INBOX run only", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      await s.fake.ensureFolder(OFFERS);
      const { uid, rowId } = await movedFromFolder(trx, s, "inbox", "INBOX");
      await markMoved(trx, rowId, "AI/Info", new Date(FOLDER_NOW.getTime() - 3_600_000));
      s.fake.userMove("INBOX", uid, "AI/Info");
      s.fake.userMove("AI/Info", uid, "INBOX");

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "inbox")?.returnedBelowCursor).toBe(1);
      expect(of(result, "offers")?.returnedBelowCursor).toBe(0);
      const row = await rowById(trx, rowId);
      expect(row).toMatchObject({ folder: "INBOX", source_folder: "INBOX", uid, source_uid: uid });
      expect(row.returned_at).toEqual(FOLDER_NOW);
    });
  });

  test("8.4 a mail of source INBOX that the user files into Oferty below its cursor: the pass does not see it, the move finder after the flag refresh returns it", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      await s.fake.ensureFolder(OFFERS);
      const { uid, rowId } = await movedFromFolder(trx, s, "inbox", "INBOX");
      s.fake.deliver(OFFERS, seed(3), ago(1));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect((await folderRow(trx, s.mailboxId, "offers"))?.lastUid).toBeGreaterThan(uid);
      await markMoved(trx, rowId, "AI/Info", new Date(FOLDER_NOW.getTime() - 3_600_000));
      s.fake.userMove("INBOX", uid, "AI/Info");
      expect(s.fake.userMove("AI/Info", uid, OFFERS)).toBe(uid);
      const before = await storedRows(trx, s.mailboxId);

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "offers")?.returnedBelowCursor).toBe(0);
      expect(of(result, "inbox")?.returnedBelowCursor).toBe(0);
      expect(await storedRows(trx, s.mailboxId)).toEqual(before);
      const row = await rowById(trx, rowId);
      expect(row).toMatchObject({ folder: "AI/Info", source_folder: "INBOX", returned_at: null });

      const refreshed = await refreshFlags({ db: trx, provider: s.fake, now: () => FOLDER_NOW }, s.ctx, s.mailboxId);
      expect(refreshed.gone.map((target) => target.emailId)).toEqual([rowId]);
      const moves = await findUserMoves(
        { db: trx, provider: s.fake, now: () => FOLDER_NOW },
        s.ctx,
        s.mailboxId,
        refreshed.gone
      );
      expect(moves).toEqual({ checked: 1, returned: 1, relocated: 0, retry: 0 });
      const found = await rowById(trx, rowId);
      expect(found).toMatchObject({ folder: OFFERS, source_folder: OFFERS, uid, source_uid: uid });
      expect(found.returned_at).toEqual(FOLDER_NOW);
    });
  });

  test("8.6 a rescued mail that the user moves back into the spam folder with its UID is returned by the junk run", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      const { uid, rowId } = await movedFromFolder(trx, s, "junk", JUNK);
      await markMoved(trx, rowId, "INBOX", new Date(FOLDER_NOW.getTime() - 3_600_000));
      expect(s.fake.userMove(JUNK, uid, "INBOX")).toBe(uid);
      expect(s.fake.userMove("INBOX", uid, JUNK)).toBe(uid);

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "junk")?.returnedBelowCursor).toBe(1);
      expect(of(result, "inbox")?.returnedBelowCursor).toBe(0);
      const row = await rowById(trx, rowId);
      expect(row).toMatchObject({ folder: JUNK, source_folder: JUNK, uid, source_uid: uid });
      expect(row.returned_at).toEqual(FOLDER_NOW);
    });
  });

  test("8.7 the Oferty check fetches only Oferty by UID and reads only the row folder for the folder check", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      const { uid, rowId } = await movedFromFolder(trx, s, "offers", OFFERS);
      await markMoved(trx, rowId, "AI/Info", new Date(FOLDER_NOW.getTime() - 3_600_000));
      s.fake.userMove(OFFERS, uid, "AI/Info");
      s.fake.userMove("AI/Info", uid, OFFERS);
      const spy = spyFolderReads(s.fake);

      const result = await syncMailbox(folderDeps(trx, spy.provider), s.ctx, s.mailboxId);
      expect(of(result, "offers")?.returnedBelowCursor).toBe(1);
      const fetches = spy.folderCalls.filter((call) => call.method === "fetchByUidsIn");
      expect(fetches.length).toBeGreaterThan(0);
      expect(fetches.every((call) => call.folder === OFFERS)).toBe(true);
      const locates = spy.folderCalls.filter((call) => call.method !== "fetchByUidsIn");
      expect(locates.length).toBeGreaterThan(0);
      expect(locates.every((call) => call.folder === "AI/Info")).toBe(true);
      expect(spy.folderCalls.some((call) => call.folder === "INBOX")).toBe(false);
    });
  });

  // The Interia shape: Mail 1 came from `Oferty`, the system moved it to AI/Info (a copy at its folder UID), Oferty still holds it.
  async function copyOfMovedOffers(trx: Transaction<DB>, s: Setup) {
    const { uid, rowId } = await movedFromFolder(trx, s, "offers", OFFERS);
    const inFolder = s.fake.deliver("AI/Info", seed(1), ago(2));
    await markMoved(trx, rowId, "AI/Info", new Date(FOLDER_NOW.getTime() - 3_600_000));
    await trx.updateTable("emails").set({ uid: inFolder }).where("id", "=", rowId).execute();
    const moved = await trx.selectFrom("emails").selectAll().where("id", "=", rowId).executeTakeFirstOrThrow();
    return { uid, rowId, moved };
  }

  test("3.2 another row of the identity that holds the hit UID holds the copy back", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      const { uid, rowId, moved } = await copyOfMovedOffers(trx, s);
      // In another folder than Oferty: a row in Oferty at the hit UID is a known mail and is no hit at all.
      const heldId = await insertTestEmail(trx, s.ctx, s.mailboxId, {
        dedup_key: `${moved.dedup_key}#2`,
        message_id_header: moved.message_id_header,
        content_hash: moved.content_hash,
        folder: "AI/Spam",
        source_folder: "AI/Spam",
        uid,
        source_uid: uid,
      });
      const before = await trx.selectFrom("emails").selectAll().where("mailbox_id", "=", s.mailboxId).execute();

      let result: MailboxSyncResult | undefined;
      const lines = await withDebugLines(async () => {
        result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      });
      expect(of(result as MailboxSyncResult, "offers")?.copiesBelowCursor).toBe(1);
      expect(of(result as MailboxSyncResult, "offers")?.copiesStored).toBe(0);
      const skipped = lines.filter((line) => line.includes("sync_below_cursor_copy_skipped"));
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toContain("kind=held");
      expect(skipped[0]).toContain(`email_id=${rowId}`);
      const after = await trx.selectFrom("emails").selectAll().where("mailbox_id", "=", s.mailboxId).execute();
      expect(after).toEqual(before);
      expect(after.find((row) => row.id === heldId)).toBeDefined();
    });
  });

  test("3.3 a cross copy stored by the INBOX pass holds the Oferty copy back; the next run stores it as #3", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      const { moved } = await copyOfMovedOffers(trx, s);
      // An identical mail above the INBOX cursor: the INBOX pass stores it as #2 before the Oferty check runs.
      s.fake.deliver("INBOX", seed(1), ago(2));

      const first = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(first, "inbox")?.stored).toBe(1);
      expect(of(first, "offers")?.copiesBelowCursor).toBe(1);
      expect(of(first, "offers")?.copiesStored).toBe(0);
      const keysOf = async () =>
        (await trx.selectFrom("emails").select("dedup_key").where("mailbox_id", "=", s.mailboxId).execute())
          .map((row) => row.dedup_key)
          .filter((key) => key.startsWith(moved.dedup_key))
          .sort();
      expect(await keysOf()).toEqual([moved.dedup_key, `${moved.dedup_key}#2`]);

      const second = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(second, "offers")?.copiesBelowCursor).toBe(1);
      expect(of(second, "offers")?.copiesStored).toBe(1);
      expect(await keysOf()).toEqual([moved.dedup_key, `${moved.dedup_key}#2`, `${moved.dedup_key}#3`]);
      const copy = await trx
        .selectFrom("emails")
        .select(["folder", "source_folder"])
        .where("dedup_key", "=", `${moved.dedup_key}#3`)
        .executeTakeFirstOrThrow();
      expect(copy).toEqual({ folder: OFFERS, source_folder: OFFERS });
    });
  });
});

// The sync lines are events with ids, folder keys and counts only.
describe("syncMailbox: log lines", () => {
  const OFFERS = "Oferty";
  const FOLDER_NOW = new Date("2026-11-08T12:00:00Z");
  const MARKER_SUBJECT = "MARKER-SUBJECT canary-3d9f";
  const ago = (hours: number): { internalDate: Date } => ({
    internalDate: new Date(FOLDER_NOW.getTime() - hours * 3_600_000),
  });
  const folderDeps = (trx: Db | Transaction<DB>, provider: MailProvider) =>
    deps(trx, provider, { now: () => FOLDER_NOW });
  const ids = async (trx: Transaction<DB>, mailboxId: string) =>
    (await trx.selectFrom("emails").select("id").where("mailbox_id", "=", mailboxId).orderBy("uid").execute()).map(
      (row) => row.id
    );

  async function offersRow(trx: Transaction<DB>, s: Setup): Promise<void> {
    await trx
      .insertInto("mailbox_folders")
      .values({
        org_id: s.ctx.orgId,
        mailbox_id: s.mailboxId,
        key: "offers",
        path: OFFERS,
        role: "sort",
        enabled: true,
        uidvalidity: 1,
        last_uid: 0,
      })
      .execute();
  }

  function globalUidFake(keepUidOnUserMove: boolean): FakeMailProvider {
    return createFakeMailProvider({
      uidValidity: UID_VALIDITY,
      globalUids: true,
      keepUidOnUserMove,
      uidNextValue: 1,
      capabilities: { move: false },
    });
  }

  test("each folder writes sync_folder_done with its key, its mode and the nine counts, never a subject", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: globalUidFake(true) };
      await offersRow(trx, s);
      await s.fake.ensureFolder(OFFERS);
      s.fake.deliver("INBOX", seed(1, { subject: MARKER_SUBJECT }), ago(1));
      const lines = await withDebugLines(async () => {
        await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      });

      const mine = `[mail] sync_folder_done org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId}`;
      const zero = "relocated=0 cross_copies=0 move_in_flight=0 skipped_own=0 ignored_below_cursor=0";
      expect(lines.filter((line) => line.includes("sync_folder_done"))).toEqual([
        `${mine} folder_key=inbox sync_mode=incremental fetched=1 stored=1 uid_updated=0 returned=0 ${zero}`,
        `${mine} folder_key=offers sync_mode=incremental fetched=0 stored=0 uid_updated=0 returned=0 ${zero}`,
      ]);
      expect(lines.join("\n")).not.toContain("MARKER");
    });
  });

  test("an update of a UID that changes no row writes sync_uid_update_no_row with the mail id", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: globalUidFake(true) };
      s.fake.deliver("INBOX", seed(1), ago(2));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      const [first] = await ids(trx, s.mailboxId);
      expect(await forceRescan(trx, s.ctx, s.mailboxId)).toBe(true);
      const second = s.fake.deliver("INBOX", seed(2, { subject: MARKER_SUBJECT }), ago(1));
      // The first mail is planned as an update. While the second mail's body is read, the first row leaves INBOX.
      const provider: MailProvider = {
        ...s.fake,
        fetchContent: async (folder, uid) => {
          if (uid === second) {
            await trx
              .updateTable("emails")
              .set({ folder: "Elsewhere" })
              .where("id", "=", first as string)
              .execute();
          }
          return s.fake.fetchContent(folder, uid);
        },
      };

      const lines = await withDebugLines(async () => {
        const result = await syncMailbox(folderDeps(trx, provider), s.ctx, s.mailboxId);
        expect(result.mode).toBe("rescan");
        expect(result.uidUpdated).toBe(0);
        expect(result.stored).toBe(1);
      });

      expect(lines.filter((line) => line.includes("_no_row"))).toEqual([
        `[mail] sync_uid_update_no_row org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} email_id=${first}`,
      ]);
      expect(lines.join("\n")).not.toContain("MARKER");
    });
  });

  test("a return that changes no row writes sync_return_no_row with the mail id", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = s.fake.deliver("INBOX", seed(1));
      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      const [first] = await ids(trx, s.mailboxId);
      await trx.updateTable("emails").set({ folder: "AI/Info" }).where("mailbox_id", "=", s.mailboxId).execute();
      const archived = s.fake.userMove("INBOX", uid, "AI/Info");
      s.fake.userMove("AI/Info", archived, "INBOX");
      const second = s.fake.deliver("INBOX", seed(2, { subject: MARKER_SUBJECT }));
      // The first mail is planned as returned. While the second mail's body is read, the row is back in its source folder.
      const provider: MailProvider = {
        ...s.fake,
        fetchContent: async (folder, readUid) => {
          if (readUid === second) {
            await trx
              .updateTable("emails")
              .set({ folder: "INBOX" })
              .where("id", "=", first as string)
              .execute();
          }
          return s.fake.fetchContent(folder, readUid);
        },
      };

      const lines = await withDebugLines(async () => {
        const result = await syncMailbox(deps(trx, provider), s.ctx, s.mailboxId);
        expect(result.returned).toBe(0);
        expect(result.stored).toBe(1);
      });

      expect(lines.filter((line) => line.includes("_no_row"))).toEqual([
        `[mail] sync_return_no_row org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} email_id=${first}`,
      ]);
      expect(lines.join("\n")).not.toContain("MARKER");
    });
  });

  test("a move between folders that changes no row writes sync_move_no_row with the mail id", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: globalUidFake(false) };
      await offersRow(trx, s);
      await s.fake.ensureFolder(OFFERS);
      const uid = s.fake.deliver("INBOX", seed(1), ago(2));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      const [first] = await ids(trx, s.mailboxId);
      s.fake.userMove("INBOX", uid, OFFERS);
      const second = s.fake.deliver(OFFERS, seed(2, { subject: MARKER_SUBJECT }), ago(1));
      // The first mail is planned as relocated. While the second mail's body is read, the row leaves INBOX.
      const provider: MailProvider = {
        ...s.fake,
        fetchContent: async (folder, readUid) => {
          if (readUid === second) {
            await trx
              .updateTable("emails")
              .set({ folder: "Elsewhere" })
              .where("id", "=", first as string)
              .execute();
          }
          return s.fake.fetchContent(folder, readUid);
        },
      };

      const lines = await withDebugLines(async () => {
        const result = await syncMailbox(folderDeps(trx, provider), s.ctx, s.mailboxId);
        expect(result.failed).toEqual([]);
        expect(result.folders.find((item) => item.folder === "offers")?.relocated).toBe(0);
      });

      expect(lines.filter((line) => line.includes("_no_row"))).toEqual([
        `[mail] sync_move_no_row org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} email_id=${first}`,
      ]);
      expect(lines.join("\n")).not.toContain("MARKER");
    });
  });
});
