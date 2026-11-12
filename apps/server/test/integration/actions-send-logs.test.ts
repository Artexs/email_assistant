import { randomBytes, randomUUID } from "node:crypto";

import { parseToolSwitches } from "@ea/core";
import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";

import { createCommitterJob, createExpiryJob } from "../../src/modules/actions";
import { detectNotices, handleCallback, type CallbackDeps, type LinkedChat } from "../../src/modules/channels";
import { getMailboxSettings, insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";
import { createChaserJob, delegationHooks } from "../../src/modules/delegation";
import { composeMessage, SmtpSendError } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender } from "../../src/modules/mail/fake/sender";
import { insertCredentials, markSynced } from "../../src/modules/mail/repo";
import { createSecretBox } from "../../src/platform/crypto";
import { setLogLevel } from "../../src/platform/log";

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

afterEach(() => {
  setLogLevel("info");
});

const MINUTE = 60_000;
const HOUR = 3_600_000;
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
};

describe("send logs", () => {
  test("no S4 log line holds a recipient, a subject, a task, a draft text or an SMTP reply; the expected lines appear", async () => {
    const logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    setLogLevel("debug");
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
        await linkChat(trx, ctx, userId, randomChatId(), new Date(T0.getTime() - 24 * HOUR));
        await insertDefaultSettings(trx, ctx, mailboxId);
        const settings = await getMailboxSettings(trx, ctx, mailboxId);
        await updateMailboxSettings(trx, ctx, mailboxId, {
          mode: "assist",
          toolSwitches: { ...parseToolSwitches(settings?.tool_switches), create_draft: true },
        });

        const delegateId = await insertDelegate(trx, ctx, { name: MARKERS.name, email: MARKERS.delegate });
        const created = new Date(T0.getTime() - HOUR);
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
          notifiedAt: new Date(T0.getTime() - 49 * HOUR),
          requestSent: true,
          draftProviderResult: { uid: 3, folder: "Drafts" },
        });
        // A delegation that was sent and is overdue: the chaser plans a reminder.
        const sent = await mail({
          sendStatus: "applied",
          approved: { userId, at: new Date(T0.getTime() - 5 * 24 * HOUR) },
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
            if (sends === 2) smtp.failNext(new SmtpSendError("envelope", "EENVELOPE", 550, true, false));
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
          scope: { kind: "synthetic" },
          sendScope: { kind: "self", addresses: [MARKERS.delegate] },
          now: () => clock,
        });
        const advance = (minutes: number) => {
          clock = new Date(clock.getTime() + minutes * MINUTE);
        };
        const notices = async () => {
          await markSynced(trx, ctx, mailboxId, new Date(clock.getTime() - MINUTE));
          await trx
            .updateTable("mailboxes")
            .set({ status_changed_at: new Date(T0.getTime() - 24 * HOUR) })
            .where("id", "=", mailboxId)
            .execute();
          await detectNotices({ db: trx, now: () => clock, startedAt: new Date(T0.getTime() - 24 * HOUR) });
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
        const link: LinkedChat = { orgId, userId, role: "owner", chatId: 1, linkedAt: new Date(T0.getTime() - HOUR) };
        const tapDeps: CallbackDeps = {
          db: trx,
          now: () => clock,
          actionsScope: { kind: "synthetic" },
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
        await createChaserJob({ db: trx, now: () => clock }).run();
        await notices();

        const output = [...logSpy.mock.calls, ...errorSpy.mock.calls]
          .map((call: unknown[]) => call.map(String).join(" "))
          .join("\n");

        for (const marker of [
          ...Object.values(MARKERS),
          "@x.test",
          "MARKER",
          "queued as FAKE",
          String(secret.ciphertext),
        ]) {
          expect(output).not.toContain(marker);
        }
        // `saveTriage` writes its release line only when a setting changes during a run: none does here.
        expect(output).not.toContain("settings changed, mail released");

        for (const pair of [first, second]) expect(output).toContain(`action ${pair.draftId}: applied create_draft`);
        expect(output).toContain(`action ${appliedSend?.id}: applied send`);
        expect(output).toContain(`action ${rejectedSend?.id}: failed smtp_rejected (stage envelope, code 550)`);
        for (const id of approvals) expect(output).toContain(`notice approval queued: outbox ${id}`);
        for (const id of results) expect(output).toContain(`notice send_result queued: outbox ${id}`);
        expect(output).toContain(
          `expiry ${mailboxId}: expired 1 (timeout 1, draft_missing 0, not_notified 0, not_seen 0, held_timeout 0)`
        );
        expect(output).toContain(`chaser ${mailboxId}: due 1, overdue 1, reminders 1`);
      });
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
