import { randomUUID } from "node:crypto";

import { textTables } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { auditEvents } from "../../src/modules/audit";
import { handleCallback, type LinkedChat } from "../../src/modules/channels";
import { delegationHooks, detectReply } from "../../src/modules/delegation";
import { type DB } from "../../src/platform/db";

import { T, NOT_FOUND, approvalSetup, queueFor, sendRow } from "./channels-callbacks-helpers";
import { createOrgWithMailbox, insertDelegate, insertDelegation, insertDraftAndSend } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("approval taps", () => {
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
      expect(tap.answer).toBe(textTables.en.bot.taps.sendAgain);
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
        expect(again).toEqual({ answer: textTables.en.bot.taps.sendAgainAlready });
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
      expect(notFailed).toEqual({ answer: textTables.en.bot.taps.sendAgainNotFailed });
    });
  });

  test("(8b) send again of a host_blocked mailbox names the cause", async () => {
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
      await queueFor(trx, s.ctx, s.o1, "send_result", failed.sendId, failed.emailId, "⚠️ Unknown whether it went out");
      await trx.updateTable("mailboxes").set({ status: "host_blocked" }).where("id", "=", s.a.mailboxId).execute();

      const tap = await handleCallback(s.deps, s.owner1, `ag:${failed.sendId}`);
      expect(tap.answer).toBe(textTables.en.bot.taps.sendAgainHeld.host_blocked);
    });
  });

  // A delegation send that ended `outcome_unknown`, its delegation `cancelled`, and the result notice in the outbox.
  async function unknownDelegationSend(trx: Transaction<DB>, s: Awaited<ReturnType<typeof approvalSetup>>) {
    const delegateId = await insertDelegate(trx, s.ctx, { email: "anna@x.test" });
    const messageId = `<out-${randomUUID()}@x.test>`;
    const send = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, {
      sendStatus: "failed",
      notifiedAt: T,
      createdAt: T,
      delegateId,
      outgoingMessageId: messageId,
    });
    await trx.updateTable("actions").set({ status_reason: "outcome_unknown" }).where("id", "=", send.sendId).execute();
    const id = await insertDelegation(trx, s.ctx, {
      mailboxId: s.a.mailboxId,
      emailId: send.emailId,
      delegateId,
      draftActionId: send.draftId,
      sendActionId: send.sendId,
      status: "cancelled",
    });
    await trx.updateTable("delegations").set({ status_reason: "outcome_unknown" }).where("id", "=", id).execute();
    await trx
      .updateTable("actions")
      .set({ payload: sql`jsonb_set(payload, '{delegation_id}', to_jsonb(${id}::text))` })
      .where("id", "=", send.sendId)
      .execute();
    await queueFor(trx, s.ctx, s.o1, "send_result", send.sendId, send.emailId, "⚠️ Unknown whether the mail went out");
    return { ...send, delegationId: id, messageId };
  }

  async function delegationRow(trx: Transaction<DB>, id: string) {
    return trx.selectFrom("delegations").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  }

  test("(8d) 'It went out' sets the delegation to sent, once, without a new send; a reply is then matched", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      s.deps.hooks = delegationHooks({ db: trx });
      const u = await unknownDelegationSend(trx, s);
      const actionsBefore = await trx.selectFrom("actions").select("id").where("org_id", "=", s.a.orgId).execute();

      const tap = await handleCallback(s.deps, s.owner1, `gw:${u.sendId}`);
      expect(tap.answer).toBe(textTables.en.bot.taps.wentOut);
      expect(tap.edit).toEqual({
        text: "⚠️ Unknown whether the mail went out\n\n✅ Marked as sent 11:00.",
        buttons: [],
      });
      expect(await delegationRow(trx, u.delegationId)).toMatchObject({
        status: "sent",
        status_reason: null,
        sent_message_id: u.messageId,
      });
      // The send row stays failed; no row is added (no new send, so no SMTP call).
      expect(await sendRow(trx, u.sendId)).toMatchObject({ status: "failed", status_reason: "outcome_unknown" });
      expect(await trx.selectFrom("actions").select("id").where("org_id", "=", s.a.orgId).execute()).toHaveLength(
        actionsBefore.length
      );
      const audit = await trx
        .selectFrom("audit_log")
        .select(["event", "actor"])
        .where("org_id", "=", s.a.orgId)
        .where("event", "in", [auditEvents.actionWentOut, auditEvents.delegationSent])
        .orderBy("event")
        .execute();
      expect(audit).toEqual([
        { event: auditEvents.actionWentOut, actor: s.o1 },
        { event: auditEvents.delegationSent, actor: s.o1 },
      ]);

      // A reply of the delegate is matched now.
      expect(
        await detectReply(trx, s.ctx, s.a.mailboxId, {
          fromAddress: "anna@x.test",
          inReplyTo: u.messageId,
          referencesHeader: null,
        })
      ).toMatchObject({ delegationId: u.delegationId });

      // The second tap, by any owner, changes nothing.
      const again = await handleCallback(s.deps, s.owner2, `gw:${u.sendId}`);
      expect(again).toEqual({ answer: textTables.en.bot.taps.wentOutAlready });
      const auditAfter = await trx
        .selectFrom("audit_log")
        .select("id")
        .where("org_id", "=", s.a.orgId)
        .where("event", "in", [auditEvents.actionWentOut, auditEvents.delegationSent])
        .execute();
      expect(auditAfter).toHaveLength(2);
    });
  });

  test("(8e) 'It went out': an assistant, a send sent again, another state and another send change nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await approvalSetup(trx);
      s.deps.hooks = delegationHooks({ db: trx });
      const u = await unknownDelegationSend(trx, s);
      const unchanged = async () =>
        expect(await delegationRow(trx, u.delegationId)).toMatchObject({
          status: "cancelled",
          status_reason: "outcome_unknown",
          sent_message_id: null,
        });

      expect(await handleCallback(s.deps, s.assistantLink, `gw:${u.sendId}`)).toEqual({
        answer: textTables.en.bot.taps.ownerOnly,
      });
      await unchanged();

      // Another organization's owner sees the mail as not found.
      const foreign = await createOrgWithMailbox(trx);
      const foreignLink: LinkedChat = {
        orgId: foreign.orgId,
        userId: foreign.userId,
        role: "owner",
        chatId: 2,
        linkedAt: T,
        locale: "en",
      };
      expect(await handleCallback(s.deps, foreignLink, `gw:${u.sendId}`)).toEqual({ answer: NOT_FOUND });
      await unchanged();

      // The delegation was closed by another path (a failed resend): no change.
      await trx
        .updateTable("delegations")
        .set({ status_reason: "send_failed" })
        .where("id", "=", u.delegationId)
        .execute();
      expect(await handleCallback(s.deps, s.owner1, `gw:${u.sendId}`)).toEqual({
        answer: textTables.en.bot.taps.wentOutDelegationNotOpen,
      });
      await trx
        .updateTable("delegations")
        .set({ status_reason: "outcome_unknown" })
        .where("id", "=", u.delegationId)
        .execute();

      // A send that is not in the unknown state.
      const applied = await insertDraftAndSend(trx, s.ctx, s.a.mailboxId, {
        sendStatus: "applied",
        approved: { userId: s.o1, at: T },
        createdAt: T,
      });
      expect(await handleCallback(s.deps, s.owner1, `gw:${applied.sendId}`)).toEqual({
        answer: textTables.en.bot.taps.wentOutNotUnknown,
      });

      // The send was sent again: the resend decides.
      const resend = await handleCallback(s.deps, s.owner1, `ag:${u.sendId}`);
      expect(resend.answer).toBe(textTables.en.bot.taps.sendAgain);
      expect(await handleCallback(s.deps, s.owner1, `gw:${u.sendId}`)).toEqual({
        answer: textTables.en.bot.taps.wentOutSentAgain,
      });
      await unchanged();
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
      expect(again.answer).toBe(textTables.en.bot.taps.sendAgainHeld.scope);
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
        `⏳ 1 reminders approved, 0 skipped. ${textTables.en.bot.taps.heldNotes.paused}; /status shows it.`
      );
      expect(set.edit?.text).toContain("The mailbox is paused, so the send waits");
      expect(set.edit?.buttons).toEqual([]);
      expect(await sendRow(trx, sent.sendId)).toMatchObject({ status: "approved" });
    });
  });
});
