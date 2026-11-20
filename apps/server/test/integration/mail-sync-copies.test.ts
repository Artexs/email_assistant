import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { syncMailbox } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import type { DB } from "../../src/platform/db";

import { testDb, withRollback } from "./helpers";
import { UID_VALIDITY, type Setup, setup, NOW, hoursAgo, deps, seed, emails, cursorOf } from "./mail-sync-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

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
});
