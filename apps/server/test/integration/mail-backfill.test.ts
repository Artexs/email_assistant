import { randomBytes } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { isOwnActionId } from "../../src/modules/actions";
import {
  backfillInbox,
  backfillMailbox,
  CursorMovedError,
  syncMailbox,
  type MailProvider,
  type SeedMessage,
  type SyncDeps,
} from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { insertCredentials, updateCursor } from "../../src/modules/mail/repo";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, Db, TenantContext } from "../../src/platform/db";
import { HardError, SoftError } from "../../src/platform/errors";

import { createOrgWithMailbox, insertAction, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const UID_VALIDITY = 7;
const NOW = new Date("2026-11-03T12:00:00Z");
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function deps(trx: Db | Transaction<DB>, provider: MailProvider): SyncDeps {
  return { db: trx, provider, isOwnActionId: async () => false, now: () => NOW };
}

function seed(n: number): SeedMessage {
  return {
    messageId: `<b${n}@x.test>`,
    from: `sender${n}@x.test`,
    to: ["box@x.test"],
    subject: `Mail ${n}`,
    date: NOW,
    text: `Body ${n}`,
  };
}

async function setup(trx: Transaction<DB>, synced = true) {
  const { orgId, mailboxId } = await createOrgWithMailbox(trx);
  const ctx: TenantContext = { orgId };
  if (synced) {
    const moved = await updateCursor(
      trx,
      ctx,
      mailboxId,
      { uidValidity: null, lastUid: null },
      { uidValidity: UID_VALIDITY, lastUid: 0 }
    );
    expect(moved).toBe(true);
  }
  return { ctx, mailboxId, fake: createFakeMailProvider({ uidValidity: UID_VALIDITY }) };
}

// Four mails (uids 1-4) of which only the newest is in the 1-day initial window; the initial sync stores it.
async function syncedMailbox(trx: Transaction<DB>) {
  const s = await setup(trx, false);
  s.fake.deliver("INBOX", seed(1), { internalDate: ago(40 * DAY_MS) });
  s.fake.deliver("INBOX", seed(2), { internalDate: ago(20 * DAY_MS) });
  s.fake.deliver("INBOX", seed(3), { internalDate: ago(10 * DAY_MS) });
  s.fake.deliver("INBOX", seed(4), { internalDate: ago(2 * HOUR_MS) });
  const initial = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
  expect(initial.mode).toBe("initial");
  expect(initial.stored).toBe(1);
  s.fake.deliver("INBOX", seed(5), { internalDate: ago(HOUR_MS) });
  return s;
}

describe("mailbox without an INBOX folder row", () => {
  test("syncMailbox and backfillInbox throw a HardError", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await trx
        .deleteFrom("mailbox_folders")
        .where("mailbox_id", "=", s.mailboxId)
        .where("key", "=", "inbox")
        .execute();
      const since = ago(DAY_MS);
      const sync = syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      await expect(sync).rejects.toBeInstanceOf(HardError);
      await expect(sync).rejects.toThrow("mailbox has no INBOX folder row");
      const backfill = backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since });
      await expect(backfill).rejects.toBeInstanceOf(HardError);
      await expect(backfill).rejects.toThrow("mailbox has no INBOX folder row");
    });
  });
});

