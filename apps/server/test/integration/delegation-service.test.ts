import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { getDraft, getSend } from "../../src/modules/actions";
import {
  addDelegate,
  cancelDelegation,
  closeDelegation,
  createDelegation,
  delegationHooks,
  detectReply,
  getDelegation,
  listDelegates,
  markAnswered,
  setDelegateState,
} from "../../src/modules/delegation";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertAction, insertDelegate, insertDelegation, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const now = new Date("2026-11-07T12:00:00Z");

async function setup(trx: Transaction<DB>) {
  const org = await createOrgWithMailbox(trx, { address: "Box@X.test" });
  return { ...org, ctx: { orgId: org.orgId } };
}

async function auditRows(trx: Transaction<DB>, ctx: TenantContext, event: string) {
  return trx.selectFrom("audit_log").selectAll().where("org_id", "=", ctx.orgId).where("event", "=", event).execute();
}

// A delegation with its draft and send rows.
async function delegationWithPair(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  status: string,
  delegateId?: string
) {
  const emailId = await insertTestEmail(trx, ctx, mailboxId, { subject: "Offer" });
  const draftId = await insertAction(trx, ctx, emailId, { type: "create_draft", status: "applied" });
  const sendId = await insertAction(trx, ctx, emailId, {
    type: "send",
    status: status === "drafted" ? "awaiting_approval" : "applied",
    approvedAt: status === "drafted" ? null : now,
    appliedAt: status === "drafted" ? null : now,
    dependsOnActionId: draftId,
  });
  const delegate = delegateId ?? (await insertDelegate(trx, ctx));
  const id = await insertDelegation(trx, ctx, {
    mailboxId,
    emailId,
    delegateId: delegate,
    draftActionId: draftId,
    sendActionId: sendId,
    status,
  });
  return { id, emailId, delegateId: delegate };
}

// A pending reminder pair of the delegation: the send `awaiting_approval`, the draft `applied` in Drafts.
async function reminderPair(trx: Transaction<DB>, ctx: TenantContext, emailId: string, delegationId: string) {
  const draftId = await insertAction(trx, ctx, emailId, {
    type: "create_draft",
    status: "applied",
    payload: { kind: "reminder" },
    providerResult: { uid: 9, folder: "Drafts" },
  });
  const sendId = await insertAction(trx, ctx, emailId, {
    type: "send",
    status: "awaiting_approval",
    dependsOnActionId: draftId,
    payload: { kind: "reminder", to: ["d@x.test"], delegation_id: delegationId, reminder: 1 },
  });
  return { draftId, sendId };
}

describe("addDelegate / setDelegateState", () => {
  const base = { name: "Anna", email: "anna@x.test", tags: [], actor: "cli", now };

  test("validation and the mailbox address", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      expect(await addDelegate(trx, s.ctx, { ...base, email: " BOX@x.TEST " })).toEqual({ kind: "mailbox_address" });
      expect(await addDelegate(trx, s.ctx, { ...base, email: "not an address" })).toEqual({
        kind: "invalid",
        field: "email",
      });
      expect(await addDelegate(trx, s.ctx, { ...base, name: "  " })).toEqual({ kind: "invalid", field: "name" });
      expect(await addDelegate(trx, s.ctx, { ...base, name: "x".repeat(101) })).toEqual({
        kind: "invalid",
        field: "name",
      });
      const tags = Array.from({ length: 11 }, (_, i) => `t${i}`);
      expect(await addDelegate(trx, s.ctx, { ...base, tags })).toEqual({ kind: "invalid", field: "tags" });
      expect(await addDelegate(trx, s.ctx, { ...base, tags: ["x".repeat(31)] })).toEqual({
        kind: "invalid",
        field: "tags",
      });
      expect(await addDelegate(trx, s.ctx, { ...base, tags: [" "] })).toEqual({ kind: "invalid", field: "tags" });
      expect(await listDelegates(trx, s.ctx)).toEqual([]);
      expect(await auditRows(trx, s.ctx, "delegate.added")).toEqual([]);
    });
  });

  test("success: normalized, audit row; the same email again: exists", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const result = await addDelegate(trx, s.ctx, {
        ...base,
        name: " Anna ",
        email: " ANNA@x.test ",
        tags: [" Sales ", "sales", "PL"],
      });
      expect(result.kind).toBe("added");
      const [row] = await listDelegates(trx, s.ctx);
      expect(row).toMatchObject({ name: "Anna", email: "anna@x.test", competence_tags: ["sales", "pl"], active: true });
      const audit = await auditRows(trx, s.ctx, "delegate.added");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor: "cli", data: { delegate_id: row?.id } });
      expect(await addDelegate(trx, s.ctx, base)).toEqual({ kind: "exists" });
      expect(await auditRows(trx, s.ctx, "delegate.added")).toHaveLength(1);
    });
  });

  test("setDelegateState", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const id = await insertDelegate(trx, s.ctx);
      const input = { id, active: false, actor: "cli", now };
      expect(await setDelegateState(trx, s.ctx, input)).toBe("changed");
      expect(await setDelegateState(trx, s.ctx, input)).toBe("same");
      expect(await setDelegateState(trx, s.ctx, { ...input, id: randomUUID() })).toBe("not_found");
      const audit = await auditRows(trx, s.ctx, "delegate.changed");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor: "cli", data: { delegate_id: id, active: false } });
    });
  });
});

