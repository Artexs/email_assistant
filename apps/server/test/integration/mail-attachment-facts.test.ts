import { afterAll, describe, expect, test } from "bun:test";

import { attachmentFactsToShow } from "../../src/modules/mail";
import { listAttachmentInputs } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";

import { createOrgWithMailbox, insertAttachmentHeaders, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-15T08:00:00Z");
const pdf = { name: "faktura.pdf", type: "application/pdf", size: 122880, inline: false };
const logo = { name: "logo.png", type: "image/png", size: 900, inline: true };

describe("the attachment readers (F109 stage 06)", () => {
  test("the raw reader returns the list and the count of its own organization only", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const ctxA = { orgId: a.orgId };
      const ctxB = { orgId: b.orgId };
      const emailA = await insertTestEmail(trx, ctxA, a.mailboxId);
      const emailB = await insertTestEmail(trx, ctxB, b.mailboxId);
      const noHeaders = await insertTestEmail(trx, ctxA, a.mailboxId);
      const none = await insertTestEmail(trx, ctxA, a.mailboxId);
      await insertAttachmentHeaders(trx, ctxA, emailA, [pdf, logo]);
      await insertAttachmentHeaders(trx, ctxB, emailB, [{ ...pdf, name: "other-org.pdf" }]);
      await insertAttachmentHeaders(trx, ctxA, none, []);

      const ids = [emailA, emailB, noHeaders, none];
      const forA = await listAttachmentInputs(trx, ctxA, ids);
      expect([...forA.keys()]).toEqual([emailA]);
      expect(forA.get(emailA)).toEqual({ attachments: [pdf, logo], count: 2 });
      // The other organization sees only its own mail, even when the id of A is asked.
      const forB = await listAttachmentInputs(trx, ctxB, ids);
      expect([...forB.keys()]).toEqual([emailB]);
      expect(JSON.stringify([...forB.values()])).not.toContain("faktura");
      expect(await listAttachmentInputs(trx, ctxA, [])).toEqual(new Map());
    });
  });

  test("the notice reader is empty while the flag is off, and it is per organization", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const ctxA = { orgId: a.orgId };
      const ctxB = { orgId: b.orgId };
      const emailA = await insertTestEmail(trx, ctxA, a.mailboxId);
      const emailB = await insertTestEmail(trx, ctxB, b.mailboxId);
      await insertAttachmentHeaders(trx, ctxA, emailA, [pdf]);
      await insertAttachmentHeaders(trx, ctxB, emailB, [pdf]);

      expect(await attachmentFactsToShow(trx, ctxA, [emailA])).toEqual(new Map());
      await setOrgFeature(trx, ctxA, { flag: "attachment_line", enabled: true, actor: "cli", now: NOW });
      expect(await attachmentFactsToShow(trx, ctxA, [emailA])).toEqual(
        new Map([[emailA, { attachments: [pdf], count: 1 }]])
      );
      // B has the flag off, and A's mail id is not B's.
      expect(await attachmentFactsToShow(trx, ctxB, [emailB])).toEqual(new Map());
      await setOrgFeature(trx, ctxB, { flag: "attachment_line", enabled: true, actor: "cli", now: NOW });
      expect(await attachmentFactsToShow(trx, ctxB, [emailA])).toEqual(new Map());
    });
  });

  test("inline parts, calendar parts and a missing row give no fact; a retained list keeps the count", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      await setOrgFeature(trx, ctx, { flag: "attachment_line", enabled: true, actor: "cli", now: NOW });
      const inlineOnly = await insertTestEmail(trx, ctx, a.mailboxId);
      const calendar = await insertTestEmail(trx, ctx, a.mailboxId);
      const retained = await insertTestEmail(trx, ctx, a.mailboxId);
      const missing = await insertTestEmail(trx, ctx, a.mailboxId);
      await insertAttachmentHeaders(trx, ctx, inlineOnly, [logo]);
      await insertAttachmentHeaders(trx, ctx, calendar, [{ ...pdf, type: "text/calendar", name: "invite.ics" }]);
      await insertAttachmentHeaders(trx, ctx, retained, [], 2);
      const facts = await attachmentFactsToShow(trx, ctx, [inlineOnly, calendar, retained, missing]);
      expect([...facts.keys()]).toEqual([retained]);
      expect(facts.get(retained)).toEqual({ attachments: [], count: 2 });
    });
  });
});
