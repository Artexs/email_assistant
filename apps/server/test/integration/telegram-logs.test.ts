import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import type { Update } from "grammy/types";

import { createPlanned, noDelegationHooks } from "../../src/modules/actions";
import { createLinkToken, createTelegramRuntime } from "../../src/modules/channels";
import { markSynced } from "../../src/modules/mail/repo";
import { setDigestTimes } from "../../src/modules/tenancy";
import { setLogLevel } from "../../src/platform/log";

import { createOrgWithMailbox, insertTriaged, isolateChannels } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { callbackUpdate, messageUpdate, testBotInfo, type RecordedCall } from "./telegram-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

afterEach(() => {
  setLogLevel("info");
});

const T0 = new Date("2026-11-06T10:00:00Z");
const MINUTE = 60_000;
const HOUR = 3_600_000;

const at = (offsetMs: number): Date => new Date(T0.getTime() + offsetMs);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const MARKERS = {
  token: "123456:MARKERTOKENaaaaaaaaaaaaaaaaaaaaaaaaaa",
  subject: "MARKER-SUBJECT",
  from: "marker-from@x.test",
  reason: "MARKER-REASON",
  summary: "MARKER-SUMMARY",
  chatId: "987654321012",
};
const CHAT_ID = Number(MARKERS.chatId);

// A fake Bot API. It records every call and answers getUpdates with the queued updates.
function startFakeBotApi() {
  const calls: RecordedCall[] = [];
  const queue: Update[] = [];
  let messageId = 500;
  let failNextSend = false;

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const method = new URL(request.url).pathname.split("/").pop() ?? "";
      const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      calls.push({ method, payload });
      const ok = (result: unknown) => Response.json({ ok: true, result });
      switch (method) {
        case "getUpdates": {
          const offset = typeof payload.offset === "number" ? payload.offset : 0;
          const found = queue.filter((update) => update.update_id >= offset);
          if (found.length > 0) return ok(found);
          await sleep(100);
          return ok([]);
        }
        case "sendMessage":
        case "editMessageText": {
          if (method === "sendMessage" && failNextSend) {
            failNextSend = false;
            return Response.json(
              { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" },
              { status: 403 }
            );
          }
          messageId += 1;
          return ok({
            message_id: messageId,
            date: 0,
            chat: { id: payload.chat_id, type: "private", first_name: "Test" },
            text: payload.text,
          });
        }
        default:
          return ok(true);
      }
    },
  });

  return {
    apiRoot: `http://127.0.0.1:${server.port}`,
    calls,
    count: (method: string) => calls.filter((call) => call.method === method).length,
    push: (update: Update) => void queue.push(update),
    failNextSend: () => {
      failNextSend = true;
    },
    stop: () => server.stop(true),
  };
}

async function waitFor(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (condition()) return;
    await sleep(50);
  }
  throw new Error(`timeout: ${what}`);
}