describe("createDelegation", () => {
  async function create(trx: Transaction<DB>, dueDate: string | null) {
    const s = await setup(trx);
    const emailId = await insertTestEmail(trx, s.ctx, s.mailboxId);
    const draftId = await insertAction(trx, s.ctx, emailId, { type: "create_draft", status: "ready" });
    const sendId = await insertAction(trx, s.ctx, emailId, {
      type: "send",
      status: "awaiting_approval",
      dependsOnActionId: draftId,
    });
    const delegateId = await insertDelegate(trx, s.ctx);
    const id = await createDelegation(trx, s.ctx, {
      mailboxId: s.mailboxId,
      emailId,
      delegateId,
      draftActionId: draftId,
      sendActionId: sendId,
      task: "Prepare the offer",
      dueDate,
      timezone: "Europe/Warsaw",
      now,
    });
    return { s, id, emailId, sendId, delegateId };
  }

  test("a valid date: 17:00 organization time", async () => {
    await withRollback(db, async (trx) => {
      const c = await create(trx, "2026-11-10");
      const row = await getDelegation(trx, c.s.ctx, c.id);
      expect(row?.due_at).toEqual(new Date("2026-11-10T16:00:00Z"));
      expect(row).toMatchObject({ status: "drafted", task_summary: "Prepare the offer" });
      const audit = await auditRows(trx, c.s.ctx, "delegation.created");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        email_id: c.emailId,
        action_id: c.sendId,
        data: { delegation_id: c.id, delegate_id: c.delegateId, send_action_id: c.sendId, due: true },
      });
    });
  });

  test("an impossible date, no date and a bad shape: null", async () => {
    await withRollback(db, async (trx) => {
      for (const dueDate of ["2026-02-30", null, "", "tomorrow"]) {
        const c = await create(trx, dueDate);
        expect((await getDelegation(trx, c.s.ctx, c.id))?.due_at).toBeNull();
        expect((await auditRows(trx, c.s.ctx, "delegation.created"))[0]?.data).toMatchObject({ due: false });
      }
    });
  });
});

