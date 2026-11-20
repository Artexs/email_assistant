import { MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Update } from "grammy/types";

import { noDelegationHooks } from "../../src/modules/actions";
import { createLinkToken, createTelegramRuntime } from "../../src/modules/channels";
import { insertDefaultSettings } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { markSynced } from "../../src/modules/mail/repo";
import { setDigestTimes, setOrgFeature } from "../../src/modules/tenancy";

import { createOrgWithMailbox, insertTriagedWithActions, isolateChannels } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { messageUpdate, testBotInfo, type RecordedCall } from "./telegram-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// The Telegram runtime hands WEB_BASE_URL to the /digest command, so its spam review line links to the panel.
const T0 = new Date("2026-11-06T10:00:00Z");
const CHAT_ID = 987654321012;
const TOKEN = "123456:SPAMREVIEWTOKENaaaaaaaaaaaaaaaaaaaaaaaa";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// A fake Bot API: it records every call and answers getUpdates with the queued updates.
function startFakeBotApi() {
  const calls: RecordedCall[] = [];
  const queue: Update[] = [];
  let messageId = 500;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const method = new URL(request.url).pathname.split("/").pop() ?? "";
      const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      calls.push({ method, payload });
      const ok = (result: unknown) => Response.json({ ok: true, result });
      if (method === "getUpdates") {
        const offset = typeof payload.offset === "number" ? payload.offset : 0;
        const found = queue.filter((update) => update.update_id >= offset);
        if (found.length > 0) return ok(found);
        await sleep(100);
        return ok([]);
      }
      if (method === "sendMessage") {
        messageId += 1;
        return ok({
          message_id: messageId,
          date: 0,
          chat: { id: payload.chat_id, type: "private", first_name: "Test" },
          text: payload.text,
        });
      }
      return ok(true);
    },
  });
  return {
    apiRoot: `http://127.0.0.1:${server.port}`,
    texts: () => calls.filter((call) => call.method === "sendMessage").map((call) => String(call.payload.text)),
    push: (update: Update) => void queue.push(update),
    stop: () => server.stop(true),
  };
}

async function waitForTexts(read: () => string[], count: number): Promise<string[]> {
  for (let i = 0; i < 100; i += 1) {
    if (read().length >= count) return read();
    await sleep(50);
  }
  throw new Error("timeout: the replies of the bot");
}

async function digestReply(webBaseUrl: string | undefined): Promise<string> {
  const fake = startFakeBotApi();
  try {
    let reply = "";
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const { orgId, userId, mailboxId } = await createOrgWithMailbox(trx);
      const ctx = { orgId };
      await insertDefaultSettings(trx, ctx, mailboxId);
      await trx.updateTable("mailbox_settings").set({ mode: "assist" }).where("mailbox_id", "=", mailboxId).execute();
      await setOrgFeature(trx, ctx, { flag: "spam_review_line", enabled: true, actor: "cli", now: T0 });
      await markSynced(trx, ctx, mailboxId, new Date(T0.getTime() - 5 * MINUTE_MS));
      await setDigestTimes(trx, ctx, userId, ["08:00"]);
      const { token } = await createLinkToken(trx, ctx, userId, T0);
      await insertTriagedWithActions(trx, ctx, mailboxId, {
        category: "spam",
        createdAt: new Date(T0.getTime() + MINUTE_MS),
        actions: [{ type: "move", status: "applied", payload: { folder: "ai_spam" } }],
      });
      let clock = T0;
      const runtime = createTelegramRuntime({
        db: trx,
        token: TOKEN,
        now: () => clock,
        startedAt: new Date(T0.getTime() - HOUR_MS),
        llmDailyCap: 300,
        triageScope: "synthetic",
        actionsScope: { kind: "off" },
        llm: { provider: "gemini", classifierModel: "gemini-3.5-flash-lite" },
        hooks: noDelegationHooks,
        uidplus: async () => true,
        sendScope: { kind: "off" },
        testMail: NO_TEST_SENDERS,
        operatorContact: null,
        syncEveryMin: 2,
        apiRoot: fake.apiRoot,
        botInfo: testBotInfo,
        ...(webBaseUrl === undefined ? {} : { webBaseUrl }),
      });
      runtime.startPolling();
      try {
        fake.push(messageUpdate({ updateId: 1, chatId: CHAT_ID, text: `/start ${token}` }));
        await waitForTexts(fake.texts, 1);
        clock = new Date(T0.getTime() + 2 * MINUTE_MS);
        fake.push(messageUpdate({ updateId: 2, chatId: CHAT_ID, text: "/digest" }));
        reply = (await waitForTexts(fake.texts, 2))[1] ?? "";
      } finally {
        await runtime.stop();
      }
    });
    return reply;
  } finally {
    fake.stop();
  }
}

describe("telegram /digest spam review line (F110 stage 17)", () => {
  test("with WEB_BASE_URL the line links to the Activity list; without it the line names the panel", async () => {
    expect(await digestReply("https://panel.test")).toContain(
      "🗑 1 went to spam · review: https://panel.test/activity?category=spam"
    );
    expect(await digestReply(undefined)).toContain("🗑 1 went to spam · check them in the panel");
  });
});
