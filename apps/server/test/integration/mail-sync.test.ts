import { afterAll, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { isOwnActionId } from "../../src/modules/actions";
import {
  CursorMovedError,
  syncMailbox,
  type MailProvider,
  type SeedMessage,
  type SyncDeps,
} from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { forceRescan, updateCursor } from "../../src/modules/mail/repo";
import { RETURN_CHECK_LIMIT } from "../../src/modules/mail/sync";
import type { DB, Db, TenantContext } from "../../src/platform/db";
import { SoftError } from "../../src/platform/errors";

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

// Runs `hook` before the n-th call of fetchBodyText, then calls the fake.
function onBodyCall(fake: FakeMailProvider, hook: (call: number) => Promise<void>): MailProvider {
  let call = 0;
  return {
    ...fake,
    serverInfo: () => fake.serverInfo(),
    folderStatus: (folder) => fake.folderStatus(folder),
    fetchAbove: (folder, lastUid) => fake.fetchAbove(folder, lastUid),
    fetchBodyText: async (folder, uid) => {
      call += 1;
      await hook(call);
      return fake.fetchBodyText(folder, uid);
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
    fetchBodyText: (folder, uid) => fake.fetchBodyText(folder, uid),
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
      expect(first).toEqual({
        mode: "incremental",
        fetched: 2,
        stored: 2,
        uidUpdated: 0,
        returned: 0,
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
        if (call === 3) s.fake.failOn("fetchBodyText", new SoftError("x"), 1);
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
        if (call === 3) fake.failOn("fetchBodyText", new SoftError("x"), 1);
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
        if (call === 3) s.fake.failOn("fetchBodyText", new SoftError("x"), 1);
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
      s.fake.failOn("fetchBodyText", new SoftError("x"), 1);

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
