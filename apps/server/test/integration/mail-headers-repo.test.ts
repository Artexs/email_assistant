import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  clearCapturedHeaders,
  getEmailHeaders,
  insertEmailHeaders,
  type CapturedHeaders,
} from "../../src/modules/mail";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const CAPTURE: CapturedHeaders = {
  fromName: "Jan Kowalski <ceo@corp.test>",
  replyTo: ["other@else.test"],
  returnPath: "bounce@evil.test",
  authResults: "mx.top.example; dmarc=fail header.from=evil.test; spf=fail",
  listUnsubscribe: "<https://u.test/x>, <mailto:u@u.test>",
  listId: "News <news.list.test>",
  autoSubmitted: "auto-replied",
  precedence: "bulk",
  hasCalendar: true,
  attachments: [
    { name: "invite.ics", type: "text/calendar", size: 12, inline: false },
    { name: "invoice.pdf", type: "application/pdf", size: 9, inline: false },
  ],
  attachmentCount: 2,
  links: [
    { host: "evil.test", textHost: "bank.test" },
    { host: "www.shop.test", textHost: null },
  ],
  linkCount: 2,
  partsKnown: true,
};

interface Org {
  ctx: TenantContext;
  mailboxId: string;
}

async function newOrg(trx: Transaction<DB>): Promise<Org> {
  const { orgId, mailboxId } = await createOrgWithMailbox(trx);
  return { ctx: { orgId }, mailboxId };
}

async function mailOf(trx: Transaction<DB>, org: Org, dedupKey: string): Promise<string> {
  return insertTestEmail(trx, org.ctx, org.mailboxId, { dedup_key: dedupKey });
}

const at = new Date("2026-11-10T08:00:00Z");

describe("email headers repository", () => {
  test("1: inserts the row of the stored mail with every field as given", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const emailId = await mailOf(trx, org, "k1");
      expect(await insertEmailHeaders(trx, org.ctx, { mailboxId: org.mailboxId, dedupKey: "k1" }, CAPTURE, at)).toBe(
        true
      );
      expect(await getEmailHeaders(trx, org.ctx, emailId)).toEqual({
        ...CAPTURE,
        emailId,
        capturedAt: at,
        textsClearedAt: null,
      });
      // A mail that is not there gives no row.
      expect(await insertEmailHeaders(trx, org.ctx, { mailboxId: org.mailboxId, dedupKey: "none" }, CAPTURE, at)).toBe(
        false
      );
    });
  });

  test("2: a second insert for the same mail returns false and keeps the row", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const emailId = await mailOf(trx, org, "k1");
      const mail = { mailboxId: org.mailboxId, dedupKey: "k1" };
      expect(await insertEmailHeaders(trx, org.ctx, mail, CAPTURE, at)).toBe(true);
      const other: CapturedHeaders = { ...CAPTURE, fromName: "Other", replyTo: [], attachments: [], links: [] };
      expect(await insertEmailHeaders(trx, org.ctx, mail, other, new Date("2026-11-11T08:00:00Z"))).toBe(false);
      expect(await getEmailHeaders(trx, org.ctx, emailId)).toEqual({
        ...CAPTURE,
        emailId,
        capturedAt: at,
        textsClearedAt: null,
      });
    });
  });

  test("3: another organization neither inserts nor reads the row", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const emailId = await mailOf(trx, a, "k1");
      expect(await insertEmailHeaders(trx, b.ctx, { mailboxId: a.mailboxId, dedupKey: "k1" }, CAPTURE, at)).toBe(false);
      expect(await trx.selectFrom("email_headers").select("email_id").execute()).toEqual([]);
      expect(await insertEmailHeaders(trx, a.ctx, { mailboxId: a.mailboxId, dedupKey: "k1" }, CAPTURE, at)).toBe(true);
      expect(await getEmailHeaders(trx, b.ctx, emailId)).toBeUndefined();
    });
  });

  test("4: retention clears the texts of old rows only, once, in one organization", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const cutoff = new Date("2026-10-15T00:00:00Z");
      const oldAt = new Date("2026-10-14T00:00:00Z");
      const newAt = new Date("2026-10-16T00:00:00Z");
      const oldA = await mailOf(trx, a, "old");
      const newA = await mailOf(trx, a, "new");
      const oldB = await mailOf(trx, b, "old");
      const mailA = (dedupKey: string) => ({ mailboxId: a.mailboxId, dedupKey });
      await insertEmailHeaders(trx, a.ctx, mailA("old"), CAPTURE, oldAt);
      await insertEmailHeaders(trx, a.ctx, mailA("new"), CAPTURE, newAt);
      await insertEmailHeaders(trx, b.ctx, { mailboxId: b.mailboxId, dedupKey: "old" }, CAPTURE, oldAt);

      expect(await clearCapturedHeaders(trx, a.ctx, { before: cutoff })).toBe(1);

      const cleared = await getEmailHeaders(trx, a.ctx, oldA);
      expect(cleared).toMatchObject({
        fromName: null,
        replyTo: [],
        returnPath: null,
        authResults: null,
        listUnsubscribe: null,
        listId: null,
        attachments: [],
        links: [],
        attachmentCount: 2,
        linkCount: 2,
        hasCalendar: true,
        partsKnown: true,
        autoSubmitted: "auto-replied",
        precedence: "bulk",
      });
      expect(cleared?.textsClearedAt).toBeInstanceOf(Date);
      expect(await getEmailHeaders(trx, a.ctx, newA)).toEqual({
        ...CAPTURE,
        emailId: newA,
        capturedAt: newAt,
        textsClearedAt: null,
      });
      expect((await getEmailHeaders(trx, b.ctx, oldB))?.textsClearedAt).toBeNull();
      expect(await clearCapturedHeaders(trx, a.ctx, { before: cutoff })).toBe(0);
    });
  });
});
