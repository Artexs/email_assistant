import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { countFailedSendsSince, lastSendAppliedAt } from "../../src/modules/actions";
import {
  auditEvents,
  listAuditEvents,
  recordAudit,
  recordLlmCall,
  sumLlmCallsByModelSince,
} from "../../src/modules/audit";
import { countFailedOutboxSince, insertOutbox, lastOutboxSentAt } from "../../src/modules/channels";
import { insertDigest, lastDigestSentAt, markDigestSent } from "../../src/modules/reports";
import { lastTriageAt } from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertAction, insertTestEmail, insertTriaged } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// F099 stages 07 and 08: the tenant-scoped reads of the operator list and detail (plan D14, D17, D18, D28).
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

  test("S8.1 each last* function gives the newest time of the organization, null for none, never another organization's", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA, ctxB } = await twoOrgs(trx);
      const none = { orgId: (await createOrgWithMailbox(trx)).orgId } as TenantContext;

      await insertTriaged(trx, ctxA, a.mailboxId, { category: "info", createdAt: at(-3 * HOUR) });
      await insertTriaged(trx, ctxA, a.mailboxId, { category: "info", createdAt: at(-10 * 60_000) });

      for (const [slot, sentAt] of [
        ["2026-11-20T01:00", at(-9 * HOUR)],
        ["2026-11-20T07:00", at(-3 * HOUR)],
      ] as const) {
        const id = await insertDigest(trx, ctxA, {
          userId: a.userId,
          slotKey: slot,
          periodStart: at(-12 * HOUR),
          periodEnd: sentAt,
        });
        await markDigestSent(trx, ctxA, id as string, sentAt);
      }
      // An unsent digest does not count.
      await insertDigest(trx, ctxA, {
        userId: a.userId,
        slotKey: "2026-11-20T09:00",
        periodStart: at(-2 * HOUR),
        periodEnd: at(-1 * HOUR),
      });

      for (const [status, appliedAt] of [
        ["applied", at(-5 * HOUR)],
        ["applied", at(-1 * HOUR)],
        ["failed", null],
      ] as const) {
        const emailId = await insertTestEmail(trx, ctxA, a.mailboxId);
        await insertAction(trx, ctxA, emailId, {
          type: "send",
          status,
          appliedAt,
          approvedAt: status === "applied" ? appliedAt : null,
        });
      }
      // An applied move is not a send.
      const moveEmail = await insertTestEmail(trx, ctxA, a.mailboxId);
      await insertAction(trx, ctxA, moveEmail, { type: "move", status: "applied", appliedAt: at(-1 * 60_000) });

      for (const sentAt of [at(-20 * 60_000), at(-4 * HOUR), null]) {
        const createdAt = at(-6 * HOUR);
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
        if (sentAt) {
          await trx
            .updateTable("outbox")
            .set({ status: "sent", sent_at: sentAt })
            .where("org_id", "=", a.orgId)
            .where("dedup_key", "=", dedupKey)
            .execute();
        }
      }

      expect(await lastTriageAt(trx, ctxA)).toEqual(at(-10 * 60_000));
      expect(await lastDigestSentAt(trx, ctxA)).toEqual(at(-3 * HOUR));
      expect(await lastSendAppliedAt(trx, ctxA)).toEqual(at(-1 * HOUR));
      expect(await lastOutboxSentAt(trx, ctxA)).toEqual(at(-20 * 60_000));

      // Organization B and an organization with no rows never see the times of A.
      for (const other of [ctxB, none]) {
        expect(await lastTriageAt(trx, other)).toBeNull();
        expect(await lastDigestSentAt(trx, other)).toBeNull();
        expect(await lastSendAppliedAt(trx, other)).toBeNull();
        expect(await lastOutboxSentAt(trx, other)).toBeNull();
      }
    });
  });

  test("S8.2 listAuditEvents: newest first, from `since`, limited, one organization; no events gives [] with no query", async () => {
    await withRollback(db, async (trx) => {
      const { ctxA, ctxB } = await twoOrgs(trx);
      const notice = (ctx: TenantContext, key: string, when: Date) =>
        recordAudit(trx, ctx, {
          actor: "system",
          event: auditEvents.operatorNotice,
          data: { kind: "trial_ending", key },
          at: when,
        });
      await notice(ctxA, "a-1h", at(-1 * HOUR));
      await notice(ctxA, "a-2h", at(-2 * HOUR));
      await notice(ctxA, "a-8d", at(-8 * 24 * HOUR));
      await notice(ctxB, "b-1h", at(-1 * HOUR));
      await recordAudit(trx, ctxA, { actor: "system", event: auditEvents.webLogin, at: at(-30 * 60_000) });

      const rows = await listAuditEvents(trx, ctxA, {
        events: [auditEvents.operatorNotice],
        since: at(-7 * 24 * HOUR),
        limit: 2,
      });
      expect(rows.map((row) => row.data)).toEqual([
        { kind: "trial_ending", key: "a-1h" },
        { kind: "trial_ending", key: "a-2h" },
      ]);
      expect(rows.map((row) => row.at)).toEqual([at(-1 * HOUR), at(-2 * HOUR)]);
      expect(rows.every((row) => row.event === auditEvents.operatorNotice && row.actor === "system")).toBe(true);

      const limited = await listAuditEvents(trx, ctxA, {
        events: [auditEvents.operatorNotice],
        since: at(-7 * 24 * HOUR),
        limit: 1,
      });
      expect(limited).toHaveLength(1);

      // events [] returns at once: this stub rejects on any query.
      const closed = { selectFrom: () => Promise.reject(new Error("query")) } as unknown as Transaction<DB>;
      expect(await listAuditEvents(closed, ctxA, { events: [], since: at(-HOUR), limit: 5 })).toEqual([]);
    });
  });
});
