import { randomUUID } from "node:crypto";

import { MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { noDelegationHooks } from "../../src/modules/actions";
import { createTelegramRuntime, queueNotice } from "../../src/modules/channels";
import { insertDefaultSettings } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { markSynced } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";

import {
  createOrgWithMailbox,
  insertTestEmail,
  isolateChannels,
  linkChat,
  randomChatId,
  testNoticeView,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { testBotInfo } from "./telegram-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// The Telegram runtime hands WEB_BASE_URL to its sender, so a message at the minimal level ends with a link to the panel.
const T0 = new Date("2026-11-20T10:00:00Z");
const TOKEN = "123456:DETAILRUNTIMETOKENaaaaaaaaaaaaaaaaaaaaaaaa";
const CANARY = "CANARY-SUBJECT-5d2e";

// A fake Bot API: it records the text of every sendMessage.
function startFakeBotApi() {
  const texts: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const method = new URL(request.url).pathname.split("/").pop() ?? "";
      const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      if (method === "sendMessage") {
        texts.push(String(payload.text));
        return Response.json({
          ok: true,
          result: { message_id: 500 + texts.length, date: 0, chat: { id: payload.chat_id, type: "private" } },
        });
      }
      return Response.json({ ok: true, result: true });
    },
  });
  return { apiRoot: `http://127.0.0.1:${server.port}`, texts, stop: () => server.stop(true) };
}

async function sentTexts(webBaseUrl: string | undefined): Promise<string[]> {
  const fake = startFakeBotApi();
  try {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const { orgId, userId, mailboxId } = await createOrgWithMailbox(trx);
      const ctx = { orgId };
      await insertDefaultSettings(trx, ctx, mailboxId);
      await markSynced(trx, ctx, mailboxId, new Date(T0.getTime() - 5 * MINUTE_MS));
      await linkChat(trx, ctx, userId, randomChatId(), new Date(T0.getTime() - HOUR_MS));
      await setOrgFeature(trx, ctx, { flag: "telegram_minimal", enabled: true, actor: "cli", now: T0 });
      // A new member is `minimal`.
      const emailId = await insertTestEmail(trx, ctx, mailboxId);
      await queueNotice(trx, ctx, {
        userId,
        locale: "en",
        kind: "urgent",
        dedupKey: `urgent:${randomUUID()}`,
        emailId,
        mailboxId,
        view: testNoticeView("urgent", { marker: CANARY, emailId, at: T0 }) as never,
        eventAt: T0,
        now: T0,
      });
      const runtime = createTelegramRuntime({
        db: trx,
        token: TOKEN,
        now: () => T0,
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
      await runtime.notify();
    });
    return fake.texts;
  } finally {
    fake.stop();
  }
}

describe("the Telegram runtime and the detail level", () => {
  test("a minimal member gets the minimal text; with WEB_BASE_URL it ends with the link, without it with the panel line", async () => {
    const withBase = await sentTexts("https://panel.test");
    expect(withBase).toHaveLength(1);
    expect(withBase[0]).not.toContain(CANARY);
    expect(withBase[0]).toContain("https://panel.test/activity?category=urgent");
    const withoutBase = await sentTexts(undefined);
    expect(withoutBase).toHaveLength(1);
    expect(withoutBase[0]).toContain("Open the panel");
    expect(withoutBase[0]).not.toContain(CANARY);
  });
});
