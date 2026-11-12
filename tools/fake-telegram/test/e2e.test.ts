import { randomUUID } from "node:crypto";

import { afterAll, expect, test } from "bun:test";

import { createCommitterJob } from "../../../apps/server/src/modules/actions";
import { createLinkToken, createTelegramRuntime } from "../../../apps/server/src/modules/channels";
import { delegationHooks } from "../../../apps/server/src/modules/delegation";
import {
  composeMessage,
  createMailSyncJob,
  mailboxHasUidplus,
  openImapProvider,
  openSmtpSender,
} from "../../../apps/server/src/modules/mail";
import { createLlmPause, createTriageJob } from "../../../apps/server/src/modules/triage";
import { testDb, withRollback } from "../../../apps/server/test/integration/helpers";
import { createFakeTelegramClient, DEFAULT_CHAT_ID, FAKE_TOKEN, startFakeTelegram } from "../src";

import { appendUrgentSeed, createGreenmailMailbox, urgentLlm } from "./setup";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const HOUR = 3_600_000;
const WAIT_MS = 10_000;

test("link, urgent notice, digest and undo run against the fake, the DB and GreenMail", async () => {
  await withRollback(db, async (trx) => {
    const now = () => new Date();
    const startedAt = new Date(Date.now() - HOUR);
    const box = await createGreenmailMailbox(trx);
    const { ctx, secrets } = box;
    const fake = startFakeTelegram();
    const client = createFakeTelegramClient(fake.apiRoot);
    const hooks = delegationHooks({ db: trx });
    const runtime = createTelegramRuntime({
      db: trx,
      token: FAKE_TOKEN,
      now,
      startedAt,
      llmDailyCap: 300,
      triageScope: "synthetic",
      actionsScope: { kind: "synthetic" },
      llm: { provider: "gemini", classifierModel: "fake-model" },
      hooks,
      uidplus: (uidCtx, mailboxId) => mailboxHasUidplus(trx, uidCtx, mailboxId),
      sendScope: { kind: "off" },
      operatorContact: null,
      apiRoot: fake.apiRoot,
    });
    const committer = createCommitterJob({
      db: trx,
      secrets,
      openProvider: openImapProvider,
      openSender: openSmtpSender,
      compose: composeMessage,
      hooks,
      scope: { kind: "synthetic" },
      sendScope: { kind: "off" },
      now,
    });
    try {
      runtime.startPolling();

      // 1. Link the chat.
      const { token } = await createLinkToken(trx, ctx, box.userId, new Date());
      await client.send(`/start ${token}`);
      await client.waitFor(/This chat is linked/, { timeoutMs: WAIT_MS });
      const links = await trx
        .selectFrom("chat_links")
        .selectAll()
        .where("user_id", "=", box.userId)
        .where("external_chat_id", "=", String(DEFAULT_CHAT_ID))
        .execute();
      expect(links).toHaveLength(1);
      expect(Number(links[0]?.external_chat_id)).toBe(DEFAULT_CHAT_ID);
      // In one transaction now() is the start time; move the link back so the mail counts as new (D13).
      await trx
        .updateTable("chat_links")
        .set({ linked_at: startedAt })
        .where("external_chat_id", "=", String(DEFAULT_CHAT_ID))
        .execute();

      // 2. Mail: sync, triage, commit.
      const subject = `E2E urgent ${randomUUID()}`;
      const { messageId } = await appendUrgentSeed(box, { subject });
      await createMailSyncJob({
        db: trx,
        secrets,
        openProvider: openImapProvider,
        isOwnActionId: async () => false,
        now,
      }).run();
      await createTriageJob({
        db: trx,
        llm: urgentLlm(),
        pause: createLlmPause({ configHint: "test" }),
        scope: { kind: "synthetic" },
        batchSize: 5,
        dailyCap: 300,
        now,
      }).run();
      await committer.run();

      const email = await trx
        .selectFrom("emails")
        .select(["id", "uid"])
        .where("org_id", "=", ctx.orgId)
        .where("message_id_header", "=", messageId)
        .executeTakeFirstOrThrow();
      const triage = await trx
        .selectFrom("triage_results")
        .select("category")
        .where("email_id", "=", email.id)
        .executeTakeFirstOrThrow();
      expect(triage.category).toBe("urgent");
      const flag = await trx
        .selectFrom("actions")
        .select(["id", "status"])
        .where("email_id", "=", email.id)
        .where("type", "=", "flag")
        .executeTakeFirstOrThrow();
      expect(flag.status).toBe("applied");

      const flagsInInbox = async (): Promise<string[]> => {
        const provider = await openImapProvider(box.imap);
        try {
          const meta = await provider.fetchMetaIn("INBOX", Number(email.uid));
          expect(meta).not.toBeNull();
          return meta?.flags ?? [];
        } finally {
          await provider.close();
        }
      };
      expect(await flagsInInbox()).toContain("\\Flagged");

      // 3. Urgent notice.
      await runtime.notify();
      const notice = await client.waitFor(/Urgent mail[\s\S]*E2E urgent/, { timeoutMs: WAIT_MS });
      const noticeButtons = notice.buttons.flat().map((button) => button.text);
      expect(noticeButtons).toContain("✅ Right");
      expect(noticeButtons).toContain("✏️ Change");

      // 4. Digest with an undo button.
      await client.send("/digest");
      const digest = await client.waitFor(/E2E urgent/, { timeoutMs: WAIT_MS, afterMessageId: notice.messageId });
      const undoButton = digest.buttons.flat().find((button) => button.text.startsWith("↩️"));
      expect(undoButton).toBeDefined();

      // 5. Press undo.
      const pressed = await client.press({
        messageId: digest.messageId,
        button: undoButton?.text,
        timeoutMs: WAIT_MS,
      });
      expect(pressed.answer).toContain("Undo started");
      await committer.run();

      const feedback = await trx
        .selectFrom("triage_feedback")
        .select("source")
        .where("email_id", "=", email.id)
        .where("source", "=", "undo")
        .execute();
      expect(feedback).toHaveLength(1);
      const reverse = await trx
        .selectFrom("actions")
        .select("status")
        .where("reverses_action_id", "=", flag.id)
        .executeTakeFirstOrThrow();
      expect(reverse.status).toBe("applied");
      const original = await trx
        .selectFrom("actions")
        .select(["status", "status_reason"])
        .where("id", "=", flag.id)
        .executeTakeFirstOrThrow();
      expect(original.status).toBe("undone");
      expect(original.status_reason).toBe("undo");
      expect(await flagsInInbox()).not.toContain("\\Flagged");
    } finally {
      await runtime.stop();
      await fake.stop();
    }
  });
}, 60_000);
