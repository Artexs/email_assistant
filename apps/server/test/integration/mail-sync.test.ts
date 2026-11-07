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
import { forceRescan, updateCursor } from "../../src/modules/mail/repo";
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
    ...fake,
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

// Runs `hook` once, right after the first call of `method` returns.
function afterFirstCall(
  fake: FakeMailProvider,
  method: "inboxStatus" | "searchInboxSince",
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
    inboxStatus: async () => {
      const status = await fake.inboxStatus();
      return method === "inboxStatus" ? once(status) : status;
    },
    fetchAbove: (lastUid) => fake.fetchAbove(lastUid),
    searchInboxSince: async (since) => {
      const uids = await fake.searchInboxSince(since);
      return method === "searchInboxSince" ? once(uids) : uids;
    },
    fetchByUids: (uids) => fake.fetchByUids(uids),
    fetchBodyText: (uid) => fake.fetchBodyText(uid),
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

  test("a mail delivered after inboxStatus and before the search is stored and sets the cursor", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupNew(trx);
      s.fake.deliver("INBOX", seed(1), { internalDate: hoursAgo(2) });
      let late = 0;
      const provider = afterFirstCall(s.fake, "inboxStatus", () => {
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
      const { uidNext } = await s.fake.inboxStatus();
      let late = 0;
      const provider = afterFirstCall(s.fake, "searchInboxSince", () => {
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
            .selectFrom("mailboxes")
            .select(["uidvalidity", "last_uid"])
            .where("id", "=", s.mailboxId)
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
        .selectFrom("mailboxes")
        .select(["uidvalidity", "last_uid"])
        .where("id", "=", s.mailboxId)
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
