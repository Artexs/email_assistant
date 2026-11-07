import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { createPlanned, listActionsForEmails } from "../../src/modules/actions";
import { countEventsBetween, recordAudit } from "../../src/modules/audit";
import {
  changeMailboxStatus,
  countWaiting,
  insertMailbox,
  listMailboxes,
  setMailboxStatus,
} from "../../src/modules/mail/repo";
import { countTriagedBetween, listTriagedBetween } from "../../src/modules/triage";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail, insertTriaged, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const T = new Date("2026-11-06T10:00:00Z");
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (offset: number) => new Date(T.getTime() + offset);

async function statusRow(trx: Transaction<DB>, mailboxId: string) {
  return trx
    .selectFrom("mailboxes")
    .select(["status", "status_changed_at"])
    .where("id", "=", mailboxId)
    .executeTakeFirstOrThrow();
}

describe("setMailboxStatus and changeMailboxStatus", () => {
  test("status_changed_at moves only when the status changes", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      await setMailboxStatus(trx, ctx, a.mailboxId, "auth_error", T);
      expect((await statusRow(trx, a.mailboxId)).status_changed_at).toEqual(T);
      await setMailboxStatus(trx, ctx, a.mailboxId, "auth_error", at(HOUR));
      expect((await statusRow(trx, a.mailboxId)).status_changed_at).toEqual(T);
      await setMailboxStatus(trx, ctx, a.mailboxId, "active", at(2 * HOUR));
      expect((await statusRow(trx, a.mailboxId)).status_changed_at).toEqual(at(2 * HOUR));
      await setMailboxStatus(trx, ctx, a.mailboxId, "paused");
      const row = await statusRow(trx, a.mailboxId);
      expect(row.status).toBe("paused");
      expect(row.status_changed_at).not.toEqual(at(2 * HOUR));
    });
  });

  test("changeMailboxStatus is conditional and tenant-scoped", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      const pause = { from: "active", to: "paused", at: T } as const;
      expect(await changeMailboxStatus(trx, ctx, a.mailboxId, pause)).toBe(true);
      expect(await changeMailboxStatus(trx, ctx, a.mailboxId, pause)).toBe(false);
      expect(await changeMailboxStatus(trx, ctx, a.mailboxId, { from: "paused", to: "active", at: at(HOUR) })).toBe(
        true
      );
      expect((await statusRow(trx, a.mailboxId)).status_changed_at).toEqual(at(HOUR));

      await setMailboxStatus(trx, ctx, a.mailboxId, "auth_error", T);
      expect(await changeMailboxStatus(trx, ctx, a.mailboxId, pause)).toBe(false);
      expect((await statusRow(trx, a.mailboxId)).status).toBe("auth_error");

      await setMailboxStatus(trx, ctx, a.mailboxId, "active", T);
      expect(await changeMailboxStatus(trx, { orgId: b.orgId }, a.mailboxId, pause)).toBe(false);
      expect((await statusRow(trx, a.mailboxId)).status).toBe("active");
    });
  });
});

