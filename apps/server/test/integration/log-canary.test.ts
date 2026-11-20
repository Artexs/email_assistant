import { randomBytes, randomUUID } from "node:crypto";

import { parseToolSwitches } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { createCommitterJob, createPlanned, noDelegationHooks } from "../../src/modules/actions";
import { createTelegramRuntime, handleCallback, type CallbackDeps, type LinkedChat } from "../../src/modules/channels";
import { getMailboxSettings, insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";
import { delegationHooks } from "../../src/modules/delegation";
import {
  composeMessage,
  INBOX,
  MailAuthError,
  NO_TEST_SENDERS,
  SmtpSendError,
  type ImapConnectOptions,
} from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender } from "../../src/modules/mail/fake/sender";
import { createMailSyncJob } from "../../src/modules/mail/jobs";
import { insertCredentials, markSynced } from "../../src/modules/mail/repo";
import { activityRoutes } from "../../src/modules/reports";
import { setDigestTimes, tenancyRoutes } from "../../src/modules/tenancy";
import { createLlmPause, createTriageJob, noGateEvidence } from "../../src/modules/triage";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";
import { SoftError } from "../../src/platform/errors";
import type { GenerateFn } from "../../src/platform/llm";
import { createFixedLlmClient } from "../../src/platform/llm/testing";
import { installConsoleGuard } from "../../src/platform/log";
import { runJobTick } from "../../src/platform/scheduler";
import { approvalsWaiting, countMailboxes, onboardingDeps } from "../../src/web";
import { captureLogs, eventLines, logProblems } from "../log-capture";

import {
  createOrgWithMailbox,
  insertDelegate,
  insertTriaged,
  isolateChannels,
  linkChat,
  pauseOtherMailboxes,
  randomChatId,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { testBotInfo, type RecordedCall } from "./telegram-helpers";
import { as, noBackupCodes, webTestApp } from "./web-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const MINUTE = 60_000;
const HOUR = 3_600_000;
const NOW = new Date("2026-11-20T10:00:00Z");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

// Every planted value holds CANARY, so that a leak is easy to find. The run suffix keeps a parallel run apart.
const run = randomUUID().slice(0, 8);
const CANARY = {
  senderAddress: `canary-from-${run}@x.test`,
  senderName: `CANARY-NAME-${run}`,
  mailboxAddress: `canary-box-${run}@x.test`,
  subject: `CANARY-SUBJECT-${run}`,
  body: `CANARY-BODY-${run}`,
  summary: `CANARY-SUMMARY-${run}`,
  reason: `CANARY-REASON-${run}`,
  task: `CANARY-TASK-${run}`,
  imapError: `CANARY-IMAP-${run} canary-from-${run}@x.test`,
  // A text-like error code. No driven path carries it: `errorFields` passes a code-shaped string code on as
  // `error_code`, so a real error with this code would fail the canary (a known limit, see the capability page).
  imapCode: `CANARY-CODE-${run}`,
  messageIdLocal: `canary-${run}`,
  smtpReply: `550 CANARY-SMTP-${run}`,
  telegramDescription: `Bad Request: CANARY-TG-${run}`,
  llmErrorBody: `CANARY-LLMERR-${run}`,
  delegateAddress: `canary-delegate-${run}@x.test`,
  // A bot token and a link token of the Telegram runtime.
  botToken: `424242:CANARYTOKEN${run}aaaaaaaaaaaaaaaaaaaa`,
};
const planted = [
  ...Object.values(CANARY),
  CANARY.botToken.split(":")[1] ?? "",
  "CANARY",
  `canary-from-${run}`,
  `canary-box-${run}`,
  `canary-delegate-${run}`,
];

// A fake Bot API on a local port. `failOnce` makes the next sendMessage answer a 400 with the planted description.
function startFakeBotApi() {
  const calls: RecordedCall[] = [];
  let messageId = 500;
  let failOnce = false;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const method = new URL(request.url).pathname.split("/").pop() ?? "";
      const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      calls.push({ method, payload });
      if (method === "sendMessage" || method === "editMessageText") {
        if (method === "sendMessage" && failOnce) {
          failOnce = false;
          return Response.json(
            { ok: false, error_code: 400, description: CANARY.telegramDescription },
            { status: 400 }
          );
        }
        messageId += 1;
        return Response.json({
          ok: true,
          result: {
            message_id: messageId,
            date: 0,
            chat: { id: payload.chat_id, type: "private", first_name: "Test" },
            text: payload.text,
          },
        });
      }
      return Response.json({ ok: true, result: true });
    },
  });
  return {
    apiRoot: `http://127.0.0.1:${server.port}`,
    calls,
    count: (method: string) => calls.filter((call) => call.method === method).length,
    failOnce: () => {
      failOnce = true;
    },
    stop: () => server.stop(true),
  };
}

