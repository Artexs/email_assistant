import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  CursorMovedError,
  syncMailbox,
  type MailProvider,
  type SeedMessage,
  type SyncDeps,
} from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { updateCursor } from "../../src/modules/mail/repo";
import type { DB, Db, TenantContext } from "../../src/platform/db";
import { SoftError } from "../../src/platform/errors";

import { createOrgWithMailbox } from "./fixtures";
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

function deps(trx: Db | Transaction<DB>, provider: MailProvider, overrides: Partial<SyncDeps> = {}): SyncDeps {
  return {
    db: trx,
    provider,
    isOwnActionId: async () => false,
    now: () => new Date("2026-11-03T12:00:00Z"),
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
    .selectFrom("mailboxes")
    .select(["uidvalidity", "last_uid"])
    .where("id", "=", mailboxId)
    .executeTakeFirstOrThrow();
  return { uidValidity: Number(row.uidvalidity), lastUid: Number(row.last_uid) };
}

// Runs `hook` before the n-th call of fetchBodyText, then calls the fake.
function onBodyCall(fake: FakeMailProvider, hook: (call: number) => Promise<void>): MailProvider {
  let call = 0;
  return {
    serverInfo: () => fake.serverInfo(),
    inboxStatus: () => fake.inboxStatus(),
    fetchAbove: (lastUid) => fake.fetchAbove(lastUid),
    searchInboxSince: (since) => fake.searchInboxSince(since),
    fetchByUids: (uids) => fake.fetchByUids(uids),
    fetchBodyText: async (uid) => {
      call += 1;
      await hook(call);
      return fake.fetchBodyText(uid);
    },
    findByMessageId: (folder, messageId) => fake.findByMessageId(folder, messageId),
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
          await trx.updateTable("mailboxes").set({ last_uid: 99 }).where("id", "=", s.mailboxId).execute();
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

  test("a mailbox without a cursor waits for stage 7", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const fake = createFakeMailProvider({ uidValidity: UID_VALIDITY });
      await expect(syncMailbox(deps(trx, fake), { orgId }, mailboxId)).rejects.toThrow("stage 7");
    });
  });
});
