import { afterAll, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { isOwnActionId } from "../../src/modules/actions";
import {
  CursorMovedError,
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
  test("after an incremental sync mailboxes.last_uid equals the INBOX folder row (dual write)", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      s.fake.deliver("INBOX", seed(1));
      s.fake.deliver("INBOX", seed(2));
      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.mode).toBe("incremental");

      const mailbox = await trx
        .selectFrom("mailboxes")
        .select(["uidvalidity", "last_uid"])
        .where("id", "=", s.mailboxId)
        .executeTakeFirstOrThrow();
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: 2 });
      expect({ uidValidity: Number(mailbox.uidvalidity), lastUid: Number(mailbox.last_uid) }).toEqual({
        uidValidity: UID_VALIDITY,
        lastUid: 2,
      });
    });
  });

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
    .select(["id", "uid", "inbox_uid", "folder", "returned_at", "moved_at"])
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirstOrThrow();
  return { ...row, uid: Number(row.uid), inbox_uid: Number(row.inbox_uid) };
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
      expect(row).toMatchObject({ folder: "INBOX", uid, inbox_uid: uid });
      expect(await cursorOf(trx, s.mailboxId)).toEqual(before);
      expect(await emails(trx, s.mailboxId)).toHaveLength(1);
      expect(spy.folderCalls.filter((call) => call.folder === "AI/Info").map((call) => call.method)).toEqual([
        "fetchMetaIn",
        "searchSinceIn",
      ]);
    });
  });

  test("a copy back to INBOX that leaves the mail in its folder is counted, not returned", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      const uid = await storeAndMark(trx, s);
      const inFolder = s.fake.deliver("AI/Info", seed(1));
      await trx.updateTable("emails").set({ uid: inFolder }).where("mailbox_id", "=", s.mailboxId).execute();

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.copiesBelowCursor).toBe(1);
      expect(result.returnedBelowCursor).toBe(0);
      const row = await movedRowOf(trx, s.mailboxId);
      expect(row).toMatchObject({ folder: "AI/Info", uid: inFolder, inbox_uid: uid, returned_at: null });
      expect(await emails(trx, s.mailboxId)).toHaveLength(1);
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
        inbox_uid: uid,
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
          inbox_uid: n,
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
        inbox_uid: uid,
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
      expect(row).toMatchObject({ folder: "INBOX", uid: back, inbox_uid: back });
    });
  });

  test("the system COPY shape: the folder uid differs, the cursor passed it, the user move back is found", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      const inboxUid = s.fake.deliver("INBOX", seed(1));
      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      // Three mails in AI/Info already: the system COPY gives the moved mail the folder uid 4.
      for (const n of [11, 12, 13]) s.fake.deliver("AI/Info", seed(n));
      const folderUid = s.fake.userMove("INBOX", inboxUid, "AI/Info");
      expect(folderUid).toBe(4);
      expect(folderUid).not.toBe(inboxUid);
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
        .select(["uid", "inbox_uid", "folder", "returned_at"])
        .where("mailbox_id", "=", s.mailboxId)
        .where("folder", "=", "INBOX")
        .where("returned_at", "is not", null)
        .executeTakeFirstOrThrow();
      expect({ uid: Number(row.uid), inbox_uid: Number(row.inbox_uid), folder: row.folder }).toEqual({
        uid: folderUid,
        inbox_uid: folderUid,
        folder: "INBOX",
      });
      expect(row.returned_at).toBeInstanceOf(Date);
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
          inbox_uid: n,
          moved_at: new Date(NOW.getTime() - n * 1000),
        });
      }
      const spy = spyFolderReads(s.fake);
      const warn = spyOn(console, "error").mockImplementation(() => undefined);
      try {
        await syncMailbox(deps(trx, spy.provider), s.ctx, s.mailboxId);
        expect(spy.folderCalls.filter((call) => call.method === "fetchByUidsIn")).toHaveLength(5);
        const lines = warn.mock.calls.map((call) => call.join(" "));
        expect(lines.some((line) => line.includes(`list hit the limit ${RETURN_CHECK_LIMIT}`))).toBe(true);
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
        expect(warn.mock.calls.some((call) => call.join(" ").includes("cursor moved"))).toBe(true);
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
      .select(["uid", "inbox_uid", "folder", "source_folder", "status", "subject"])
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
          return warn.mock.calls.map((call) => call.join(" "));
        },
        get info() {
          return info.mock.calls.map((call) => call.join(" "));
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
        expect(lines.info.some((line) => line.includes(`sync ${s.mailboxId}: added sync folders offers`))).toBe(true);
      });
      const rows = await storedRows(trx, s.mailboxId);
      expect(rows.map((row) => row.subject)).toEqual(["Mail 1", "Mail 2"]);
      expect(rows.every((row) => row.folder === OFFERS && row.source_folder === OFFERS)).toBe(true);
      expect(rows.map((row) => Number(row.inbox_uid))).toEqual(rows.map((row) => Number(row.uid)));
      expect((await folderRow(trx, s.mailboxId, "offers"))?.lastUid).toBe(old);
    });
  });

  test("1b. the first VPS run: four default folders are added at once, INBOX stays incremental, AI/Spam is never synced", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await s.fake.ensureFolder("AI/Spam");
      // One UID counter: the UIDs interleave across the folders.
      s.fake.deliver(SOCIAL, seed(1), ago(100));
      const inboxUid = s.fake.deliver("INBOX", seed(2), ago(50));
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
        uid: inboxUid,
        inbox_uid: inboxUid,
        subject: "Migrated",
      });

      await withLogs(async (lines) => {
        const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
        expect(result.added).toEqual(["offers", "social", "bills", "junk"]);
        expect(result.failed).toEqual([]);
        expect(
          lines.info.some((line) => line.includes(`sync ${s.mailboxId}: added sync folders offers,social,bills,junk`))
        ).toBe(true);
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
        expect(lines.warn.filter((line) => line.includes("not on the server"))).toHaveLength(1);
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
          if (broken && folder === OFFERS) throw new SoftError("lost connection");
          return s.fake.fetchAbove(folder, lastUid);
        },
      };

      await withLogs(async (lines) => {
        const result = await syncMailbox(folderDeps(trx, provider), s.ctx, s.mailboxId);
        expect(result.stored).toBe(1);
        expect(result.failed).toEqual(["offers"]);
        expect(of(result, "junk")?.stored).toBe(1);
        expect(lines.warn.some((line) => line.includes("folder offers: SoftError; the next tick tries again"))).toBe(
          true
        );
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
      expect(rows.map((row) => Number(row.inbox_uid))).toEqual(uids);
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
        expect(lines.warn.some((line) => line.includes("folder offers: CursorMovedError"))).toBe(true);
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

  // Cross-folder dedup (stage 7b).
  async function crossRows(trx: Db | Transaction<DB>, mailboxId: string) {
    const rows = await trx
      .selectFrom("emails")
      .select(["dedup_key", "uid", "inbox_uid", "folder", "source_folder", "returned_at", "moved_at"])
      .where("mailbox_id", "=", mailboxId)
      .orderBy("uid")
      .execute();
    return rows.map((row) => ({
      ...row,
      uid: Number(row.uid),
      inbox_uid: row.inbox_uid === null ? null : Number(row.inbox_uid),
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

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.failed).toEqual([]);
      expect(of(result, "offers")?.stored).toBe(0);
      expect(of(result, "offers")?.crossCopies).toBe(1);
      const rows = await crossRows(trx, s.mailboxId);
      expect(rows.map((row) => row.folder)).toEqual(["INBOX"]);
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
        inbox_uid: moved,
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
        inbox_uid: back,
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
        inbox_uid: filed,
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
        .set({ undo_pending_at: new Date(FOLDER_NOW.getTime() - 60_000) })
        .where("mailbox_id", "=", s.mailboxId)
        .execute();
      s.fake.deliver("INBOX", seed(1), ago(1));
      s.fake.deliver(OFFERS, seed(1), ago(1));
      const callsBefore = s.fake.folderCalls.length;

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "inbox")?.moveInFlight).toBe(1);
      expect(of(result, "offers")?.moveInFlight).toBe(1);
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
      expect(rows[0]).toMatchObject({ folder: OFFERS, source_folder: OFFERS, uid: offersUid, inbox_uid: offersUid });
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
      s.fake.failOn("listFolders", new HardError("list failed"));

      await withLogs(async (lines) => {
        const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
        expect(result.stored).toBe(1);
        expect(of(result, "offers")?.stored).toBe(1);
        expect(result.added).toEqual([]);
        expect(lines.warn.filter((line) => line.includes("folder discovery failed: HardError"))).toHaveLength(1);
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

  // Stage 8: a mail of source folder `path` (Mail 1) that the system moved to AI/Info an hour ago; `path` has a later mail
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
      .select(["uid", "inbox_uid", "folder", "source_folder", "returned_at"])
      .where("id", "=", rowId)
      .executeTakeFirstOrThrow();
    return { ...row, uid: Number(row.uid), inbox_uid: Number(row.inbox_uid) };
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
        expect(
          lines.info.some((line) =>
            line.includes(`sync ${s.mailboxId} folder offers returned below cursor: checked 1, returned 1, copies 0`)
          )
        ).toBe(true);
      });
      const row = await rowById(trx, rowId);
      expect(row).toMatchObject({ folder: OFFERS, source_folder: OFFERS, uid: inFolder, inbox_uid: inFolder });
      expect(row.returned_at).toEqual(FOLDER_NOW);
      expect(await storedRows(trx, s.mailboxId)).toHaveLength(2);
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
      expect(of(result, "offers")?.returnedBelowCursor).toBe(0);
      const row = await rowById(trx, rowId);
      expect(row).toMatchObject({ folder: "AI/Info", uid: inFolder, inbox_uid: uid, returned_at: null });
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
      expect(row).toMatchObject({ folder: "INBOX", source_folder: "INBOX", uid, inbox_uid: uid });
      expect(row.returned_at).toEqual(FOLDER_NOW);
    });
  });

  test("8.4 a mail of source INBOX that the user files into Oferty below its cursor is not seen (known limit)", async () => {
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
      expect(row).toMatchObject({ folder: JUNK, source_folder: JUNK, uid, inbox_uid: uid });
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
});