describe("telegram logs", () => {
  test("no log line holds a token, a chat id, mail text or a summary", async () => {
    const logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    const fake = startFakeBotApi();
    setLogLevel("debug");
    let linkToken = "";
    let emailId = "";
    try {
      await withRollback(db, async (trx) => {
        await isolateChannels(trx);
        const { orgId, userId, mailboxId } = await createOrgWithMailbox(trx);
        const ctx = { orgId };
        await markSynced(trx, ctx, mailboxId, at(-5 * MINUTE));
        await setDigestTimes(trx, ctx, userId, ["08:00"]);
        linkToken = (await createLinkToken(trx, ctx, userId, T0)).token;

        let clock = T0;
        const runtime = createTelegramRuntime({
          db: trx,
          token: MARKERS.token,
          now: () => clock,
          startedAt: at(-HOUR),
          llmDailyCap: 300,
          triageScope: "synthetic",
          actionsScope: { kind: "off" },
          llm: { provider: "gemini", classifierModel: "gemini-3.5-flash-lite" },
          hooks: noDelegationHooks,
          uidplus: async () => true,
          sendScope: { kind: "off" },
          operatorContact: null,
          apiRoot: fake.apiRoot,
          botInfo: testBotInfo,
        });
        runtime.startPolling();
        try {
          fake.push(messageUpdate({ updateId: 1, chatId: CHAT_ID, text: `/start ${linkToken}` }));
          await waitFor(() => fake.count("sendMessage") >= 1, "the reply to /start");

          emailId = await insertTriaged(trx, ctx, mailboxId, {
            category: "urgent",
            createdAt: at(MINUTE),
            reason: MARKERS.reason,
            subject: MARKERS.subject,
            from: MARKERS.from,
          });
          const infoId = await insertTriaged(trx, ctx, mailboxId, {
            category: "info",
            createdAt: at(MINUTE),
            reason: MARKERS.reason,
            subject: MARKERS.subject,
            from: MARKERS.from,
          });
          await createPlanned(trx, ctx, infoId, [
            {
              type: "save_summary",
              payload: { summary: MARKERS.summary },
              status: "logged",
              idempotencyKey: `summary-${infoId}`,
            },
          ]);

          clock = at(2 * MINUTE);
          fake.push(messageUpdate({ updateId: 2, chatId: CHAT_ID, text: "/status" }));
          fake.push(messageUpdate({ updateId: 3, chatId: CHAT_ID, text: "/digest" }));
          await waitFor(() => fake.count("sendMessage") >= 3, "the replies to /status and /digest");
          await runtime.notify();
          expect(fake.count("sendMessage")).toBe(4);

          fake.push(callbackUpdate({ updateId: 4, chatId: CHAT_ID, data: `fr:u:${emailId}`, messageId: 77 }));
          await waitFor(() => fake.count("answerCallbackQuery") >= 1, "the answer to the tap");

          await insertTriaged(trx, ctx, mailboxId, {
            category: "urgent",
            createdAt: at(3 * MINUTE),
            reason: MARKERS.reason,
            subject: MARKERS.subject,
            from: MARKERS.from,
          });
          clock = at(4 * MINUTE);
          fake.failNextSend();
          await runtime.notify();

          // 08:00 local on the next day.
          clock = new Date("2026-11-07T07:00:00Z");
          await runtime.scheduleDigests();
          await runtime.notify();
        } finally {
          await runtime.stop();
        }

        const sentTexts = fake.calls
          .filter((call) => call.method === "sendMessage")
          .map((call) => String(call.payload.text));
        expect(sentTexts.filter((text) => text.includes(MARKERS.subject)).length).toBeGreaterThanOrEqual(2);
        const sentJoined = sentTexts.join("\n");
        for (const rendered of [MARKERS.subject, MARKERS.from, MARKERS.reason, MARKERS.summary]) {
          expect(sentJoined).toContain(rendered);
        }
        const feedback = await trx
          .selectFrom("triage_feedback")
          .select("source")
          .where("email_id", "=", emailId)
          .execute();
        expect(feedback.map((row) => row.source)).toEqual(["telegram"]);
        const outbox = await trx
          .selectFrom("outbox")
          .select(["kind", "status", "error_code"])
          .where("org_id", "=", orgId)
          .execute();
        expect(outbox.some((row) => row.status === "failed" && row.error_code === "blocked")).toBe(true);
        expect(outbox.some((row) => row.kind === "digest" && row.status === "sent")).toBe(true);
      });

      const output = [...logSpy.mock.calls, ...errorSpy.mock.calls]
        .map((call: unknown[]) => call.map(String).join(" "))
        .join("\n");
      expect(output).toContain("[telegram]");
      for (const marker of [
        MARKERS.token,
        MARKERS.token.split(":")[1] ?? "",
        MARKERS.subject,
        MARKERS.from,
        MARKERS.reason,
        MARKERS.summary,
        MARKERS.chatId,
        linkToken,
        `fr:u:${emailId}`,
      ]) {
        expect(marker).not.toBe("");
        expect(output).not.toContain(marker);
      }
    } finally {
      fake.stop();
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  }, 30_000);
});
