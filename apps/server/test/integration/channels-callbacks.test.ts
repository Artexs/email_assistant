import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { noDelegationHooks, type DelegationHooks, type SendScope } from "../../src/modules/actions";
import { auditEvents } from "../../src/modules/audit";
import { handleCallback, insertOutbox, type CallbackDeps } from "../../src/modules/channels";
import type { LinkedChat } from "../../src/modules/channels";
import { APPROVAL_TEXTS, UNDO_TEXTS } from "../../src/modules/channels/callbacks";
import { listLabeledResults } from "../../src/modules/triage";
import type { DB } from "../../src/platform/db";

import {
  addMember,
  createOrgWithMailbox,
  insertAction,
  insertDelegate,
  insertDelegation,
  insertDraftAndSend,
  insertTriaged,
  insertTriagedWithActions,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const T = new Date("2026-11-06T10:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOT_FOUND = "This mail is not in your account.";

async function feedbackRows(trx: Transaction<DB>, emailId: string) {
  return trx.selectFrom("triage_feedback").selectAll().where("email_id", "=", emailId).execute();
}

// Rows of one transaction share `now()`: move the rows written so far into the past, so the next row is the newest.
async function ageFeedback(trx: Transaction<DB>): Promise<void> {
  await trx
    .updateTable("triage_feedback")
    .set({ created_at: sql`created_at - interval '1 minute'` })
    .execute();
}

async function setup(trx: Transaction<DB>) {
  const address = `box-${randomUUID()}@x.test`;
  const a = await createOrgWithMailbox(trx, { address });
  const b = await createOrgWithMailbox(trx);
  const ctxA = { orgId: a.orgId };
  const info = await insertTriaged(trx, ctxA, a.mailboxId, {
    category: "info",
    createdAt: T,
    subject: "MARKER-SUBJECT",
  });
  const unsure = await insertTriaged(trx, ctxA, a.mailboxId, { category: "unsure", createdAt: T });
  const other = await insertTriaged(trx, { orgId: b.orgId }, b.mailboxId, { category: "info", createdAt: T });
  const link: LinkedChat = { orgId: a.orgId, userId: a.userId, role: "owner", chatId: 1, linkedAt: T };
  const deps: CallbackDeps = {
    db: trx,
    now: () => T,
    actionsScope: { kind: "all" },
    hooks: noDelegationHooks,
    uidplus: async () => true,
    sendScope: { kind: "all" },
  };
  return { a, ctxA, info, unsure, other, link, deps };
}

describe("handleCallback", () => {
  test("a right tap writes one row; the same tap again writes nothing", async () => {
    await withRollback(db, async (trx) => {
      const { a, info, link, deps } = await setup(trx);

      const first = await handleCallback(deps, link, `fr:i:${info}`);
      expect(first.answer).toBe("✅ Saved: Info is right.");
      expect(await feedbackRows(trx, info)).toMatchObject([
        { verdict: "right", true_category: "info", source: "telegram", user_id: a.userId },
      ]);

      const second = await handleCallback(deps, link, `fr:i:${info}`);
      expect(second.answer).toBe("Already saved.");
      expect(await feedbackRows(trx, info)).toHaveLength(1);
    });
  });

  test("the edit button sends the picker", async () => {
    await withRollback(db, async (trx) => {
      const { info, link, deps } = await setup(trx);

      const result = await handleCallback(deps, link, `fe:${info}`);

      expect(result.answer).toBe("");
      expect(result.edit).toBeUndefined();
      const picker = result.send;
      expect(picker?.text).toContain("MARKER-SUBJECT");
      expect(picker?.text).toContain("AI said: ℹ️ Info");
      expect(picker?.buttons).toHaveLength(3);
      const data = picker?.buttons.flat().map((button) => button.data);
      expect(data).toEqual([
        `fc:u:${info}`,
        `fc:r:${info}`,
        `fc:i:${info}`,
        `fc:n:${info}`,
        `fc:s:${info}`,
        `fx:${info}`,
      ]);
      expect(picker?.buttons.flat()).toHaveLength(6);
      for (const item of data ?? []) {
        expect(Buffer.byteLength(item)).toBeLessThanOrEqual(64);
      }
    });
  });

  test("a pick writes a row; the same pick is skipped; a changed answer wins", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA, info, link, deps } = await setup(trx);

      const spam = await handleCallback(deps, link, `fc:s:${info}`);
      expect(spam).toEqual({
        answer: "Saved.",
        edit: { text: "✏️ Saved: Spam (AI said Info).", buttons: [] },
      });
      expect(await feedbackRows(trx, info)).toMatchObject([{ verdict: "wrong", true_category: "spam" }]);

      const again = await handleCallback(deps, link, `fc:s:${info}`);
      expect(again.answer).toBe("Already saved.");
      expect(await feedbackRows(trx, info)).toHaveLength(1);

      await ageFeedback(trx);
      const right = await handleCallback(deps, link, `fc:i:${info}`);
      expect(right.answer).toBe("Saved.");
      expect(await feedbackRows(trx, info)).toHaveLength(2);

      const labeled = await listLabeledResults(trx, ctxA, a.mailboxId, { mail: "real" });
      expect(labeled.filter((row) => row.email_id === info)).toMatchObject([
        { verdict: "right", true_category: "info" },
      ]);
    });
  });

  test("a pick on an unsure mail writes wrong with the picked category", async () => {
    await withRollback(db, async (trx) => {
      const { unsure, link, deps } = await setup(trx);

      await handleCallback(deps, link, `fc:n:${unsure}`);

      expect(await feedbackRows(trx, unsure)).toMatchObject([{ verdict: "wrong", true_category: "notification" }]);
    });
  });

  test("another organization's mail and an unknown id give the same answer and no row", async () => {
    await withRollback(db, async (trx) => {
      const { a, other, link, deps } = await setup(trx);

      for (const id of [other, randomUUID()]) {
        for (const data of [`fr:i:${id}`, `fe:${id}`, `fc:s:${id}`]) {
          expect((await handleCallback(deps, link, data)).answer).toBe("This mail is not in your account.");
        }
      }
      expect(await feedbackRows(trx, other)).toEqual([]);
      const rows = await trx.selectFrom("triage_feedback").select("id").where("org_id", "=", a.orgId).execute();
      expect(rows).toEqual([]);
    });
  });

  test("junk data is not valid", async () => {
    await withRollback(db, async (trx) => {
      const { link, deps } = await setup(trx);

      expect(await handleCallback(deps, link, "junk")).toEqual({ answer: "This button is not valid any more." });
    });
  });

  test("cancel edits the picker and needs no database", async () => {
    await withRollback(db, async (trx) => {
      const { info, link, deps } = await setup(trx);

      const result = await handleCallback(deps, link, `fx:${info}`);

      expect(result).toEqual({ answer: "", edit: { text: "✏️ Cancelled.", buttons: [] } });
      expect(await feedbackRows(trx, info)).toEqual([]);
    });
  });

  describe("undo", () => {
    const applied = (type: "move" | "mark_read", payload?: Record<string, string>) => ({
      type,
      status: "applied",
      payload,
      appliedAt: new Date(T.getTime() - HOUR),
    });

    async function reverseRows(trx: Transaction<DB>, orgId: string) {
      return trx
        .selectFrom("actions")
        .select(["type", "email_id"])
        .where("org_id", "=", orgId)
        .where("reverses_action_id", "is not", null)
        .execute();
    }

    async function undoMail(trx: Transaction<DB>, s: Awaited<ReturnType<typeof setup>>, category: "info" | "unsure") {
      return insertTriagedWithActions(trx, s.ctxA, s.a.mailboxId, {
        category,
        createdAt: T,
        actions: [applied("move", { folder: category === "info" ? "ai_info" : "ai_manual" }), applied("mark_read")],
      });
    }

    test("(1)(2) a tap starts the Undo and writes one feedback row; the second tap says already", async () => {
      await withRollback(db, async (trx) => {
        const s = await setup(trx);
        const mail = await undoMail(trx, s, "info");

        const first = await handleCallback(s.deps, s.link, `fu:${mail.emailId}`);
        expect(first).toEqual({ answer: UNDO_TEXTS.started });
        expect(await reverseRows(trx, s.a.orgId)).toHaveLength(2);
        expect(await feedbackRows(trx, mail.emailId)).toMatchObject([
          { verdict: "wrong", true_category: null, source: "undo", user_id: s.a.userId },
        ]);

        const second = await handleCallback(s.deps, s.link, `fu:${mail.emailId}`);
        expect(second.answer).toBe(UNDO_TEXTS.already);
        expect(await reverseRows(trx, s.a.orgId)).toHaveLength(2);
        expect(await feedbackRows(trx, mail.emailId)).toHaveLength(1);
      });
    });

    test("(3) an unsure mail starts the Undo and writes no feedback row", async () => {
      await withRollback(db, async (trx) => {
        const s = await setup(trx);
        const mail = await undoMail(trx, s, "unsure");

        const result = await handleCallback(s.deps, s.link, `fu:${mail.emailId}`);

        expect(result.answer).toBe(UNDO_TEXTS.started);
        expect(await reverseRows(trx, s.a.orgId)).toHaveLength(2);
        expect(await feedbackRows(trx, mail.emailId)).toEqual([]);
      });
    });

    test("(4) a mail with logged rows only: nothing to undo", async () => {
      await withRollback(db, async (trx) => {
        const s = await setup(trx);
        await insertAction(trx, s.ctxA, s.info, { type: "move", status: "logged" });

        const result = await handleCallback(s.deps, s.link, `fu:${s.info}`);

        expect(result.answer).toBe(UNDO_TEXTS.nothing);
        expect(await reverseRows(trx, s.a.orgId)).toEqual([]);
        expect(await feedbackRows(trx, s.info)).toEqual([]);
      });
    });

    test("(5) applied 8 days ago: too old", async () => {
      await withRollback(db, async (trx) => {
        const s = await setup(trx);
        await insertAction(trx, s.ctxA, s.info, {
          type: "mark_read",
          status: "applied",
          appliedAt: new Date(T.getTime() - 8 * DAY),
        });

        const result = await handleCallback(s.deps, s.link, `fu:${s.info}`);

        expect(result.answer).toBe(UNDO_TEXTS.too_old);
        expect(await reverseRows(trx, s.a.orgId)).toEqual([]);
        expect(await feedbackRows(trx, s.info)).toEqual([]);
      });
    });

    test("(5b) scope off: held, no reverse row, no feedback row", async () => {
      await withRollback(db, async (trx) => {
        const s = await setup(trx);
        const mail = await undoMail(trx, s, "info");

        const result = await handleCallback({ ...s.deps, actionsScope: { kind: "off" } }, s.link, `fu:${mail.emailId}`);

        expect(result.answer).toBe(UNDO_TEXTS.held);
        expect(await reverseRows(trx, s.a.orgId)).toEqual([]);
        expect(await feedbackRows(trx, mail.emailId)).toEqual([]);
      });
    });

    test("(5c) a ✏️ label with a true category stays the latest feedback row", async () => {
      await withRollback(db, async (trx) => {
        const s = await setup(trx);
        const mail = await undoMail(trx, s, "info");
        await handleCallback(s.deps, s.link, `fc:s:${mail.emailId}`);
        await ageFeedback(trx);

        const result = await handleCallback(s.deps, s.link, `fu:${mail.emailId}`);

        expect(result.answer).toBe(UNDO_TEXTS.started);
        expect(await reverseRows(trx, s.a.orgId)).toHaveLength(2);
        expect(await feedbackRows(trx, mail.emailId)).toMatchObject([{ verdict: "wrong", true_category: "spam" }]);
      });
    });

    test("(6) another organization's mail and an unknown id: not found, no rows", async () => {
      await withRollback(db, async (trx) => {
        const s = await setup(trx);
        await insertAction(
          trx,
          {
            orgId: (await trx.selectFrom("emails").select("org_id").where("id", "=", s.other).executeTakeFirstOrThrow())
              .org_id,
          },
          s.other,
          {
            type: "mark_read",
            status: "applied",
            appliedAt: new Date(T.getTime() - HOUR),
          }
        );

        for (const id of [s.other, randomUUID()]) {
          expect((await handleCallback(s.deps, s.link, `fu:${id}`)).answer).toBe(NOT_FOUND);
        }
        expect(await feedbackRows(trx, s.other)).toEqual([]);
        const otherOrgId = (
          await trx.selectFrom("emails").select("org_id").where("id", "=", s.other).executeTakeFirstOrThrow()
        ).org_id;
        expect(await reverseRows(trx, s.a.orgId)).toEqual([]);
        expect(await reverseRows(trx, otherOrgId)).toEqual([]);
      });
    });
  });
});

