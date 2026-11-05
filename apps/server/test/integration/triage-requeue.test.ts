import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";

import { insertMailbox } from "../../src/modules/mail/repo";
import { requeueBackfillWindow } from "../../src/modules/triage";

import { createOrgWithMailbox, insertTestEmail, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const now = new Date("2026-11-05T12:00:00Z");
const day = 24 * 3_600_000;
const since = new Date(now.getTime() - 30 * day);

function tooOld(daysAgo: number, overrides?: Record<string, unknown>) {
  return {
    status: "skipped",
    skip_reason: "too_old",
    received_at: new Date(now.getTime() - daysAgo * day),
    message_id_header: `<r-${daysAgo}@x.test>`,
    ...overrides,
  };
}

describe("requeueBackfillWindow", () => {
  test("re-queues only real too_old INBOX mail of the window, once", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      const inWindow = await insertTestEmail(trx, ctx, a.mailboxId, tooOld(10, { next_attempt_at: now }));
      const old = await insertTestEmail(trx, ctx, a.mailboxId, tooOld(40));
      const synthetic = await insertTestEmail(
        trx,
        ctx,
        a.mailboxId,
        tooOld(11, { message_id_header: "<s@ea-seed.test>" })
      );
      const triaged = await insertTestEmail(
        trx,
        ctx,
        a.mailboxId,
        tooOld(12, { status: "triaged", skip_reason: null })
      );
      const other = await insertTestEmail(trx, { orgId: b.orgId }, b.mailboxId, tooOld(10));
      const sameOrgOther = randomUUID();
      await insertMailbox(trx, ctx, {
        id: sameOrgOther,
        address: `second-${sameOrgOther}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: { drafts: "Drafts" },
      });
      const otherMailbox = await insertTestEmail(trx, ctx, sameOrgOther, tooOld(10));
      const otherFolder = await insertTestEmail(trx, ctx, a.mailboxId, tooOld(13, { folder: "Archive" }));
      const otherReason = await insertTestEmail(trx, ctx, a.mailboxId, tooOld(14, { skip_reason: "spam" }));
      const noHeader = await insertTestEmail(trx, ctx, a.mailboxId, tooOld(15, { message_id_header: null }));

      expect(await requeueBackfillWindow(trx, ctx, a.mailboxId, { since, now })).toBe(2);

      const rows = await trx
        .selectFrom("emails")
        .select(["id", "status", "skip_reason", "next_attempt_at", "backfilled_at"])
        .where("id", "in", [inWindow, old, synthetic, triaged, other, otherMailbox, otherFolder, otherReason, noHeader])
        .execute();
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(inWindow)).toMatchObject({
        status: "pending",
        skip_reason: null,
        next_attempt_at: null,
        backfilled_at: now,
      });
      expect(byId.get(old)).toMatchObject({ status: "skipped", skip_reason: "too_old" });
      expect(byId.get(synthetic)).toMatchObject({ status: "skipped", skip_reason: "too_old" });
      expect(byId.get(triaged)?.status).toBe("triaged");
      expect(byId.get(other)).toMatchObject({ status: "skipped", skip_reason: "too_old" });
      expect(byId.get(otherMailbox)).toMatchObject({ status: "skipped", skip_reason: "too_old" });
      expect(byId.get(otherFolder)).toMatchObject({ status: "skipped", skip_reason: "too_old" });
      expect(byId.get(otherReason)).toMatchObject({ status: "skipped", skip_reason: "spam" });
      expect(byId.get(noHeader)).toMatchObject({ status: "pending", skip_reason: null, backfilled_at: now });

      const audit = await trx.selectFrom("audit_log").selectAll().where("event", "=", "email.requeued").execute();
      expect(audit).toHaveLength(2);
      expect(audit.map((row) => row.email_id).sort()).toEqual([inWindow, noHeader].sort());
      for (const row of audit) {
        expect(row).toMatchObject({ actor: "system", reason_code: "backfill" });
        expect(row.data).toEqual({ mailbox_id: a.mailboxId });
      }

      expect(await requeueBackfillWindow(trx, ctx, a.mailboxId, { since, now })).toBe(0);
      const again = await trx.selectFrom("audit_log").select("id").where("event", "=", "email.requeued").execute();
      expect(again).toHaveLength(2);
    });
  });
});