describe("detectReply", () => {
  test("the delegate's address in another case is found; another address or no ids is not", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const delegateId = await insertDelegate(trx, s.ctx, { email: "anna@x.test" });
      const d = await delegationWithPair(trx, s.ctx, s.mailboxId, "sent", delegateId);
      await trx.updateTable("delegations").set({ sent_message_id: "<sent1@x.test>" }).where("id", "=", d.id).execute();
      const mail = {
        fromAddress: "ANNA@X.test",
        inReplyTo: "<other@x.test>",
        referencesHeader: "<a@x.test>\r\n <sent1@x.test>",
      };

      expect(await detectReply(trx, s.ctx, s.mailboxId, mail)).toEqual({ delegationId: d.id, delegateId });
      expect(
        await detectReply(trx, s.ctx, s.mailboxId, { ...mail, inReplyTo: " <sent1@x.test> ", referencesHeader: null })
      ).toEqual({
        delegationId: d.id,
        delegateId,
      });
      expect(await detectReply(trx, s.ctx, s.mailboxId, { ...mail, fromAddress: "other@x.test" })).toBeNull();
      expect(await detectReply(trx, s.ctx, s.mailboxId, { ...mail, fromAddress: null })).toBeNull();
      expect(
        await detectReply(trx, s.ctx, s.mailboxId, { ...mail, inReplyTo: null, referencesHeader: "  " })
      ).toBeNull();
    });
  });
});

describe("closing a delegation closes its reminders", () => {
  test("markAnswered: answered, the reminder send expired, its applied draft gets a reverse row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx); // capabilities.uidplus is true
      const d = await delegationWithPair(trx, s.ctx, s.mailboxId, "sent");
      const r = await reminderPair(trx, s.ctx, d.emailId, d.id);
      const answerId = await insertTestEmail(trx, s.ctx, s.mailboxId);

      expect(await markAnswered(trx, s.ctx, d.id, { emailId: answerId, at: now })).toBe(true);

      expect(await getDelegation(trx, s.ctx, d.id)).toMatchObject({ status: "answered", answered_email_id: answerId });
      expect(await getSend(trx, s.ctx, r.sendId)).toMatchObject({
        status: "expired",
        status_reason: "delegation_closed",
      });
      const reverse = await trx
        .selectFrom("actions")
        .select(["payload", "status"])
        .where("reverses_action_id", "=", r.draftId)
        .execute();
      expect(reverse).toEqual([
        { status: "ready", payload: { kind: "reminder", folder: "Drafts", uid: 9, reason: "expired" } },
      ]);
      const audit = await auditRows(trx, s.ctx, "delegation.answered");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        email_id: answerId,
        data: { delegation_id: d.id, delegate_id: d.delegateId, reminders_expired: 1 },
      });
      // a second call changes nothing
      expect(await markAnswered(trx, s.ctx, d.id, { emailId: answerId, at: now })).toBe(false);
      expect(await auditRows(trx, s.ctx, "delegation.answered")).toHaveLength(1);
    });
  });

  test("closeDelegation: done, then already; unknown id: not_found; drafted, sent, cancelled: not_closable", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const d = await delegationWithPair(trx, s.ctx, s.mailboxId, "overdue");
      const r = await reminderPair(trx, s.ctx, d.emailId, d.id);

      expect(await closeDelegation(trx, s.ctx, d.id, { actor: "cli", at: now })).toEqual({ kind: "done" });
      expect((await getDelegation(trx, s.ctx, d.id))?.status).toBe("done");
      expect((await getSend(trx, s.ctx, r.sendId))?.status).toBe("expired");
      expect((await auditRows(trx, s.ctx, "delegation.done"))[0]).toMatchObject({ actor: "cli" });
      expect((await auditRows(trx, s.ctx, "action.expired"))[0]).toMatchObject({ actor: "cli" });
      expect(await closeDelegation(trx, s.ctx, d.id, { actor: "cli", at: now })).toEqual({ kind: "already" });
      expect(await closeDelegation(trx, s.ctx, randomUUID(), { actor: "cli", at: now })).toEqual({ kind: "not_found" });
      for (const status of ["drafted", "sent", "cancelled"] as const) {
        const open = await delegationWithPair(trx, s.ctx, s.mailboxId, status);
        expect(await closeDelegation(trx, s.ctx, open.id, { actor: "cli", at: now })).toEqual({
          kind: "not_closable",
          status,
        });
        expect((await getDelegation(trx, s.ctx, open.id))?.status).toBe(status);
      }
    });
  });

  test("cancelDelegation: cancelled with the reason; only from drafted", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const d = await delegationWithPair(trx, s.ctx, s.mailboxId, "drafted");
      const r = await reminderPair(trx, s.ctx, d.emailId, d.id);

      expect(await cancelDelegation(trx, s.ctx, d.id, { reason: "rejected", at: now })).toBe(true);
      expect(await getDelegation(trx, s.ctx, d.id)).toMatchObject({ status: "cancelled", status_reason: "rejected" });
      expect((await getSend(trx, s.ctx, r.sendId))?.status).toBe("expired");
      expect((await getDraft(trx, s.ctx, r.draftId))?.status).toBe("applied");
      expect((await auditRows(trx, s.ctx, "delegation.cancelled"))[0]).toMatchObject({ reason_code: "rejected" });
      expect(await cancelDelegation(trx, s.ctx, d.id, { reason: "rejected", at: now })).toBe(false);

      const sent = await delegationWithPair(trx, s.ctx, s.mailboxId, "sent");
      expect(await cancelDelegation(trx, s.ctx, sent.id, { reason: "expired", at: now })).toBe(false);
    });
  });
});

