import { randomBytes, randomUUID } from "node:crypto";

import { parseToolSwitches, MINUTE_MS, HOUR_MS, DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { createCommitterJob, createExpiryJob } from "../../src/modules/actions";
import { detectNotices, handleCallback, type CallbackDeps, type LinkedChat } from "../../src/modules/channels";
import { getMailboxSettings, insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";
import { delegationHooks } from "../../src/modules/delegation";
import { createLoopChaserJob } from "../../src/modules/loops";
import { composeMessage, SmtpSendError } from "../../src/modules/mail";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender } from "../../src/modules/mail/fake/sender";
import { insertCredentials, markSynced } from "../../src/modules/mail/repo";
import { createSecretBox } from "../../src/platform/crypto";
import { captureLogs, eventLines, logProblems } from "../log-capture";

import {
  createOrgWithMailbox,
  insertDelegate,
  insertDelegation,
  insertDraftAndSend,
  isolateChannels,
  linkChat,
  pauseOtherMailboxes,
  randomChatId,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// 07:30 in Warsaw (CET): the chaser acts.
const T0 = new Date("2026-11-10T06:30:00Z");
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

const run = randomUUID();
const MARKERS = {
  name: `MARKER-NAME-${run}`,
  delegate: `marker-delegate-${run}@x.test`,
  subject: `MARKER-SUBJECT-${run}`,
  sender: `marker-sender-${run}@x.test`,
  body: `MARKER-BODY-${run}`,
  task: `MARKER-TASK-${run}`,
  // The server reply of the refused send, with an address in it.
  reply: `550 5.1.1 marker-reply-${run}@x.test unknown`,
};

describe("send logs", () => {
  test("no S4 log line holds a recipient, a subject, a task, a draft text or an SMTP reply; the expected lines appear", async () => {
    const capture = captureLogs();
    try {
      await withRollback(db, async (trx) => {
        await isolateChannels(trx);
        await pauseOtherMailboxes(trx);
        const address = `box-${randomUUID()}@x.test`;
        const { orgId, userId, mailboxId } = await createOrgWithMailbox(trx, { address });
        const ctx = { orgId };
        const secret = secrets.encrypt("pw", `mailbox:${mailboxId}`);
        await insertCredentials(trx, ctx, {
          mailboxId,
          encryptedSecret: secret.ciphertext,
          secretKind: "password",
          keyVersion: secret.keyVersion,
        });
        await linkChat(trx, ctx, userId, randomChatId(), new Date(T0.getTime() - DAY_MS));
        await insertDefaultSettings(trx, ctx, mailboxId);
        const settings = await getMailboxSettings(trx, ctx, mailboxId);
        await updateMailboxSettings(trx, ctx, mailboxId, {
          mode: "assist",
          toolSwitches: { ...parseToolSwitches(settings?.tool_switches), create_draft: true },
        });

        const delegateId = await insertDelegate(trx, ctx, { name: MARKERS.name, email: MARKERS.delegate });
        const created = new Date(T0.getTime() - HOUR_MS);
        const mail = (extra: Parameters<typeof insertDraftAndSend>[3] = {}) =>
          insertDraftAndSend(trx, ctx, mailboxId, {
            delegateId,
            delegateName: MARKERS.name,
            to: MARKERS.delegate,
            task: MARKERS.task,
            dueDate: "2026-11-09",
            subject: MARKERS.subject,
            from: MARKERS.sender,
            bodyText: MARKERS.body,
            messageId: `<${randomUUID()}@ea-seed.test>`,
            createdAt: created,
            delegationId: randomUUID(),
            ...extra,
          });

        // Two delegations whose drafts the committer creates; one send is rejected by the server.
        const first = await mail({ draftStatus: "ready", sendStatus: "awaiting_approval" });
        const second = await mail({ draftStatus: "ready", sendStatus: "awaiting_approval" });
        // A third send waits for a tap for 49 h: the expiry job closes it.
        const stale = await mail({
          sendStatus: "awaiting_approval",
          notifiedAt: new Date(T0.getTime() - 49 * HOUR_MS),
          requestSent: true,
          draftProviderResult: { uid: 3, folder: "Drafts" },
        });
        // A delegation that was sent and is overdue: the chaser plans a reminder.
        const sent = await mail({
          sendStatus: "applied",
          approved: { userId, at: new Date(T0.getTime() - 5 * DAY_MS) },
          delegationId: undefined,
        });
        await insertDelegation(trx, ctx, {
          mailboxId,
          emailId: sent.emailId,
          delegateId,
          draftActionId: sent.draftId,
          sendActionId: sent.sendId,
          status: "sent",
          taskSummary: MARKERS.task,
          dueAt: new Date("2026-11-09T16:00:00Z"),
        });

        const fake = createFakeMailProvider();
        const smtp = createFakeMailSender();
        // The server refuses the second send.
        let sends = 0;
        const sender = {
          send: async (input: Parameters<typeof smtp.send>[0]) => {
            sends += 1;
            if (sends === 2)
              smtp.failNext(
                new SmtpSendError("envelope", "EENVELOPE", 550, true, false, { cause: new Error(MARKERS.reply) })
              );
            return smtp.send(input);
          },
          close: () => smtp.close(),
        };
        let clock = T0;
        const hooks = delegationHooks({ db });
        const committer = createCommitterJob({
          db: trx,
          secrets,
          openProvider: async () => fake,
          openSender: async () => sender,
          compose: composeMessage,
          hooks,
          scope: { kind: "synthetic", testMail: NO_TEST_SENDERS },
          sendScope: { kind: "self", addresses: [MARKERS.delegate] },
          now: () => clock,
        });
        const advance = (minutes: number) => {
          clock = new Date(clock.getTime() + minutes * MINUTE_MS);
        };
        const notices = async () => {
          await markSynced(trx, ctx, mailboxId, new Date(clock.getTime() - MINUTE_MS));
          await trx
            .updateTable("mailboxes")
            .set({ status_changed_at: new Date(T0.getTime() - DAY_MS) })
            .where("id", "=", mailboxId)
            .execute();
          await detectNotices({
            db: trx,
            now: () => clock,
            startedAt: new Date(T0.getTime() - DAY_MS),
            testMail: NO_TEST_SENDERS,
          });
        };
        // `except`: the fixture inserts a `sent` request row for the stale send; the notifier did not queue it.
        const outboxIds = async (kind: string, except = "") =>
          (
            await trx
              .selectFrom("outbox")
              .select("id")
              .where("org_id", "=", orgId)
              .where("kind", "=", kind)
              .where("status", "<>", except)
              .execute()
          ).map((row) => row.id);

        // The drafts, then the approval requests.
        await committer.run();
        advance(1);
        await notices();
        const approvals = await outboxIds("approval", "sent");
        expect(approvals.length).toBeGreaterThanOrEqual(2);

        // The taps.
        const link: LinkedChat = {
          orgId,
          userId,
          role: "owner",
          chatId: 1,
          linkedAt: new Date(T0.getTime() - HOUR_MS),
          locale: "en",
        };
        const tapDeps: CallbackDeps = {
          db: trx,
          now: () => clock,
          actionsScope: { kind: "synthetic", testMail: NO_TEST_SENDERS },
          hooks,
          uidplus: async () => true,
          sendScope: { kind: "self", addresses: [MARKERS.delegate] },
        };
        for (const pair of [first, second]) {
          const tap = await handleCallback(tapDeps, link, `ap:${pair.sendId}`);
          expect(tap.answer).toContain("Sending within a minute");
        }

        // The sends: one goes out, one is refused.
        advance(1);
        await committer.run();
        const sendRows = await trx
          .selectFrom("actions")
          .select(["id", "status", "status_reason"])
          .where("id", "in", [first.sendId, second.sendId])
          .execute();
        const appliedSend = sendRows.find((row) => row.status === "applied");
        const rejectedSend = sendRows.find((row) => row.status === "failed");
        expect(appliedSend).toBeDefined();
        expect(rejectedSend).toMatchObject({ status_reason: "smtp_rejected" });

        advance(1);
        await notices();
        const results = await outboxIds("send_result");
        expect(results.length).toBeGreaterThanOrEqual(2);

        // The expiry job closes the stale request; the chaser plans a reminder.
        advance(1);
        await createExpiryJob({ db: trx, now: () => clock, hooks, uidplus: async () => true }).run();
        const staleRow = await trx
          .selectFrom("actions")
          .select("status")
          .where("id", "=", stale.sendId)
          .executeTakeFirstOrThrow();
        expect(staleRow.status).toBe("expired");
        await createLoopChaserJob({ db: trx, now: () => clock }).run();
        await notices();

        const lines = capture.lines;
        const planted = [...Object.values(MARKERS), "@x.test", "MARKER", "queued as FAKE", String(secret.ciphertext)];
        expect(logProblems(lines, planted)).toEqual([]);
        // `saveTriage` writes its release line only when a setting changes during a run: none does here.
        expect(eventLines(lines, "triage_released_settings_changed")).toEqual([]);

        const has = (event: string, fields: Record<string, unknown>) =>
          expect(eventLines(lines, event)).toContainEqual(expect.objectContaining(fields));
        for (const pair of [first, second])
          has("action_applied", { action_id: pair.draftId, action_type: "create_draft" });
        has("action_applied", { action_id: appliedSend?.id, action_type: "send" });
        has("send_failed", { action_id: rejectedSend?.id, reason: "smtp_rejected", send_stage: "envelope", code: 550 });
        for (const id of approvals) has("notice_queued", { kind: "approval", outbox_id: id });
        for (const id of results) has("notice_queued", { kind: "send_result", outbox_id: id });
        const ids = { org_id: orgId, mailbox_id: mailboxId };
        has("expiry_done", {
          ...ids,
          count: 1,
          expired_timeout: 1,
          expired_draft_missing: 0,
          expired_not_notified: 0,
          expired_not_seen: 0,
          expired_held_timeout: 0,
        });
        // Two committer runs sent: the first (drafts) applies two drafts, the second applies one send and refuses one.
        has("committer_done", { ...ids, applied: 1, failed: 1, retry: 0, closed: 0, sent: 1 });
        has("chaser_done", { mailbox_id: mailboxId, due: 1, overdue: 1, reminders: 1 });
      });
    } finally {
      capture.stop();
    }
  });
});