const classifierAnswer = (delegateId: string): string =>
  JSON.stringify({
    category: "delegation",
    confidence: 0.9,
    reason_code: "direct_request",
    reason: CANARY.reason,
    summary: CANARY.summary,
    fields: {
      due_date: "2026-11-25",
      language: "pl",
      delegate_id: delegateId,
      task: CANARY.task,
      clarification: null,
    },
  });

describe("log canary", () => {
  test("no planted mail string reaches a log line from sync to digest", async () => {
    const capture = captureLogs();
    const bot = startFakeBotApi();
    let restoreConsole: (() => void) | undefined;
    try {
      await withRollback(db, async (trx: Transaction<DB>) => {
        await isolateChannels(trx);
        await pauseOtherMailboxes(trx);
        const { orgId, userId, mailboxId } = await createOrgWithMailbox(trx, { address: CANARY.mailboxAddress });
        const ctx = { orgId };
        const secret = secrets.encrypt("pw", `mailbox:${mailboxId}`);
        await insertCredentials(trx, ctx, {
          mailboxId,
          encryptedSecret: secret.ciphertext,
          secretKind: "password",
          keyVersion: secret.keyVersion,
        });
        const chatId = randomChatId();
        await linkChat(trx, ctx, userId, chatId, new Date(NOW.getTime() - 24 * HOUR));
        await insertDefaultSettings(trx, ctx, mailboxId);
        const settings = await getMailboxSettings(trx, ctx, mailboxId);
        await updateMailboxSettings(trx, ctx, mailboxId, {
          mode: "assist",
          toolSwitches: { ...parseToolSwitches(settings?.tool_switches), create_draft: true },
        });
        await setDigestTimes(trx, ctx, userId, ["08:00"]);
        const delegateId = await insertDelegate(trx, ctx, {
          name: CANARY.senderName,
          email: CANARY.delegateAddress,
        });

        let clock = NOW;
        const advance = (ms: number) => {
          clock = new Date(clock.getTime() + ms);
        };

        // 1. Sync: one INBOX mail with the planted sender, name, subject and body.
        const mailFake = createFakeMailProvider({ uidValidity: 7 });
        mailFake.deliver(
          INBOX,
          {
            messageId: `<${CANARY.messageIdLocal}@ea-seed.test>`,
            from: `${CANARY.senderName} <${CANARY.senderAddress}>`,
            to: [CANARY.mailboxAddress],
            subject: CANARY.subject,
            date: new Date(NOW.getTime() - HOUR),
            text: CANARY.body,
          },
          { internalDate: new Date(NOW.getTime() - HOUR) }
        );
        let mode: "ok" | "soft" | "hard" | "auth" = "ok";
        const openProvider = async (_opts: ImapConnectOptions): Promise<FakeMailProvider> => {
          if (mode === "auth") throw new MailAuthError(CANARY.imapError);
          if (mode === "hard") throw new Error(CANARY.imapError);
          if (mode === "soft") {
            const broken = createFakeMailProvider({ uidValidity: 7 });
            broken.failOn("folderStatus", new SoftError(CANARY.imapError));
            return broken;
          }
          return mailFake;
        };
        const syncJob = createMailSyncJob({
          db: trx,
          secrets,
          openProvider,
          isOwnActionId: async () => false,
          sentOriginOf: async () => null,
          now: () => NOW,
        });
        await runJobTick("mail.sync", () => syncJob.run());

        // The planted text did reach the stored row: the test is not vacuous.
        const stored = await trx
          .selectFrom("emails")
          .select(["subject", "from_address"])
          .where("mailbox_id", "=", mailboxId)
          .executeTakeFirstOrThrow();
        expect(stored.subject).toBe(CANARY.subject);
        expect(stored.from_address).toContain(CANARY.senderAddress);
        expect(stored.from_address).toContain(CANARY.senderName);

        // 2. Sync errors: a soft error, a plain error and a login error, each with the planted text.
        mode = "soft";
        await runJobTick("mail.sync", () => syncJob.run());
        mode = "hard";
        await runJobTick("mail.sync", () => syncJob.run());
        mode = "auth";
        await runJobTick("mail.sync", () => syncJob.run());
        mode = "ok";
        // The login error set the status auth_error: the next steps need it active.
        await trx.updateTable("mailboxes").set({ status: "active" }).where("id", "=", mailboxId).execute();

        // 3. Triage: a hard LLM error with the planted body, then a delegation answer.
        const config400 = Object.assign(new Error("config"), {
          status: 400,
          message: JSON.stringify({
            error: {
              status: "INVALID_ARGUMENT",
              message: CANARY.llmErrorBody,
              details: [{ reason: "API_KEY_INVALID" }],
            },
          }),
        });
        const steps: (() => ReturnType<GenerateFn>)[] = [
          () => Promise.reject(Object.assign(new Error(CANARY.llmErrorBody), { status: 503 })),
          () => Promise.reject(config400),
          () => Promise.resolve({ text: classifierAnswer(delegateId), tokensIn: 10, tokensOut: 5, blocked: false }),
        ];
        let calls = 0;
        const generate: GenerateFn = () => {
          const step = steps[calls];
          calls += 1;
          if (step === undefined) throw new Error("unexpected extra LLM call");
          return step();
        };
        const triage = createTriageJob({
          runningKey: noGateEvidence.runningKey,
          db: trx,
          llm: createFixedLlmClient(generate, {
            // The 400 of this test is the Gemini form of a bad key, so the row must be the Gemini one.
            provider: "gemini",
            model: "fake-model",
            apiKey: CANARY.botToken,
            timeoutMs: 1000,
            rpm: 1000,
            sleep: async () => undefined,
          }),
          pause: createLlmPause(),
          scope: { kind: "all" },
          batchSize: 5,
          testMail: NO_TEST_SENDERS,
          dailyCap: 1000,
          junkDailyCap: 1000,
          now: () => clock,
        });
        for (let tick = 0; tick < 8 && calls < steps.length; tick += 1) {
          await runJobTick("triage.worker", () => triage.run());
          advance(70 * MINUTE);
        }
        expect(calls).toBe(3);
        const mail = await trx
          .selectFrom("emails")
          .select(["id", "status"])
          .where("mailbox_id", "=", mailboxId)
          .executeTakeFirstOrThrow();
        expect(mail.status).toBe("triaged");
        const actions = await trx
          .selectFrom("actions")
          .select(["id", "type", "status"])
          .where("email_id", "=", mail.id)
          .execute();
        const sendAction = actions.find((action) => action.type === "send");
        expect(sendAction).toBeDefined();

        // 4. Committer and send: the first send fails soft with the planted SMTP reply, the second goes out.
        const fakeSmtp = createFakeMailSender();
        let sends = 0;
        const sender = {
          send: async (input: Parameters<typeof fakeSmtp.send>[0]) => {
            sends += 1;
            if (sends === 1)
              fakeSmtp.failNext(
                new SmtpSendError("connect", "ECONNECTION", null, false, true, {
                  cause: new Error(CANARY.smtpReply),
                })
              );
            return fakeSmtp.send(input);
          },
          // The committer closes its sender after each run; the second run needs the same fake open.
          close: async () => undefined,
        };
        const hooks = delegationHooks({ db: trx });
        const committer = createCommitterJob({
          db: trx,
          secrets,
          openProvider: async () => mailFake,
          openSender: async () => sender,
          compose: composeMessage,
          hooks,
          scope: { kind: "all" },
          sendScope: { kind: "self", addresses: [CANARY.delegateAddress] },
          now: () => clock,
        });
        const runtime = createTelegramRuntime({
          db: trx,
          token: CANARY.botToken,
          now: () => clock,
          startedAt: new Date(NOW.getTime() - 24 * HOUR),
          llmDailyCap: 300,
          triageScope: "all",
          actionsScope: { kind: "all" },
          llm: { provider: "gemini", classifierModel: "gemini-3.5-flash-lite" },
          hooks: noDelegationHooks,
          uidplus: async () => true,
          sendScope: { kind: "self", addresses: [CANARY.delegateAddress] },
          testMail: NO_TEST_SENDERS,
          operatorContact: null,
          syncEveryMin: 2,
          apiRoot: bot.apiRoot,
          botInfo: testBotInfo,
        });
        try {
          await runJobTick("actions.committer", () => committer.run());
          advance(MINUTE);
          await markSynced(trx, ctx, mailboxId, new Date(clock.getTime() - MINUTE));

          // 5. Notices: the first Telegram send answers 400 with the planted description.
          bot.failOnce();
          await runJobTick("channels.notify", () => runtime.notify());
          // A 400 is final for that notice: it is marked failed and never sent again.
          expect(bot.count("sendMessage")).toBe(1);

          // The tap that approves the send.
          const link: LinkedChat = {
            orgId,
            userId,
            role: "owner",
            chatId,
            linkedAt: new Date(NOW.getTime() - 24 * HOUR),
            locale: "en",
          };
          const tapDeps: CallbackDeps = {
            db: trx,
            now: () => clock,
            actionsScope: { kind: "all" },
            hooks,
            uidplus: async () => true,
            sendScope: { kind: "self", addresses: [CANARY.delegateAddress] },
          };
          const tap = await handleCallback(tapDeps, link, `ap:${sendAction?.id}`);
          expect(tap.answer).toContain("Sending within a minute");

          advance(MINUTE);
          await runJobTick("actions.committer", () => committer.run());
          advance(30 * MINUTE);
          await runJobTick("actions.committer", () => committer.run());
          const sendRow = await trx
            .selectFrom("actions")
            .select("status")
            .where("id", "=", sendAction?.id ?? "")
            .executeTakeFirstOrThrow();
          expect(sendRow.status).toBe("applied");
          expect(fakeSmtp.sent).toHaveLength(1);

          await markSynced(trx, ctx, mailboxId, new Date(clock.getTime() - MINUTE));
          await runJobTick("channels.notify", () => runtime.notify());

          // Two triaged mails with planted text reach the digest: an urgent one and an info one with a summary.
          for (const category of ["urgent", "info"] as const) {
            const digestMailId = await insertTriaged(trx, ctx, mailboxId, {
              category,
              createdAt: new Date(NOW.getTime() + 6 * HOUR),
              reason: CANARY.reason,
              subject: CANARY.subject,
              from: CANARY.senderAddress,
            });
            if (category === "info")
              await createPlanned(trx, ctx, digestMailId, [
                {
                  type: "save_summary",
                  payload: { summary: CANARY.summary },
                  status: "logged",
                  idempotencyKey: `summary-${digestMailId}`,
                },
              ]);
          }
          // A digest for the linked member: 08:00 local on the next day.
          clock = new Date("2026-11-21T07:00:00Z");
          await markSynced(trx, ctx, mailboxId, new Date(clock.getTime() - MINUTE));
          await runJobTick("channels.digest", () => runtime.scheduleDigests());
          await runJobTick("channels.notify", () => runtime.notify());
          expect(bot.count("sendMessage")).toBeGreaterThanOrEqual(3);
          // The digest text holds the planted subject and summary: the test is not vacuous for this path.
          const sentTexts = bot.calls
            .filter((call) => call.method === "sendMessage")
            .map((call) => String(call.payload.text));
          expect(sentTexts.some((text) => text.includes(CANARY.subject))).toBe(true);
          expect(sentTexts.some((text) => text.includes(CANARY.summary))).toBe(true);
        } finally {
          await runtime.stop();
        }

        // 6. Console: a library prints a server error through console.error. The capture spies are the sink.
        restoreConsole = installConsoleGuard();
        // eslint-disable-next-line no-console -- the test plays a library that prints.
        console.error(`# SERVER_ERROR: ${CANARY.imapError}`);
        restoreConsole();
        restoreConsole = undefined;

        // 7. Web: two requests of the member through the real app, over the same transaction.
        const noScope = { kind: "off", reason: "env_off" } as const;
        const app = webTestApp({
          db: trx,
          sessions: { "canary-member": userId },
          routers: (api) => {
            api.route(
              "/",
              tenancyRoutes({
                db: trx,
                now: () => clock,
                scopes: { triage: noScope, actions: noScope, send: noScope },
                countMailboxes: countMailboxes(trx),
                approvalsWaiting: approvalsWaiting(trx),
                operatorContact: null,
                sessions: async () => [],
                backupCodesLeft: noBackupCodes,
                ...onboardingDeps(trx, async () => "fake_ea_bot"),
              })
            );
            api.route("/", activityRoutes({ db: trx, now: () => clock }));
          },
        });
        const me = await app.request("/api/me", as("canary-member"));
        expect(me.status).toBe(200);
        const activity = await app.request("/api/activity", as("canary-member"));
        expect(activity.status).toBe(200);
        // The route does return the planted mail text: the log, not the response, must stay clean.
        expect(JSON.stringify(await activity.json())).toContain(CANARY.subject);
      });

      // The console guard writes `console_output` with `dropped_fields: 1` by design: check those lines for the
      // planted values alone, and every other line in full.
      const lines = capture.lines;
      const guardLines = lines.filter((line) => line.includes('"event":"console_output"'));
      const otherLines = lines.filter((line) => !guardLines.includes(line));
      expect(logProblems(otherLines, planted)).toEqual([]);
      expect(logProblems(guardLines, planted).filter((problem) => !problem.endsWith("has dropped_fields"))).toEqual([]);

      // The steps ran: each event name appears at least once.
      const events = new Set(lines.flatMap((line) => (JSON.parse(line) as { event: string }).event));
      for (const event of [
        "sync_done",
        "sync_soft_error",
        "sync_failed",
        "outbox_refused",
        "sync_auth_error",
        "triage_done",
        "send_retry",
        "committer_done",
        "outbox_sent",
        "digest_queued",
        "console_output",
      ]) {
        expect(events).toContain(event);
      }
      expect(lines.some((line) => UUID.test((JSON.parse(line) as { run_id?: string }).run_id ?? ""))).toBe(true);
      expect(lines.some((line) => UUID.test((JSON.parse(line) as { request_id?: string }).request_id ?? ""))).toBe(
        true
      );
      expect(eventLines(lines, "console_output")).toHaveLength(1);
    } finally {
      restoreConsole?.();
      bot.stop();
      capture.stop();
    }
  }, 60_000);
});
