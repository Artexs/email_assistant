import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  backfillInbox,
  syncMailbox,
  type CapturedHeaders,
  type MailProvider,
  type SeedMessage,
  type SyncDeps,
} from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { updateCursor } from "../../src/modules/mail/repo";
import type { DB, Db, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const UID_VALIDITY = 7;
const NOW = new Date("2026-11-03T12:00:00Z");

function deps(trx: Db | Transaction<DB>, provider: MailProvider): SyncDeps {
  return { db: trx, provider, isOwnActionId: async () => false, now: () => NOW };
}

function seed(n: number, overrides: Partial<SeedMessage> = {}): SeedMessage {
  return {
    messageId: `<c${n}@x.test>`,
    from: `sender${n}@x.test`,
    to: ["box@x.test"],
    subject: `Mail ${n}`,
    date: new Date(Date.UTC(2026, 10, 3, 8, 0, n)),
    text: `Body ${n}`,
    ...overrides,
  };
}

async function setup(trx: Transaction<DB>, opts: { bodyLimitBytes?: number } = {}) {
  const { orgId, mailboxId } = await createOrgWithMailbox(trx);
  const ctx: TenantContext = { orgId };
  const moved = await updateCursor(
    trx,
    ctx,
    mailboxId,
    { uidValidity: null, lastUid: null },
    { uidValidity: UID_VALIDITY, lastUid: 0 }
  );
  expect(moved).toBe(true);
  return { ctx, mailboxId, fake: createFakeMailProvider({ uidValidity: UID_VALIDITY, ...opts }) };
}

async function rows(trx: Db | Transaction<DB>, mailboxId: string) {
  return trx
    .selectFrom("emails")
    .leftJoin("email_headers", "email_headers.email_id", "emails.id")
    .select([
      "emails.uid",
      "emails.body_text",
      "emails.backfilled_at",
      "email_headers.email_id as header_id",
      "email_headers.reply_to",
      "email_headers.list_unsubscribe",
      "email_headers.return_path",
      "email_headers.parts_known",
    ])
    .where("emails.mailbox_id", "=", mailboxId)
    .orderBy("emails.uid")
    .execute();
}

async function cursorOf(trx: Db | Transaction<DB>, mailboxId: string): Promise<number> {
  const row = await trx.selectFrom("mailboxes").select("last_uid").where("id", "=", mailboxId).executeTakeFirstOrThrow();
  return Number(row.last_uid);
}

// A provider whose fetchContent changes the capture of some mails.
function withCapture(
  inner: MailProvider,
  change: (uid: number, capture: CapturedHeaders | null) => CapturedHeaders | null
): MailProvider {
  return {
    ...inner,
    async fetchContent(folder, uid) {
      const content = await inner.fetchContent(folder, uid);
      return { ...content, capture: change(uid, content.capture) };
    },
  };
}

describe("sync stores the capture", () => {
  test("1-2: two new mails give two header rows; a second sync adds none", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      s.fake.deliver(
        "INBOX",
        seed(1, { headers: { "Reply-To": "Other@else.test", "List-Unsubscribe": "<https://u.test/x>" } })
      );
      s.fake.deliver("INBOX", seed(2));

      const first = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(first.stored).toBe(2);
      expect(first.captureMissing).toBe(0);
      const stored = await rows(trx, s.mailboxId);
      expect(stored.map((row) => row.header_id !== null)).toEqual([true, true]);
      expect(stored[0]?.reply_to).toEqual(["other@else.test"]);
      expect(stored[0]?.list_unsubscribe).toBe("<https://u.test/x>");
      expect(stored[1]?.reply_to).toEqual([]);

      const second = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(second.stored).toBe(0);
      expect(await rows(trx, s.mailboxId)).toHaveLength(2);
      const count = await trx
        .selectFrom("email_headers")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .executeTakeFirstOrThrow();
      expect(Number(count.n)).toBe(2);
    });
  });

  test("3: a mail over the body limit has a header row with partsKnown false and no body", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, { bodyLimitBytes: 50 });
      s.fake.deliver("INBOX", seed(1, { text: "x".repeat(500) }));

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.stored).toBe(1);
      const [row] = await rows(trx, s.mailboxId);
      expect(row?.header_id).not.toBeNull();
      expect(row?.parts_known).toBe(false);
      expect(row?.body_text).toBeNull();
    });
  });

  test("4: a capture the database refuses loses only its own header row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      for (const n of [1, 2, 3]) s.fake.deliver("INBOX", seed(n));
      // The stage 01 cut keeps this under 320 characters; the CHECK of the table is the second line.
      const hostile = withCapture(s.fake, (uid, capture) =>
        uid === 1 && capture !== null ? { ...capture, returnPath: "r".repeat(400) } : capture
      );

      const result = await syncMailbox(deps(trx, hostile), s.ctx, s.mailboxId);
      expect(result.stored).toBe(3);
      expect(result.captureMissing).toBe(1);
      expect((await rows(trx, s.mailboxId)).map((row) => row.header_id !== null)).toEqual([false, true, true]);
      expect(await cursorOf(trx, s.mailboxId)).toBe(3);

      const next = await syncMailbox(deps(trx, hostile), s.ctx, s.mailboxId);
      expect(next.stored).toBe(0);
      expect(await rows(trx, s.mailboxId)).toHaveLength(3);
    });
  });

  test("5: the backfill stores the header row of an older mail", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      s.fake.deliver("INBOX", seed(1), { internalDate: new Date(NOW.getTime() - 5 * 24 * 3_600_000) });

      const result = await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, {
        since: new Date(NOW.getTime() - 30 * 24 * 3_600_000),
      });
      expect(result.stored).toBe(1);
      const stored = await rows(trx, s.mailboxId);
      expect(stored).toHaveLength(1);
      expect(stored[0]?.backfilled_at).not.toBeNull();
      expect(stored[0]?.header_id).not.toBeNull();
    });
  });

  test("6: a mail without a capture is stored, has no header row and counts as missing", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      s.fake.deliver("INBOX", seed(1));
      const bare: MailProvider = {
        ...s.fake,
        fetchContent: async () => ({ text: "x", capture: null }),
      };

      const result = await syncMailbox(deps(trx, bare), s.ctx, s.mailboxId);
      expect(result.stored).toBe(1);
      expect(result.captureMissing).toBe(1);
      const [row] = await rows(trx, s.mailboxId);
      expect(row?.body_text).toBe("x");
      expect(row?.header_id).toBeNull();
    });
  });
});