describe("delegationHooks", () => {
  test("onSent, onReminderSent, onCancelled", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const hooks = delegationHooks({ db });
      const d = await delegationWithPair(trx, s.ctx, s.mailboxId, "drafted");
      const dueAtWhenNull = new Date("2026-11-10T12:00:00Z");

      expect(
        await hooks.onSent(trx, s.ctx, { delegationId: d.id, sentMessageId: "<s@x.test>", sentAt: now, dueAtWhenNull })
      ).toBe(true);
      expect(await getDelegation(trx, s.ctx, d.id)).toMatchObject({ status: "sent", sent_message_id: "<s@x.test>" });
      expect((await auditRows(trx, s.ctx, "delegation.sent"))[0]).toMatchObject({ data: { delegation_id: d.id } });
      expect(
        await hooks.onSent(trx, s.ctx, { delegationId: d.id, sentMessageId: "<s@x.test>", sentAt: now, dueAtWhenNull })
      ).toBe(false);
      expect(await hooks.onReminderSent(trx, s.ctx, { delegationId: d.id, at: now })).toBe(true);
      expect((await getDelegation(trx, s.ctx, d.id))?.reminders_sent).toBe(1);
      expect(await hooks.onCancelled(trx, s.ctx, { delegationId: d.id, reason: "expired", at: now })).toBe(false);

      const drafted = await delegationWithPair(trx, s.ctx, s.mailboxId, "drafted");
      expect(await hooks.onCancelled(trx, s.ctx, { delegationId: drafted.id, reason: "expired", at: now })).toBe(true);
      expect(await getDelegation(trx, s.ctx, drafted.id)).toMatchObject({
        status: "cancelled",
        status_reason: "expired",
      });
    });
  });

  test("isOpen: a reminder needs sent | overdue; a delegation send needs drafted or cancelled by a failed send", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const hooks = delegationHooks({ db });
      const open = async (status: string, reason: string | null, kind: "reminder" | "delegation") => {
        const d = await delegationWithPair(trx, s.ctx, s.mailboxId, status);
        await trx.updateTable("delegations").set({ status_reason: reason }).where("id", "=", d.id).execute();
        return hooks.isOpen(trx, s.ctx, d.id, kind);
      };

      expect(await open("sent", null, "reminder")).toBe(true);
      expect(await open("overdue", null, "reminder")).toBe(true);
      expect(await open("answered", null, "reminder")).toBe(false);
      expect(await open("done", null, "reminder")).toBe(false);
      expect(await open("cancelled", "outcome_unknown", "reminder")).toBe(false);
      expect(await open("drafted", null, "delegation")).toBe(true);
      expect(await open("cancelled", "outcome_unknown", "delegation")).toBe(true);
      expect(await open("cancelled", "send_failed", "delegation")).toBe(true);
      expect(await open("cancelled", "rejected", "delegation")).toBe(false);
      expect(await open("cancelled", "expired", "delegation")).toBe(false);
      expect(await open("sent", null, "delegation")).toBe(false);
      expect(await hooks.isOpen(trx, s.ctx, randomUUID(), "reminder")).toBe(false);
    });
  });
});
