import { MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { approve, createCommitterJob, noApprovalHooks } from "../../src/modules/actions";
import { getMailboxSettings, insertDefaultSettings } from "../../src/modules/config";
import { delegationHooks } from "../../src/modules/delegation";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { claimEmails, insertCredentials } from "../../src/modules/mail/repo";
import { triageOne, type TriageMailbox, noGateEvidence } from "../../src/modules/triage";
import type { LlmClient } from "../../src/platform/llm";

import { NOW, CREATED, at, secrets, setup, row } from "./actions-send-helpers";
import { insertDelegate, insertTestEmail, noSuspiciousContext, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// (14) The whole chain with the real code: triage plans the pair and the delegation, the committer writes the draft, the
// approval service approves, the committer sends, the delegate's reply answers the delegation.
function fakeLlm(answer: Record<string, unknown>): LlmClient {
  return {
    modelOf: () => "fake-model",
    endpointOf: () => "standard",
    async generate(req: { role: string; promptVersion: string; schema: { parse(value: unknown): unknown } }) {
      return {
        data: req.schema.parse(answer),
        usage: {
          role: req.role,
          promptVersion: req.promptVersion,
          model: "fake-model",
          tokensIn: 100,
          tokensOut: 20,
          latencyMs: 300,
          endpoint: "standard",
        },
      };
    },
  } as unknown as LlmClient;
}

const pause = {
  trip: (_kind: string, _code: string, time: Date) => new Date(time.getTime() + 5 * MINUTE_MS),
  isPaused: () => false,
  pausedUntil: () => null,
  pausedSince: () => null,
  reset: () => undefined,
};

const analysisOf = (overrides: Record<string, unknown>) => ({
  category: "info",
  confidence: 0.95,
  reason_code: "newsletter",
  reason: "r",
  summary: "short summary",
  fields: { due_date: null, language: "en", delegate_id: null, task: null, clarification: null },
  ...overrides,
});

describe("send end to end", () => {
  test("(14) triage, draft, approval, send, the delegation is sent, the reply answers it", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const s = await setup(trx);
      const secret = secrets.encrypt("pw", `mailbox:${s.mailboxId}`);
      await insertCredentials(trx, s.ctx, {
        mailboxId: s.mailboxId,
        encryptedSecret: secret.ciphertext,
        secretKind: "password",
        keyVersion: secret.keyVersion,
      });
      await insertDefaultSettings(trx, s.ctx, s.mailboxId);
      const settings = await getMailboxSettings(trx, s.ctx, s.mailboxId);
      if (settings === undefined) throw new Error("no settings");
      const delegateId = await insertDelegate(trx, s.ctx, { name: "Anna", email: "anna@firma.test", tags: ["offers"] });
      const mailbox: TriageMailbox = {
        id: s.mailboxId,
        settingsVersion: settings.version,
        mode: "assist",
        toolSwitches: { move: true, mark_read: true, flag: true, create_draft: true, move_unsure: true },
        runningKey: noGateEvidence.runningKey,
        policy: { info: { auto: true } },
        rules: [],
        movesSupported: true,
        delegates: [{ id: delegateId, name: "Anna", email: "anna@firma.test", tags: ["offers"] }],
        timezone: "Europe/Warsaw",
        junkFolder: null,
        resumedAt: null,
        suspicious: noSuspiciousContext,
        urgencyProfile: null,
      };
      const claimMail = async (time: Date) =>
        claimEmails(trx, s.ctx, s.mailboxId, {
          now: time,
          limit: 10,
          staleBefore: new Date(time.getTime() - 5 * MINUTE_MS),
          syntheticOnly: false,
        });
      const triageDeps = (answer: Record<string, unknown>) => ({
        db: trx,
        llm: fakeLlm(answer),
        pause,
        testMail: NO_TEST_SENDERS,
        dailyCap: 1000,
        junkDailyCap: 1000,
        now: () => NOW,
      });

      const emailId = await insertTestEmail(trx, s.ctx, s.mailboxId, {
        from_address: "jan@klient.test",
        subject: "Offer",
        body_text: "Please prepare the offer.",
        message_id_header: "<orig@klient.test>",
        received_at: CREATED,
      });
      const [email] = await claimMail(NOW);
      const delegationAnswer = analysisOf({
        category: "delegation",
        summary: null,
        reason_code: "direct_request",
        fields: {
          due_date: "2026-11-10",
          language: "en",
          delegate_id: delegateId,
          task: "Prepare the offer",
          clarification: null,
        },
      });
      expect(await triageOne(triageDeps(delegationAnswer), s.ctx, mailbox, email as NonNullable<typeof email>)).toEqual(
        {
          kind: "triaged",
        }
      );

      const job = createCommitterJob({
        db: trx,
        secrets,
        openProvider: async () => s.fake,
        openSender: async () => s.sender,
        scope: { kind: "all" },
        sendScope: { kind: "all" },
        hooks: delegationHooks({ db }),
        now: () => NOW,
      });
      await job.run();

      const actions = await trx.selectFrom("actions").selectAll().where("email_id", "=", emailId).execute();
      const draft = actions.find((a) => a.type === "create_draft" && a.reverses_action_id === null);
      const send = actions.find((a) => a.type === "send");
      expect(draft?.status).toBe("applied");
      expect(send?.status).toBe("awaiting_approval");
      expect(s.sender.sent).toHaveLength(0);

      await trx
        .updateTable("actions")
        .set({ notified_at: NOW })
        .where("id", "=", send?.id as string)
        .execute();
      const approvals = {
        db: trx,
        hooks: delegationHooks({ db }),
        approvalHooks: noApprovalHooks,
        uidplus: async () => true,
      };
      expect(
        await approve(approvals, s.ctx, send?.id as string, { userId: s.userId, via: "telegram", now: NOW })
      ).toEqual({ kind: "approved" });
      await job.run();

      expect(s.sender.sent).toHaveLength(1);
      const sentRow = await row(trx, send?.id as string);
      expect(sentRow.status).toBe("applied");
      const delegation = await trx
        .selectFrom("delegations")
        .selectAll()
        .where("email_id", "=", emailId)
        .executeTakeFirstOrThrow();
      expect(delegation.status).toBe("sent");
      expect(delegation.sent_message_id).toBe(sentRow.outgoing_message_id);
      expect(delegation.due_at).not.toBeNull();

      const replyId = await insertTestEmail(trx, s.ctx, s.mailboxId, {
        from_address: "anna@firma.test",
        in_reply_to: sentRow.outgoing_message_id,
        received_at: at(1),
      });
      const [reply] = await claimMail(at(1));
      expect(reply?.id).toBe(replyId);
      expect(await triageOne(triageDeps(analysisOf({})), s.ctx, mailbox, reply as NonNullable<typeof reply>)).toEqual({
        kind: "triaged",
      });
      const answered = await trx
        .selectFrom("delegations")
        .select(["status", "answered_email_id"])
        .where("id", "=", delegation.id)
        .executeTakeFirstOrThrow();
      expect(answered).toEqual({ status: "answered", answered_email_id: replyId });
    });
  });
});