describe("listMailboxes and countWaiting", () => {
  test("listMailboxes returns the mailboxes of the org in creation order", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      const second = randomUUID();
      await insertMailbox(trx, ctx, {
        id: second,
        address: `second-${second}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      await trx
        .updateTable("mailboxes")
        .set({ created_at: at(HOUR) })
        .where("id", "=", second)
        .execute();
      await trx.updateTable("mailboxes").set({ created_at: T }).where("id", "=", a.mailboxId).execute();

      const list = await listMailboxes(trx, ctx);
      expect(list.map((box) => box.id)).toEqual([a.mailboxId, second]);
      expect(list[0]?.status).toBe("active");
      expect(list[0]?.last_synced_at).toBeNull();
      expect(list.map((box) => box.id)).not.toContain(b.mailboxId);
    });
  });

  test("countWaiting counts pending and processing mail since the limit", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      const since = at(-DAY);
      await insertTestEmail(trx, ctx, a.mailboxId, { status: "pending", received_at: at(-HOUR) });
      await insertTestEmail(trx, ctx, a.mailboxId, { status: "processing", received_at: since });
      await insertTestEmail(trx, ctx, a.mailboxId, { status: "triaged", received_at: at(-HOUR) });
      await insertTestEmail(trx, ctx, a.mailboxId, { status: "pending", received_at: at(-DAY - MIN) });
      await insertTestEmail(trx, { orgId: b.orgId }, b.mailboxId, { status: "pending", received_at: at(-HOUR) });
      expect(await countWaiting(trx, ctx, { receivedSince: since })).toBe(2);
    });
  });
});

describe("triage reads", () => {
  const range = { after: at(-HOUR), until: T };

  async function seed(trx: Transaction<DB>) {
    const a = await createOrgWithMailbox(trx);
    const b = await createOrgWithMailbox(trx);
    const ctx = { orgId: a.orgId };
    const info = await insertTriaged(trx, ctx, a.mailboxId, {
      category: "info",
      createdAt: at(-10 * MIN),
      receivedAt: at(-30 * MIN),
      subject: "Info old",
      from: "i@x.test",
      messageId: "<i@x.test>",
      reason: "newsletter",
      fields: { model_category: "spam" },
    });
    const infoNew = await insertTriaged(trx, ctx, a.mailboxId, {
      category: "info",
      createdAt: at(-10 * MIN),
      receivedAt: at(-20 * MIN),
    });
    const urgent = await insertTriaged(trx, ctx, a.mailboxId, {
      category: "urgent",
      createdAt: at(-5 * MIN),
      receivedAt: at(-50 * MIN),
      fields: { model_category: "nonsense" },
    });
    const reply = await insertTriaged(trx, ctx, a.mailboxId, { category: "needs_reply", createdAt: T });
    const atAfter = await insertTriaged(trx, ctx, a.mailboxId, { category: "spam", createdAt: range.after });
    const old = await insertTriaged(trx, ctx, a.mailboxId, { category: "urgent", createdAt: at(-2 * DAY) });
    // Two results for one e-mail: only the newer one counts.
    const twice = await insertTriaged(trx, ctx, a.mailboxId, {
      category: "notification",
      createdAt: at(-40 * MIN),
      receivedAt: at(-45 * MIN),
    });
    await trx
      .insertInto("triage_results")
      .values({
        org_id: a.orgId,
        email_id: twice,
        category: "unsure",
        confidence: 0.5,
        reason_code: "question",
        created_at: at(-20 * MIN),
      })
      .execute();
    await insertTriaged(trx, { orgId: b.orgId }, b.mailboxId, { category: "urgent", createdAt: at(-10 * MIN) });
    return { a, ctx, info, infoNew, urgent, reply, atAfter, old, twice };
  }

  test("listTriagedBetween: window, latest result, filter, order, limit, model_category, tenant", async () => {
    await withRollback(db, async (trx) => {
      const s = await seed(trx);
      const rows = await listTriagedBetween(trx, s.ctx, range, { limit: 50 });
      expect(rows.map((row) => row.email_id)).toEqual([s.urgent, s.reply, s.twice, s.infoNew, s.info]);
      expect(rows.map((row) => row.category)).toEqual(["urgent", "needs_reply", "unsure", "info", "info"]);

      const info = rows.find((row) => row.email_id === s.info);
      expect(info).toMatchObject({
        mailbox_id: s.a.mailboxId,
        reason: "newsletter",
        model_category: "spam",
        subject: "Info old",
        from_address: "i@x.test",
        message_id_header: "<i@x.test>",
      });
      expect(info?.triaged_at).toEqual(at(-10 * MIN));
      expect(info?.received_at).toEqual(at(-30 * MIN));
      expect(rows.find((row) => row.email_id === s.urgent)?.model_category).toBeNull();

      const filtered = await listTriagedBetween(trx, s.ctx, range, { limit: 50, categories: ["info", "urgent"] });
      expect(filtered.map((row) => row.email_id)).toEqual([s.urgent, s.infoNew, s.info]);
      expect(await listTriagedBetween(trx, s.ctx, range, { limit: 50, categories: [] })).toEqual([]);

      const limited = await listTriagedBetween(trx, s.ctx, range, { limit: 2 });
      expect(limited.map((row) => row.email_id)).toEqual([s.urgent, s.reply]);
    });
  });

  test("countTriagedBetween counts the latest result per category", async () => {
    await withRollback(db, async (trx) => {
      const s = await seed(trx);
      expect(await countTriagedBetween(trx, s.ctx, range)).toEqual({
        urgent: 1,
        needs_reply: 1,
        unsure: 1,
        info: 2,
      });
    });
  });
});

describe("listActionsForEmails and countEventsBetween", () => {
  test("listActionsForEmails returns views in creation order, per org", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      const e1 = await insertTestEmail(trx, ctx, a.mailboxId);
      const e2 = await insertTestEmail(trx, ctx, a.mailboxId);
      const eb = await insertTestEmail(trx, { orgId: b.orgId }, b.mailboxId);
      await createPlanned(trx, ctx, e1, [
        { type: "mark_read", payload: {}, status: "logged", idempotencyKey: `k-${randomUUID()}` },
        { type: "move", payload: { folder: "ai_info" }, status: "logged", idempotencyKey: `k-${randomUUID()}` },
      ]);
      await createPlanned(trx, ctx, e2, [
        { type: "move", payload: { folder: "x" }, status: "ready", idempotencyKey: `k-${randomUUID()}` },
      ]);
      await createPlanned(trx, { orgId: b.orgId }, eb, [
        { type: "move", payload: { folder: "ai_spam" }, status: "logged", idempotencyKey: `k-${randomUUID()}` },
      ]);
      // Rows of one transaction share now(): set distinct creation times.
      await trx
        .updateTable("actions")
        .set({ created_at: T })
        .where("email_id", "=", e1)
        .where("type", "=", "mark_read")
        .execute();
      await trx
        .updateTable("actions")
        .set({ created_at: at(MIN) })
        .where("email_id", "=", e1)
        .where("type", "=", "move")
        .execute();

      const map = await listActionsForEmails(trx, ctx, [e1, e2, eb]);
      expect(map.get(e1)).toMatchObject([
        { type: "mark_read", status: "logged", folder: null },
        { type: "move", status: "logged", folder: "ai_info" },
      ]);
      expect(map.get(e2)).toMatchObject([{ type: "move", status: "ready", folder: null }]);
      expect(map.has(eb)).toBe(false);
      expect((await listActionsForEmails(trx, ctx, [])).size).toBe(0);
    });
  });

  test("countEventsBetween counts only own rows inside the window", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      const range = { after: at(-HOUR), until: T };
      const event = "email.skipped";
      for (const when of [at(-30 * MIN), T, range.after, at(-2 * HOUR), at(MIN)]) {
        await recordAudit(trx, ctx, { actor: "system", event, at: when });
      }
      await recordAudit(trx, ctx, { actor: "system", event: "email.triaged", at: at(-30 * MIN) });
      await recordAudit(trx, { orgId: b.orgId }, { actor: "system", event, at: at(-30 * MIN) });
      expect(await countEventsBetween(trx, ctx, event, range)).toBe(2);
    });
  });
});
