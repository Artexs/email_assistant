import type { EvidenceKey } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { settingsDeps } from "../../src/composition";
import { listActionsForEmail } from "../../src/modules/actions";
import { insertDefaultSettings, setMode } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { createLlmPause, createTriageJob, noGateEvidence } from "../../src/modules/triage";
import type { DB } from "../../src/platform/db";
import type { LlmClient } from "../../src/platform/llm";

import { createOrgWithMailbox, insertTestEmail, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// Triage moves mail only under the key that `auto` was granted on: the same job, two running keys.
const db = testDb();
const NOW = new Date("2026-11-05T12:00:00.123Z");

const KEY_A: EvidenceKey = {
  provider: "gemini",
  model: "gemini-3.5-flash-lite",
  reasoningEffort: null,
  promptVersion: "classifier-v2",
  promptParts: null,
  endpoint: "standard",
  host: null,
};

afterAll(async () => {
  await db.destroy();
});

const notificationAnswer = {
  category: "notification",
  confidence: 0.95,
  reason_code: "automated_system",
  reason: "a notice",
  summary: null,
  fields: { due_date: null, language: "pl", delegate_id: null, task: null, clarification: null },
};

const llm: LlmClient = {
  modelOf: () => "fake-model",
  endpointOf: () => "standard",
  providerOf: () => "openai",
  async generate(req) {
    return {
      data: req.schema.parse(notificationAnswer),
      usage: {
        role: req.role,
        promptVersion: req.promptVersion,
        model: "fake-model",
        tokensIn: 100,
        tokensOut: 20,
        latencyMs: 300,
        endpoint: "standard",
        provider: "openai" as const,
      },
    };
  },
} as LlmClient;

// A mailbox in `assist` with `notification` on auto; `grant` is the stored grant (absent: a row from before the trust ladder).
async function setup(trx: Transaction<DB>, grantKey: EvidenceKey | null) {
  await pauseOtherMailboxes(trx);
  const box = await createOrgWithMailbox(trx);
  const ctx = { orgId: box.orgId };
  await insertDefaultSettings(trx, ctx, box.mailboxId);
  await setMode(
    settingsDeps(trx, () => NOW),
    ctx,
    box.mailboxId,
    { mode: "assist", keepSwitches: false, actor: "test" }
  );
  const entry = {
    auto: true,
    threshold: 0.7,
    ...(grantKey === null ? {} : { grant: { key: grantKey, by: "evidence", at: "2026-11-01T10:00:00.000Z" } }),
  };
  await trx
    .updateTable("mailbox_settings")
    .set({ category_policy: JSON.stringify({ notification: entry }) })
    .where("mailbox_id", "=", box.mailboxId)
    .execute();
  const emailId = await insertTestEmail(trx, ctx, box.mailboxId, { received_at: new Date(NOW.getTime() - 600_000) });
  return { ...box, ctx, emailId };
}

async function moveStatus(trx: Transaction<DB>, s: Awaited<ReturnType<typeof setup>>, runningKey: EvidenceKey) {
  await createTriageJob({
    runningKey,
    db: trx,
    llm,
    pause: createLlmPause(),
    scope: { kind: "all" },
    batchSize: 5,
    testMail: NO_TEST_SENDERS,
    dailyCap: 1000,
    junkDailyCap: 1000,
    now: () => NOW,
  }).run();
  const actions = await listActionsForEmail(trx, s.ctx, s.emailId);
  const move = actions.find((action) => action.type === "move");
  if (!move) throw new Error("no move action");
  return move.status;
}

describe("the running key decides whether a granted auto moves mail", () => {
  test("auto granted on key A, the worker runs on key B: the move is logged", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, KEY_A);
      expect(await moveStatus(trx, s, { ...KEY_A, model: "gemini-4" })).toBe("logged");
    });
  });

  test("only the endpoint differs: the move is logged", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, KEY_A);
      expect(await moveStatus(trx, s, { ...KEY_A, endpoint: "eu" })).toBe("logged");
    });
  });

  test("the worker runs on key A: the move is ready", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, KEY_A);
      expect(await moveStatus(trx, s, KEY_A)).toBe("ready");
    });
  });

  test("auto with no grant (set before F110): the move is ready under any key", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, null);
      expect(await moveStatus(trx, s, noGateEvidence.runningKey)).toBe("ready");
    });
  });
});
