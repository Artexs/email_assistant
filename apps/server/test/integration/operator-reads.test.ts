import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { countFailedSendsSince } from "../../src/modules/actions";
import { recordLlmCall, sumLlmCallsByModelSince } from "../../src/modules/audit";
import { countFailedOutboxSince, insertOutbox } from "../../src/modules/channels";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertAction, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// F099 stage 07: the tenant-scoped counts of the operator list (plan D14, D17, D18).
const db = testDb();
const NOW = new Date("2026-11-20T10:00:00Z");
const HOUR = 3_600_000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

afterAll(async () => {
  await db.destroy();
});

async function twoOrgs(trx: Transaction<DB>) {
  const a = await createOrgWithMailbox(trx);
  const b = await createOrgWithMailbox(trx);
  return { a, b, ctxA: { orgId: a.orgId } as TenantContext, ctxB: { orgId: b.orgId } as TenantContext };
}

describe("operator reads (F099 D14, D17, D18)", () => {
  test("1. countFailedSendsSince counts failed sends after `since` by updated_at, for one organization", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA, ctxB } = await twoOrgs(trx);
      const add = async (status: string, updatedAt: Date) => {
        const emailId = await insertTestEmail(trx, ctxA, a.mailboxId);
        const id = await insertAction(trx, ctxA, emailId, {
          type: "send",
          status,
          approvedAt: status === "applied" ? updatedAt : null,
        });
        await trx.updateTable("actions").set({ updated_at: updatedAt }).where("id", "=", id).execute();
      };
      await add("failed", at(-2 * HOUR));
      await add("failed", at(-30 * HOUR));
      await add("applied", at(-1 * HOUR));
      expect(await countFailedSendsSince(trx, ctxA, at(-24 * HOUR))).toBe(1);
      expect(await countFailedSendsSince(trx, ctxB, at(-24 * HOUR))).toBe(0);
    });
  });

  test("2. countFailedOutboxSince leaves out old rows, cancellations and other states", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA, ctxB } = await twoOrgs(trx);
      const add = async (status: string, errorCode: string | null, createdAt: Date) => {
        const dedupKey = `sync_ok:${randomUUID()}`;
        await insertOutbox(trx, ctxA, {
          userId: a.userId,
          kind: "sync_ok",
          dedupKey,
          mailboxId: a.mailboxId,
          view: {},
          locale: "en",
          createdAt,
          nextAttemptAt: createdAt,
        });
        await trx
          .updateTable("outbox")
          .set({ status, error_code: errorCode, sent_at: status === "sent" ? createdAt : null })
          .where("org_id", "=", a.orgId)
          .where("dedup_key", "=", dedupKey)
          .execute();
      };
      await add("failed", "telegram_error", at(-1 * HOUR));
      await add("failed", null, at(-25 * HOUR));
      await add("failed", "outdated", at(-1 * HOUR));
      await add("failed", "expired", at(-1 * HOUR));
      await add("sent", null, at(-1 * HOUR));
      expect(await countFailedOutboxSince(trx, ctxA, at(-24 * HOUR))).toBe(1);
      expect(await countFailedOutboxSince(trx, ctxB, at(-24 * HOUR))).toBe(0);
    });
  });

  test("3. sumLlmCallsByModelSince sums calls and tokens per model from `since`, for one organization", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA, ctxB } = await twoOrgs(trx);
      const call = (model: string, when: string, tokens: number | null) =>
        recordLlmCall(trx, ctxA, {
          mailboxId: a.mailboxId,
          role: "classifier",
          promptVersion: "p1",
          model,
          outcome: "ok",
          tokensIn: tokens === null ? null : tokens,
          tokensOut: tokens === null ? null : tokens / 5,
          latencyMs: 10,
          at: new Date(when),
        });
      await call("gpt-6-luna", "2026-11-20T08:00:00Z", 100_000);
      await call("gpt-6-luna", "2026-11-20T09:00:00Z", 100_000);
      await call("gpt-6-luna", "2026-11-20T09:30:00Z", 100_000);
      await call("unknown-model", "2026-11-20T09:00:00Z", null);
      await call("unknown-model", "2026-11-20T09:00:00Z", null);
      await call("gpt-6-luna", "2026-11-20T07:59:00Z", 100_000);
      const since = new Date("2026-11-20T08:00:00Z");
      expect(await sumLlmCallsByModelSince(trx, ctxA, since)).toEqual([
        { model: "gpt-6-luna", calls: 3, tokensIn: 300_000, tokensOut: 60_000 },
        { model: "unknown-model", calls: 2, tokensIn: 0, tokensOut: 0 },
      ]);
      expect(await sumLlmCallsByModelSince(trx, ctxB, since)).toEqual([]);
    });
  });
});