async function emails(trx: Db | Transaction<DB>, mailboxId: string) {
  return trx
    .selectFrom("emails")
    .select(["message_id_header", "uid", "backfilled_at"])
    .where("mailbox_id", "=", mailboxId)
    .orderBy("message_id_header")
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

const SINCE = ago(30 * DAY_MS);

function ownOf(trx: Db | Transaction<DB>): SyncDeps["isOwnActionId"] {
  return (ctx, mailboxId, actionId) => isOwnActionId(trx, ctx, mailboxId, actionId);
}

describe("backfillInbox", () => {
  test("stores the missing mails of the window with backfilled_at and keeps the cursor", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: 4 });

      const result = await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: SINCE });
      expect(result.mode).toBe("backfill");
      expect(result.stored).toBe(3);
      expect(result.uidUpdated).toBe(1);

      const byId = new Map((await emails(trx, s.mailboxId)).map((row) => [row.message_id_header, row]));
      expect(byId.size).toBe(4);
      expect(byId.has("<b1@x.test>")).toBe(false);
      for (const id of ["<b2@x.test>", "<b3@x.test>", "<b5@x.test>"]) {
        expect(byId.get(id)?.backfilled_at?.getTime()).toBe(NOW.getTime());
      }
      expect(byId.get("<b4@x.test>")?.backfilled_at).toBeNull();
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: 4 });

      const readOnly = [
        "inboxStatus",
        "searchInboxSince",
        "fetchByUids",
        "fetchBodyText",
        "fetchMetaIn",
        "searchSinceIn",
        "fetchByUidsIn",
      ];
      for (const call of s.fake.calls) expect(readOnly).toContain(call);
    });
  });

  test("a mail with the X-EA-Action-Id of a draft of this mailbox is skipped", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      const emailId = await insertTestEmail(trx, s.ctx, s.mailboxId);
      const draftId = await insertAction(trx, s.ctx, emailId, { type: "create_draft", status: "ready" });
      s.fake.deliver("INBOX", { ...seed(6), headers: { "X-EA-Action-Id": draftId } }, { internalDate: ago(HOUR_MS) });
      s.fake.deliver(
        "INBOX",
        { ...seed(7), headers: { "X-EA-Action-Id": crypto.randomUUID() } },
        { internalDate: ago(HOUR_MS) }
      );

      const result = await backfillInbox({ ...deps(trx, s.fake), isOwnActionId: ownOf(trx) }, s.ctx, s.mailboxId, {
        since: SINCE,
      });
      expect(result.skippedOwn).toBe(1);
      const ids = (await emails(trx, s.mailboxId)).map((row) => row.message_id_header);
      expect(ids).not.toContain("<b6@x.test>");
      expect(ids).toContain("<b7@x.test>");
    });
  });

  test("a since more than 180 days back gives HardError before any call", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      s.fake.calls.length = 0;
      await expect(
        backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: ago(181 * DAY_MS) })
      ).rejects.toBeInstanceOf(HardError);
      expect(s.fake.calls).toEqual([]);
    });
  });

  test("a second run stores nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: SINCE });
      const again = await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: SINCE });
      expect(again.stored).toBe(0);
      expect((await emails(trx, s.mailboxId)).length).toBe(4);
    });
  });

  test("the next incremental sync finds the backfilled mail above the cursor", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: SINCE });

      const next = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(next.mode).toBe("incremental");
      expect(next.stored).toBe(0);
      expect(next.uidUpdated).toBe(1);
      expect(await cursorOf(trx, s.mailboxId)).toEqual({ uidValidity: UID_VALIDITY, lastUid: 5 });
      const rows = await emails(trx, s.mailboxId);
      expect(new Set(rows.map((row) => row.message_id_header)).size).toBe(rows.length);
      expect(rows.length).toBe(4);
    });
  });

  test("a changed UIDVALIDITY gives SoftError before any search", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      s.fake.resetUidValidity(UID_VALIDITY + 1);
      s.fake.calls.length = 0;

      await expect(backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: SINCE })).rejects.toBeInstanceOf(
        SoftError
      );
      expect(s.fake.calls).not.toContain("searchInboxSince");
      expect((await emails(trx, s.mailboxId)).length).toBe(1);
    });
  });

  test("a mailbox that was never synced gives HardError", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, false);
      await expect(backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: SINCE })).rejects.toBeInstanceOf(
        HardError
      );
      expect((await emails(trx, s.mailboxId)).length).toBe(0);
    });
  });

  test("a cursor moved during the backfill gives CursorMovedError and stores nothing of that chunk", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      const provider: MailProvider = {
        ...s.fake,
        serverInfo: () => s.fake.serverInfo(),
        inboxStatus: () => s.fake.inboxStatus(),
        fetchAbove: (lastUid) => s.fake.fetchAbove(lastUid),
        searchInboxSince: (since) => s.fake.searchInboxSince(since),
        fetchByUids: (uids) => s.fake.fetchByUids(uids),
        fetchBodyText: async (uid) => {
          await updateCursor(
            trx,
            s.ctx,
            s.mailboxId,
            { uidValidity: UID_VALIDITY, lastUid: 4 },
            { uidValidity: UID_VALIDITY, lastUid: 5 }
          );
          return s.fake.fetchBodyText(uid);
        },
        close: () => s.fake.close(),
      };

      await expect(backfillInbox(deps(trx, provider), s.ctx, s.mailboxId, { since: SINCE })).rejects.toBeInstanceOf(
        CursorMovedError
      );
      expect((await emails(trx, s.mailboxId)).length).toBe(1);
    });
  });

  test("another organization cannot backfill this mailbox", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      const other = await createOrgWithMailbox(trx);
      await expect(
        backfillInbox(deps(trx, s.fake), { orgId: other.orgId }, s.mailboxId, { since: SINCE })
      ).rejects.toThrow("mailbox");
      await expect(
        backfillInbox(deps(trx, s.fake), { orgId: other.orgId }, s.mailboxId, { since: SINCE })
      ).rejects.toBeInstanceOf(HardError);
    });
  });
});

describe("backfillMailbox", () => {
  const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

  async function withPassword(trx: Transaction<DB>, s: { ctx: TenantContext; mailboxId: string }) {
    const secret = secrets.encrypt("pw", `mailbox:${s.mailboxId}`);
    await insertCredentials(trx, s.ctx, {
      mailboxId: s.mailboxId,
      encryptedSecret: secret.ciphertext,
      secretKind: "password",
      keyVersion: secret.keyVersion,
    });
  }

  test("runs the backfill over the opened provider and closes it", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await withPassword(trx, s);
      const result = await backfillMailbox(
        { db: trx, secrets, openProvider: async () => s.fake, isOwnActionId: ownOf(trx) },
        s.ctx,
        s.mailboxId,
        {
          days: 30,
          now: NOW,
        }
      );
      expect(result.mode).toBe("backfill");
      expect(result.stored).toBe(3);
      expect(result.uidUpdated).toBe(1);
      expect(s.fake.closed).toBe(true);
    });
  });

  test("closes the provider when the backfill fails", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await withPassword(trx, s);
      s.fake.resetUidValidity(UID_VALIDITY + 1);
      await expect(
        backfillMailbox(
          { db: trx, secrets, openProvider: async () => s.fake, isOwnActionId: ownOf(trx) },
          s.ctx,
          s.mailboxId,
          {
            days: 30,
            now: NOW,
          }
        )
      ).rejects.toBeInstanceOf(SoftError);
      expect(s.fake.closed).toBe(true);
    });
  });

  test("a mailbox without stored credentials gives HardError and opens no provider", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      let opened = 0;
      const attempt = backfillMailbox(
        {
          db: trx,
          secrets,
          isOwnActionId: ownOf(trx),
          openProvider: async () => {
            opened += 1;
            return s.fake;
          },
        },
        s.ctx,
        s.mailboxId,
        { days: 30, now: NOW }
      );
      await expect(attempt).rejects.toBeInstanceOf(HardError);
      await expect(attempt).rejects.toThrow("mailbox has no stored password");
      expect(opened).toBe(0);
    });
  });
});
