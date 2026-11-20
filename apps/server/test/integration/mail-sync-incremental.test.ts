import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { isOwnActionId } from "../../src/modules/actions";
import { CursorMovedError, syncMailbox, type MailProvider } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { forceRescan, updateCursor } from "../../src/modules/mail/repo";
import type { DB, TenantContext } from "../../src/platform/db";
import { SoftError } from "../../src/platform/errors";

import { createOrgWithMailbox, insertAction, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import {
  UID_VALIDITY,
  type Setup,
  setup,
  hoursAgo,
  deps,
  seed,
  emails,
  cursorOf,
  onBodyCall,
} from "./mail-sync-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

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
