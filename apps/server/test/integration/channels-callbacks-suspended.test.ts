import { textTables, HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { auditEvents } from "../../src/modules/audit";
import { createUpdateHandlers, type CallbackDeps } from "../../src/modules/channels";
import { NO_TEST_SENDERS } from "../../src/modules/mail";

import { T, feedbackRows, setup } from "./channels-callbacks-helpers";
import { insertDraftAndSend, insertTriagedWithActions, suspendOrg } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("taps of a suspended organization", () => {
  const PAUSED = textTables.en.bot.accountPaused("ops@example.test");

  function handlersFor(deps: CallbackDeps) {
    return createUpdateHandlers({
      ...deps,
      llmDailyCap: 300,
      triageScope: "all",
      llm: { provider: "gemini", classifierModel: "gemini-3.5-flash-lite" },
      testMail: NO_TEST_SENDERS,
      operatorContact: "ops@example.test",
      syncEveryMin: 2,
    });
  }

  test("an approve tap answers paused; the send stays awaiting_approval and no audit row is written", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA, link, deps } = await setup(trx);
      const { sendId } = await insertDraftAndSend(trx, ctxA, a.mailboxId, { notifiedAt: T, createdAt: T });
      await suspendOrg(trx, a.orgId);

      const result = await handlersFor(deps).callback(link, `ap:${sendId}`);

      expect(result).toEqual({ answer: PAUSED });
      const row = await trx.selectFrom("actions").selectAll().where("id", "=", sendId).executeTakeFirstOrThrow();
      expect(row).toMatchObject({ status: "awaiting_approval", approved_by: null });
      const audit = await trx
        .selectFrom("audit_log")
        .select("id")
        .where("org_id", "=", a.orgId)
        .where("event", "=", auditEvents.actionApproved)
        .execute();
      expect(audit).toEqual([]);
    });
  });

  test("a feedback tap answers paused and writes no feedback row", async () => {
    await withRollback(db, async (trx) => {
      const { a, info, link, deps } = await setup(trx);
      await suspendOrg(trx, a.orgId);

      const result = await handlersFor(deps).callback(link, `fr:i:${info}`);

      expect(result).toEqual({ answer: PAUSED });
      expect(await feedbackRows(trx, info)).toEqual([]);
    });
  });

  test("an Undo tap answers paused and writes no reverse action row", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA, link, deps } = await setup(trx);
      const mail = await insertTriagedWithActions(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: T,
        actions: [
          {
            type: "move",
            status: "applied",
            payload: { folder: "ai_info" },
            appliedAt: new Date(T.getTime() - HOUR_MS),
          },
        ],
      });
      await suspendOrg(trx, a.orgId);

      const result = await handlersFor(deps).callback(link, `fu:${mail.emailId}`);

      expect(result).toEqual({ answer: PAUSED });
      const reverse = await trx
        .selectFrom("actions")
        .select("id")
        .where("org_id", "=", a.orgId)
        .where("reverses_action_id", "is not", null)
        .execute();
      expect(reverse).toEqual([]);
      expect(await feedbackRows(trx, mail.emailId)).toEqual([]);
    });
  });

  test("an active organization still gets its feedback tap through the handlers", async () => {
    await withRollback(db, async (trx) => {
      const { info, link, deps } = await setup(trx);

      const result = await handlersFor(deps).callback(link, `fr:i:${info}`);

      expect(result.answer).toBe("✅ Saved: Info is right.");
    });
  });
});