describe("approval taps", () => {
  const ORIGINAL = "📤 Send? Delegation to Delegate\n\nDraft:\nHello";

  async function approvalSetup(trx: Transaction<DB>, opts?: { sendScope?: (address: string) => SendScope }) {
    const address = `box-${randomUUID()}@x.test`;
    const a = await createOrgWithMailbox(trx, { address });
    const b = await createOrgWithMailbox(trx);
    const ctx = { orgId: a.orgId };
    const o1 = a.userId;
    const o2 = await addMember(trx, a.orgId, "owner");
    const assistant = await addMember(trx, a.orgId, "assistant");
    const link = (userId: string, role: LinkedChat["role"]): LinkedChat => ({
      orgId: a.orgId,
      userId,
      role,
      chatId: 1,
      linkedAt: T,
    });
    const cancelled: string[] = [];
    const hooks: DelegationHooks = {
      ...noDelegationHooks,
      onCancelled: async (_trx, _ctx, input) => {
        cancelled.push(input.reason);
        return true;
      },
    };
    const deps: CallbackDeps = {
      db: trx,
      now: () => T,
      actionsScope: { kind: "off" },
      hooks,
      uidplus: async () => true,
      sendScope: opts?.sendScope?.(address) ?? { kind: "all" },
    };
    return {
      a,
      b,
      ctx,
      o1,
      o2,
      assistant,
      address,
      cancelled,
      deps,
      owner1: link(o1, "owner"),
      owner2: link(o2, "owner"),
      assistantLink: link(assistant, "assistant"),
    };
  }

  async function queueFor(
    trx: Transaction<DB>,
    ctx: { orgId: string },
    userId: string,
    kind: "approval" | "approval_set" | "send_result" | "delegation_answered",
    key: string,
    emailId: string,
    text = ORIGINAL
  ): Promise<void> {
    await insertOutbox(trx, ctx, {
      userId,
      kind,
      dedupKey: `${kind}:${key}`,
      emailId,
      message: { text, buttons: [] },
      createdAt: T,
      nextAttemptAt: T,
    });
  }

  async function sendRow(trx: Transaction<DB>, id: string) {
    return trx.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  }

  test("(1)(2) an owner approves; the second owner sees already approved", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const { sendId, emailId } = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, { notifiedAt: T, createdAt: T });
      await queueFor(trx, s.ctx, s.o1, "approval", sendId, emailId);

      const first = await handleCallback(s.deps, s.owner1, `ap:${sendId}`);
      expect(first.answer).toBe(APPROVAL_TEXTS.approved);
      expect(first.edit).toEqual({ text: `${ORIGINAL}\n\n⏳ Approved 11:00, sending.`, buttons: [] });
      expect(await sendRow(trx, sendId)).toMatchObject({
        status: "approved",
        approved_by: s.o1,
        approved_via: "telegram",
      });

      const second = await handleCallback(s.deps, s.owner2, `ap:${sendId}`);
      expect(second.answer).toBe("Already approved 11:00.");
      expect(second.edit).toBeUndefined();
    });
  });

  test("(3) an assistant cannot approve, reject or resend; the row is unchanged", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const { sendId } = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, { notifiedAt: T, createdAt: T });
      for (const kind of ["ap", "ar", "as", "rs", "ag"]) {
        const result = await handleCallback(s.deps, s.assistantLink, `${kind}:${sendId}`);
        expect(result).toEqual({ answer: APPROVAL_TEXTS.owner_only });
      }
      expect(await sendRow(trx, sendId)).toMatchObject({ status: "awaiting_approval", approved_by: null });
    });
  });

  test("(4) another organization's send and an unknown id give the not-found text", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const other = await insertDraftAndSend(trx, { orgId: s.b.orgId }, s.b.mailboxId, { notifiedAt: T, createdAt: T });
      for (const id of [other.sendId, randomUUID()]) {
        for (const kind of ["ap", "ar", "ag"]) {
          const result = await handleCallback(s.deps, s.owner1, `${kind}:${id}`);
          expect(result).toEqual({ answer: NOT_FOUND });
        }
      }
      expect(await sendRow(trx, other.sendId)).toMatchObject({ status: "awaiting_approval" });
    });
  });

  test("(5) scope off: approved but held; the edit keeps Reject; Reject then works", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx, { sendScope: () => ({ kind: "off" }) });
      const { sendId, emailId } = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, { notifiedAt: T, createdAt: T });
      await queueFor(trx, s.ctx, s.o1, "approval", sendId, emailId);

      const tap = await handleCallback(s.deps, s.owner1, `ap:${sendId}`);
      expect(tap.answer).toBe(APPROVAL_TEXTS.approved_held);
      expect(tap.edit?.buttons).toEqual([[{ text: "✖️ Reject", data: `ar:${sendId}` }]]);
      expect(tap.edit?.text).toContain("Sending is held by SEND_SCOPE");
      expect(await sendRow(trx, sendId)).toMatchObject({ status: "approved" });

      const rejected = await handleCallback(s.deps, s.owner1, `ar:${sendId}`);
      expect(rejected.answer).toBe(APPROVAL_TEXTS.rejected_now);
      expect(await sendRow(trx, sendId)).toMatchObject({ status: "rejected" });
    });
  });

  test("(5a) a paused or auth_error mailbox holds the send and names the cause", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const one = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, { notifiedAt: T, createdAt: T });
      const two = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, { notifiedAt: T, createdAt: T });
      for (const id of [one, two]) await queueFor(trx, s.ctx, s.o1, "approval", id.sendId, id.emailId);

      await trx.updateTable("mailboxes").set({ status: "paused" }).where("id", "=", s.a.mailboxId).execute();
      const paused = await handleCallback(s.deps, s.owner1, `ap:${one.sendId}`);
      expect(paused.answer).toBe(APPROVAL_TEXTS.approved_paused);
      expect(paused.edit?.text).toContain("The mailbox is paused, so the send waits");
      expect(paused.edit?.buttons).toEqual([[{ text: "✖️ Reject", data: `ar:${one.sendId}` }]]);

      await trx.updateTable("mailboxes").set({ status: "auth_error" }).where("id", "=", s.a.mailboxId).execute();
      const broken = await handleCallback(s.deps, s.owner1, `ap:${two.sendId}`);
      expect(broken.answer).toBe(APPROVAL_TEXTS.approved_auth_error);
    });
  });

  test("(5b) a tap after 48 h expires the send; nobody approved it", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const { sendId, emailId } = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, {
        notifiedAt: new Date(T.getTime() - 49 * HOUR),
        createdAt: T,
      });
      await queueFor(trx, s.ctx, s.o1, "approval", sendId, emailId);

      const tap = await handleCallback(s.deps, s.owner1, `ap:${sendId}`);
      expect(tap.answer).toBe(APPROVAL_TEXTS.expired);
      expect(tap.edit).toEqual({ text: `${ORIGINAL}\n\n⌛ Expired 11:00. The mail was not sent.`, buttons: [] });
      expect(await sendRow(trx, sendId)).toMatchObject({
        status: "expired",
        status_reason: "timeout",
        approved_by: null,
      });
    });
  });

  test("(6) reject removes the draft and cancels the delegation; a later approve says rejected", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const { sendId, draftId, emailId } = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, {
        notifiedAt: T,
        createdAt: T,
        delegationId: randomUUID(),
        draftProviderResult: { uid: 5, folder: "Drafts" },
      });
      await queueFor(trx, s.ctx, s.o1, "approval", sendId, emailId);

      const tap = await handleCallback(s.deps, s.owner1, `ar:${sendId}`);
      expect(tap.answer).toBe(APPROVAL_TEXTS.rejected_now);
      expect(tap.edit).toEqual({ text: `${ORIGINAL}\n\n✖️ Rejected 11:00.`, buttons: [] });
      expect(await sendRow(trx, sendId)).toMatchObject({ status: "rejected" });
      const reverse = await trx.selectFrom("actions").selectAll().where("reverses_action_id", "=", draftId).execute();
      expect(reverse).toHaveLength(1);
      expect(s.cancelled).toEqual(["rejected"]);

      const again = await handleCallback(s.deps, s.owner2, `ap:${sendId}`);
      expect(again).toEqual({ answer: APPROVAL_TEXTS.rejected });
    });
  });

  test("(7) approve set approves both; reject set then finds nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const setId = randomUUID();
      const sends = [];
      for (const reminder of [1, 2] as const) {
        sends.push(
          await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, { reminder, setId, notifiedAt: T, createdAt: T })
        );
      }
      await queueFor(
        trx,
        s.ctx,
        s.o1,
        "approval_set",
        setId,
        (sends[0] as { emailId: string }).emailId,
        "📤 Send 2 reminders?"
      );

      const tap = await handleCallback(s.deps, s.owner1, `as:${setId}`);
      expect(tap.answer).toBe("⏳ 2 reminders go out within a minute, 0 skipped.");
      expect(tap.edit).toEqual({
        text: "📤 Send 2 reminders?\n\n⏳ Approved 11:00: 2 sending, 0 skipped.",
        buttons: [],
      });
      for (const send of sends) expect(await sendRow(trx, send.sendId)).toMatchObject({ status: "approved" });

      const skip = await handleCallback(s.deps, s.owner2, `rs:${setId}`);
      expect(skip).toEqual({ answer: APPROVAL_TEXTS.set_nothing });
    });
  });

  test("(7b) reject set skips the waiting reminders", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const setId = randomUUID();
      const send = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, {
        reminder: 1,
        setId,
        notifiedAt: T,
        createdAt: T,
      });
      await queueFor(trx, s.ctx, s.o1, "approval_set", setId, send.emailId, "📤 Send 1 reminder?");

      const tap = await handleCallback(s.deps, s.owner1, `rs:${setId}`);
      expect(tap.answer).toBe("✖️ 1 reminders skipped.");
      expect(tap.edit?.text).toBe("📤 Send 1 reminder?\n\n✖️ Skipped 11:00: 1 rejected, 0 skipped.");
      expect(await sendRow(trx, send.sendId)).toMatchObject({ status: "rejected" });
    });
  });

  test("(8) send again on a failed send creates one approved row; repeats and an applied row do not", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const failed = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, {
        sendStatus: "failed",
        notifiedAt: T,
        createdAt: T,
      });
      await trx
        .updateTable("actions")
        .set({ status_reason: "outcome_unknown" })
        .where("id", "=", failed.sendId)
        .execute();
      await queueFor(
        trx,
        s.ctx,
        s.o1,
        "send_result",
        failed.sendId,
        failed.emailId,
        "⚠️ Unknown whether the mail went out"
      );

      const tap = await handleCallback(s.deps, s.owner1, `ag:${failed.sendId}`);
      expect(tap.answer).toBe(APPROVAL_TEXTS.send_again);
      expect(tap.edit).toEqual({
        text: "⚠️ Unknown whether the mail went out\n\n⏳ Approved 11:00, sending.",
        buttons: [],
      });
      const rows = await trx
        .selectFrom("actions")
        .select(["status", "approved_by"])
        .where("idempotency_key", "=", `${failed.sendId}:again`)
        .execute();
      expect(rows).toEqual([{ status: "approved", approved_by: s.o1 }]);

      for (const link of [s.owner1, s.owner2]) {
        const again = await handleCallback(s.deps, link, `ag:${failed.sendId}`);
        expect(again).toEqual({ answer: APPROVAL_TEXTS.send_again_already });
      }
      const count = await trx
        .selectFrom("actions")
        .select("id")
        .where("idempotency_key", "=", `${failed.sendId}:again`)
        .execute();
      expect(count).toHaveLength(1);

      const applied = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, {
        sendStatus: "applied",
        approved: { userId: s.o1, at: T },
        createdAt: T,
      });
      const notFailed = await handleCallback(s.deps, s.owner1, `ag:${applied.sendId}`);
      expect(notFailed).toEqual({ answer: APPROVAL_TEXTS.send_again_not_failed });
    });
  });

  test("(9) a delegation is closed by an assistant; the second tap says already done", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const delegateId = await insertDelegate(trx, s.ctx);
      const sent = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, {
        sendStatus: "applied",
        approved: { userId: s.o1, at: T },
        createdAt: T,
      });
      const delegationId = await insertDelegation(trx, s.ctx, {
        mailboxId: s.a.mailboxId,
        emailId: sent.emailId,
        delegateId,
        draftActionId: sent.draftId,
        sendActionId: sent.sendId,
        status: "answered",
        answeredAt: T,
      });
      await queueFor(
        trx,
        s.ctx,
        s.assistant,
        "delegation_answered",
        delegationId,
        sent.emailId,
        "📩 Delegate answered"
      );

      const tap = await handleCallback(s.deps, s.assistantLink, `dd:${delegationId}`);
      expect(tap.answer).toBe(APPROVAL_TEXTS.done);
      expect(tap.edit).toEqual({ text: "📩 Delegate answered\n\n✅ Done 11:00.", buttons: [] });
      const row = await trx
        .selectFrom("delegations")
        .select("status")
        .where("id", "=", delegationId)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe("done");
      const audit = await trx
        .selectFrom("audit_log")
        .select("actor")
        .where("org_id", "=", s.a.orgId)
        .where("event", "=", auditEvents.delegationDone)
        .execute();
      expect(audit).toEqual([{ actor: s.assistant }]);

      const again = await handleCallback(s.deps, s.assistantLink, `dd:${delegationId}`);
      expect(again).toEqual({ answer: APPROVAL_TEXTS.done_already });

      const second = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, {
        sendStatus: "applied",
        approved: { userId: s.o1, at: T },
        createdAt: T,
      });
      const waiting = await insertDelegation(trx, s.ctx, {
        mailboxId: s.a.mailboxId,
        emailId: second.emailId,
        delegateId,
        draftActionId: second.draftId,
        sendActionId: second.sendId,
        status: "sent",
      });
      const notClosable = await handleCallback(s.deps, s.assistantLink, `dd:${waiting}`);
      expect(notClosable).toEqual({ answer: APPROVAL_TEXTS.done_not_closable });
      const missing = await handleCallback(s.deps, s.assistantLink, `dd:${randomUUID()}`);
      expect(missing).toEqual({ answer: NOT_FOUND });
    });
  });

  test("(5c) a tap on an already expired send only answers; the message is not edited again", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const { sendId, emailId } = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, {
        sendStatus: "expired",
        notifiedAt: new Date(T.getTime() - 49 * HOUR),
        createdAt: T,
      });
      await queueFor(trx, s.ctx, s.o1, "approval", sendId, emailId);

      const tap = await handleCallback(s.deps, s.owner1, `ap:${sendId}`);
      expect(tap).toEqual({ answer: APPROVAL_TEXTS.expired });
    });
  });

  test("(5d) a draft that is not in Drafts yet: the tap answers and changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const { sendId, emailId } = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, {
        draftStatus: "ready",
        notifiedAt: T,
        createdAt: T,
      });
      await queueFor(trx, s.ctx, s.o1, "approval", sendId, emailId);

      const tap = await handleCallback(s.deps, s.owner1, `ap:${sendId}`);
      expect(tap).toEqual({ answer: APPROVAL_TEXTS.draft_not_ready });
      expect(await sendRow(trx, sendId)).toMatchObject({ status: "awaiting_approval", approved_by: null });
    });
  });

  test("(7c) another organization's set id: nothing happens, the rows stay", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const setId = randomUUID();
      const other = await insertDraftAndSend(trx, { orgId: s.b.orgId }, s.b.mailboxId, {
        reminder: 1,
        setId,
        notifiedAt: T,
        createdAt: T,
      });
      for (const kind of ["as", "rs"]) {
        const result = await handleCallback(s.deps, s.owner1, `${kind}:${setId}`);
        expect(result).toEqual({ answer: APPROVAL_TEXTS.set_nothing });
      }
      expect(await sendRow(trx, other.sendId)).toMatchObject({ status: "awaiting_approval", approved_by: null });
    });
  });

  test("(9b) another organization's delegation id gives the not-found text; the delegation stays", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const ctxB = { orgId: s.b.orgId };
      const delegateId = await insertDelegate(trx, ctxB);
      const sent = await insertDraftAndSend(trx, ctxB, s.b.mailboxId, {
        sendStatus: "applied",
        approved: { userId: s.b.userId, at: T },
        createdAt: T,
      });
      const delegationId = await insertDelegation(trx, ctxB, {
        mailboxId: s.b.mailboxId,
        emailId: sent.emailId,
        delegateId,
        draftActionId: sent.draftId,
        sendActionId: sent.sendId,
        status: "answered",
        answeredAt: T,
      });
      const tap = await handleCallback(s.deps, s.assistantLink, `dd:${delegationId}`);
      expect(tap).toEqual({ answer: NOT_FOUND });
      const row = await trx
        .selectFrom("delegations")
        .select("status")
        .where("id", "=", delegationId)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe("answered");
    });
  });

  test("(8b) send again and the set taps name the cause when the new sends are held", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx, { sendScope: () => ({ kind: "off" }) });
      const failed = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, {
        sendStatus: "failed",
        notifiedAt: T,
        createdAt: T,
      });
      await trx.updateTable("actions").set({ status_reason: "smtp_error" }).where("id", "=", failed.sendId).execute();
      await queueFor(trx, s.ctx, s.o1, "send_result", failed.sendId, failed.emailId);
      const again = await handleCallback(s.deps, s.owner1, `ag:${failed.sendId}`);
      expect(again.answer).toBe(APPROVAL_TEXTS.send_again_held.scope);
      const newSend = await trx
        .selectFrom("actions")
        .select("id")
        .where("idempotency_key", "=", `${failed.sendId}:again`)
        .executeTakeFirstOrThrow();
      expect(again.edit?.text).toContain("Sending is held by SEND_SCOPE");
      expect(again.edit?.buttons).toEqual([[{ text: "✖️ Reject", data: `ar:${newSend.id}` }]]);

      const setId = randomUUID();
      const sent = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, {
        reminder: 1,
        setId,
        notifiedAt: T,
        createdAt: T,
      });
      await queueFor(trx, s.ctx, s.o1, "approval_set", setId, sent.emailId, "📤 Send 1 reminder?");
      await trx.updateTable("mailboxes").set({ status: "paused" }).where("id", "=", s.a.mailboxId).execute();
      const set = await handleCallback(s.deps, s.owner1, `as:${setId}`);
      // The mailbox state comes before the scope, as in /status.
      expect(set.answer).toBe(
        `⏳ 1 reminders approved, 0 skipped. ${APPROVAL_TEXTS.held_notes.paused}; /status shows it.`
      );
      expect(set.edit?.text).toContain("The mailbox is paused, so the send waits");
      expect(set.edit?.buttons).toEqual([]);
      expect(await sendRow(trx, sent.sendId)).toMatchObject({ status: "approved" });
    });
  });

  test("(10) forged data is not valid", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      const result = await handleCallback(s.deps, s.owner1, "ap:nope");
      expect(result).toEqual({ answer: "This button is not valid any more." });
    });
  });

  test("(11) the S2 and S3 taps still work", async () => {
    await withRollback(db, async (trx) => {
      const { info, link, deps } = await setup(trx);
      expect((await handleCallback(deps, link, `fr:i:${info}`)).answer).toBe("✅ Saved: Info is right.");
      expect((await handleCallback(deps, link, `fu:${info}`)).answer).toBe(UNDO_TEXTS.nothing);
    });
  });
});
