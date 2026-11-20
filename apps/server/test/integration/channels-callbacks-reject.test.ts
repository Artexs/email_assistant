import { randomUUID } from "node:crypto";

import { textTables } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { auditEvents } from "../../src/modules/audit";
import { handleCallback } from "../../src/modules/channels";

import { T, NOT_FOUND, ORIGINAL, approvalSetup, queueFor, sendRow } from "./channels-callbacks-helpers";
import { insertDelegate, insertDelegation, insertDraftAndSend } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("approval taps", () => {
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
      expect(tap.answer).toBe(textTables.en.bot.taps.rejectedNow);
      expect(tap.edit).toEqual({ text: `${ORIGINAL}\n\n✖️ Rejected 11:00.`, buttons: [] });
      expect(await sendRow(trx, sendId)).toMatchObject({ status: "rejected" });
      const reverse = await trx.selectFrom("actions").selectAll().where("reverses_action_id", "=", draftId).execute();
      expect(reverse).toHaveLength(1);
      expect(s.cancelled).toEqual(["rejected"]);

      const again = await handleCallback(s.deps, s.owner2, `ap:${sendId}`);
      expect(again).toEqual({ answer: textTables.en.bot.taps.rejected });
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
      expect(skip).toEqual({ answer: textTables.en.bot.taps.setNothing });
    });
  });

  test("(7c) approve set of a host_blocked mailbox names the cause", async () => {
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
      await trx.updateTable("mailboxes").set({ status: "host_blocked" }).where("id", "=", s.a.mailboxId).execute();

      const tap = await handleCallback(s.deps, s.owner1, `as:${setId}`);
      expect(tap.answer).toContain(textTables.en.bot.taps.heldNotes.host_blocked);
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
      expect(tap.answer).toBe(textTables.en.bot.taps.done);
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
      expect(again).toEqual({ answer: textTables.en.bot.taps.doneAlready });

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
      expect(notClosable).toEqual({ answer: textTables.en.bot.taps.doneNotClosable });
      const missing = await handleCallback(s.deps, s.assistantLink, `dd:${randomUUID()}`);
      expect(missing).toEqual({ answer: NOT_FOUND });
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
        expect(result).toEqual({ answer: textTables.en.bot.taps.setNothing });
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
});
