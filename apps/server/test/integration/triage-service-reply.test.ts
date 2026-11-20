import { MINUTE_MS, DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { listActionsForEmail } from "../../src/modules/actions";
import { getMailboxSettings } from "../../src/modules/config";
import { claimEmails } from "../../src/modules/mail";
import { finishTriageError, saveTriage, triageOne, type TriageMailbox } from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";
import { LlmBlockedError } from "../../src/platform/llm";

import { insertAction, insertDelegate, insertDelegation, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import {
  now,
  decision,
  results,
  audit,
  emailStatus,
  fakeLlm,
  analysis,
  setupMail,
  delegationSetup,
  delegationAnswer,
  triageDeps,
  delegationRows,
} from "./triage-service-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const REPLY_DELEGATE = "anna@firma.test";

// A delegation in `sent` for a mail of this mailbox; the sent Message-ID is `<m1>`.
async function sentDelegation(trx: Transaction<DB>, ctx: TenantContext, mailboxId: string, delegateId: string) {
  const emailId = await insertTestEmail(trx, ctx, mailboxId, { status: "triaged" });
  const draftId = await insertAction(trx, ctx, emailId, { type: "create_draft", status: "applied" });
  const sendId = await insertAction(trx, ctx, emailId, {
    type: "send",
    status: "applied",
    dependsOnActionId: draftId,
    approvedAt: new Date("2026-11-05T08:59:00Z"),
  });
  return insertDelegation(trx, ctx, {
    mailboxId,
    emailId,
    delegateId,
    draftActionId: draftId,
    sendActionId: sendId,
    status: "sent",
    sentMessageId: "<m1>",
  });
}

async function delegationStatus(trx: Transaction<DB>, id: string) {
  return trx
    .selectFrom("delegations")
    .select(["status", "answered_email_id"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

async function replySetup(
  trx: Transaction<DB>,
  opts: { from?: string; inReplyTo?: string; receivedAt?: Date; rules?: TriageMailbox["rules"]; status?: string } = {}
) {
  const base = await setupMail(
    trx,
    {
      from_address: opts.from ?? REPLY_DELEGATE,
      in_reply_to: opts.inReplyTo ?? "<m1>",
      ...(opts.receivedAt ? { received_at: opts.receivedAt } : {}),
    },
    opts.rules ?? []
  );
  const delegateId = await insertDelegate(trx, base.ctx, { name: "Anna", email: REPLY_DELEGATE });
  const delegationId = await sentDelegation(trx, base.ctx, base.mailbox.id, delegateId);
  if (opts.status) {
    await trx.updateTable("delegations").set({ status: opts.status }).where("id", "=", delegationId).execute();
  }
  return { ...base, delegateId, delegationId };
}

describe("triageOne: the reply rule", () => {
  test("a delegate's reply marks the delegation answered and the mail is triaged as any mail", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox, delegationId } = await replySetup(trx);
      expect(await triageOne(triageDeps(trx, fakeLlm(analysis())), ctx, mailbox, email)).toEqual({ kind: "triaged" });

      expect(await delegationStatus(trx, delegationId)).toEqual({ status: "answered", answered_email_id: emailId });
      const log = await audit(trx, emailId);
      expect(log.filter((r) => r.event === "delegation.answered")).toHaveLength(1);
      expect(log.find((r) => r.event === "email.triaged")?.data).toMatchObject({
        answered_delegation_id: delegationId,
      });
      const [row] = await results(trx, emailId);
      expect(row?.category).toBe("info");
      expect((await listActionsForEmail(trx, ctx, emailId)).length).toBeGreaterThan(0);
    });
  });

  test("a safety block still marks the reply", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox, delegationId } = await replySetup(trx);
      await triageOne(triageDeps(trx, fakeLlm(new LlmBlockedError("fake-model"))), ctx, mailbox, email);

      const [row] = await results(trx, emailId);
      expect(row).toMatchObject({ category: "unsure", reason_code: "llm_blocked" });
      expect(await delegationStatus(trx, delegationId)).toEqual({ status: "answered", answered_email_id: emailId });
    });
  });

  test("finishTriageError still marks the reply", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox, delegationId } = await replySetup(trx);
      await finishTriageError(triageDeps(trx, fakeLlm(analysis())), ctx, mailbox, email);

      expect((await results(trx, emailId))[0]?.reason_code).toBe("triage_error");
      expect(await delegationStatus(trx, delegationId)).toEqual({ status: "answered", answered_email_id: emailId });
    });
  });

  test("a late reply (skipTooOld) still marks the delegation", async () => {
    await withRollback(db, async (trx) => {
      const received = new Date(now.getTime() - 8 * DAY_MS);
      const { ctx, emailId, email, mailbox, delegationId } = await replySetup(trx, { receivedAt: received });
      const llm = fakeLlm(analysis());
      expect(await triageOne(triageDeps(trx, llm), ctx, mailbox, email)).toEqual({ kind: "skipped" });

      expect(llm.requests).toHaveLength(0);
      expect(await emailStatus(trx, emailId)).toBe("skipped");
      expect(await delegationStatus(trx, delegationId)).toEqual({ status: "answered", answered_email_id: emailId });
    });
  });

  test("a blocklisted delegate's reply is spam and still marks the delegation", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox, delegationId } = await replySetup(trx, {
        rules: [{ pattern: "firma.test", kind: "blocklist" }],
      });
      const llm = fakeLlm(analysis());
      await triageOne(triageDeps(trx, llm), ctx, mailbox, email);

      expect(llm.requests).toHaveLength(0);
      expect((await results(trx, emailId))[0]?.category).toBe("spam");
      expect(await delegationStatus(trx, delegationId)).toEqual({ status: "answered", answered_email_id: emailId });
    });
  });

  test("a reply from another address changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, email, mailbox, delegationId } = await replySetup(trx, { from: "other@firma.test" });
      await triageOne(triageDeps(trx, fakeLlm(analysis())), ctx, mailbox, email);

      expect(await delegationStatus(trx, delegationId)).toEqual({ status: "sent", answered_email_id: null });
    });
  });

  test("a reply to a done delegation changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, email, mailbox, delegationId } = await replySetup(trx, { status: "done" });
      await triageOne(triageDeps(trx, fakeLlm(analysis())), ctx, mailbox, email);

      expect(await delegationStatus(trx, delegationId)).toEqual({ status: "done", answered_email_id: null });
    });
  });

  test("a lost claim writes no delegations row and no answered", async () => {
    await withRollback(db, async (trx) => {
      const reply = await replySetup(trx);
      await trx
        .updateTable("emails")
        .set({ locked_at: new Date(now.getTime() + MINUTE_MS) })
        .where("id", "=", reply.emailId)
        .execute();
      expect(await saveTriage(trx, reply.ctx, reply.mailbox, reply.email, decision(), now)).toEqual({ kind: "lost" });
      expect(await delegationStatus(trx, reply.delegationId)).toEqual({ status: "sent", answered_email_id: null });

      const mail = await delegationSetup(trx);
      await trx
        .updateTable("emails")
        .set({ locked_at: new Date(now.getTime() + MINUTE_MS) })
        .where("id", "=", mail.emailId)
        .execute();
      const planned = decision({
        finalCategory: "delegation",
        modelCategory: "delegation",
        delegation: {
          delegateId: mail.delegateId,
          delegateName: "Anna",
          to: "anna@firma.test",
          task: "Prepare the offer",
          clarification: null,
          dueDate: null,
          language: "en",
          senderAddress: "jan@klient.test",
        },
      });
      expect(await saveTriage(trx, mail.ctx, mail.mailbox, mail.email, planned, now)).toEqual({ kind: "lost" });
      expect(await delegationRows(trx, mail.emailId)).toHaveLength(0);
      expect(await listActionsForEmail(trx, mail.ctx, mail.emailId)).toHaveLength(0);
    });
  });

  test("changed settings: no delegations row, no answered; the next run does both", async () => {
    await withRollback(db, async (trx) => {
      const mail = await delegationSetup(trx);
      const reply = await replySetup(trx);
      // Both mails belong to one mailbox each; make the settings of each stale.
      for (const mailboxId of [mail.mailbox.id, reply.mailbox.id]) {
        await trx
          .updateTable("mailbox_settings")
          .set({ updated_at: new Date(now.getTime() + MINUTE_MS) })
          .where("mailbox_id", "=", mailboxId)
          .execute();
      }

      expect(
        await triageOne(triageDeps(trx, fakeLlm(delegationAnswer(mail.delegateId))), mail.ctx, mail.mailbox, mail.email)
      ).toEqual({ kind: "settings_changed" });
      expect(await triageOne(triageDeps(trx, fakeLlm(analysis())), reply.ctx, reply.mailbox, reply.email)).toEqual({
        kind: "settings_changed",
      });
      expect(await delegationRows(trx, mail.emailId)).toHaveLength(0);
      expect(await delegationStatus(trx, reply.delegationId)).toEqual({ status: "sent", answered_email_id: null });
      expect(await emailStatus(trx, mail.emailId)).toBe("pending");
      expect(await emailStatus(trx, reply.emailId)).toBe("pending");

      const clock = new Date(now.getTime() + 120_000);
      const claimed = await claimEmails(trx, mail.ctx, mail.mailbox.id, {
        now: clock,
        limit: 10,
        staleBefore: new Date(clock.getTime() - 5 * MINUTE_MS),
        syntheticOnly: false,
      });
      const mailAgain = claimed.find((row) => row.id === mail.emailId);
      const claimedReply = await claimEmails(trx, reply.ctx, reply.mailbox.id, {
        now: clock,
        limit: 10,
        staleBefore: new Date(clock.getTime() - 5 * MINUTE_MS),
        syntheticOnly: false,
      });
      const replyAgain = claimedReply.find((row) => row.id === reply.emailId);
      if (!mailAgain || !replyAgain) throw new Error("claim failed");
      const fresh = async (mailbox: TriageMailbox, ctx: TenantContext) => ({
        ...mailbox,
        settingsVersion: (await getMailboxSettings(trx, ctx, mailbox.id))?.version ?? "",
      });
      await triageOne(
        triageDeps(trx, fakeLlm(delegationAnswer(mail.delegateId)), clock),
        mail.ctx,
        await fresh(mail.mailbox, mail.ctx),
        mailAgain
      );
      await triageOne(
        triageDeps(trx, fakeLlm(analysis()), clock),
        reply.ctx,
        await fresh(reply.mailbox, reply.ctx),
        replyAgain
      );
      expect(await delegationRows(trx, mail.emailId)).toHaveLength(1);
      expect(await delegationStatus(trx, reply.delegationId)).toEqual({
        status: "answered",
        answered_email_id: reply.emailId,
      });
    });
  });
});
