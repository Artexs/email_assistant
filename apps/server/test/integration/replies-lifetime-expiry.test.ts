import { randomUUID } from "node:crypto";

import { DAY_MS, HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { expireUnseenApprovals, noDelegationHooks } from "../../src/modules/actions";
import { listApprovals } from "../../src/modules/channels/approvals-read";
import type { Db } from "../../src/platform/db";

import { insertDraftAndSend } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { NOW, ago, world, reply, tap, expiryJob, row, auditRows } from "./replies-lifetime-helpers";

// The time limit of a reply send per kind: the 7 day limit, the 48 h rule and what the approval list shows. Every test runs in a transaction that is rolled back.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("step 1: the time limit per kind", () => {
  test("1a: a reply never notified is kept at 6 d 23 h and expires as timeout at 7 d 1 min", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const kept = await reply(trx, w, 6 * DAY_MS + 23 * HOUR_MS);
      const old = await reply(trx, w, 7 * DAY_MS + MINUTE_MS, { to: "ewa@x.test", from: "ewa@x.test" });

      await expiryJob(trx).run();

      expect(await row(trx, kept.sendId)).toMatchObject({ status: "awaiting_approval", status_reason: null });
      expect(await row(trx, old.sendId)).toMatchObject({ status: "expired", status_reason: "timeout" });
      expect(await auditRows(trx, old.sendId, "action.expired")).toHaveLength(1);
    });
  });

  test("1b: a reply that an owner was told about 49 h ago keeps its 7 days (the 48 h rule skips it)", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, 3 * DAY_MS, { notifiedAt: ago(49 * HOUR_MS), requestSent: true });

      await expiryJob(trx).run();

      expect(await row(trx, p.sendId)).toMatchObject({ status: "awaiting_approval" });
    });
  });

  test("1c: a reply with a notice that nobody saw is not closed as not_seen, at the job or at a resume", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, 3 * DAY_MS, { notifiedAt: ago(60 * HOUR_MS) });

      await expiryJob(trx).run();
      const closed = await expireUnseenApprovals(trx, w.ctx, {
        resumedAt: NOW,
        actor: "system",
        hooks: noDelegationHooks,
        uidplus: async () => true,
      });

      expect(closed).toBe(0);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "awaiting_approval" });
    });
  });

  test("1d: a delegation send notified 49 h ago expires as timeout (the old rule)", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await insertDraftAndSend(trx, w.ctx, w.mailboxId, {
        delegationId: randomUUID(),
        draftProviderResult: { folder: "Drafts", uid: 7 },
        createdAt: ago(DAY_MS),
        notifiedAt: ago(49 * HOUR_MS),
        requestSent: true,
      });

      await expiryJob(trx).run();

      expect(await row(trx, p.sendId)).toMatchObject({ status: "expired", status_reason: "timeout" });
    });
  });

  test("1e: a held (approved) reply keeps the 48 h rule from the tap", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const kept = await reply(trx, w, 3 * DAY_MS, {
        sendStatus: "approved",
        approved: { userId: w.userId, at: ago(47 * HOUR_MS) },
      });
      const old = await reply(trx, w, 3 * DAY_MS, {
        sendStatus: "approved",
        approved: { userId: w.userId, at: ago(49 * HOUR_MS) },
        to: "ewa@x.test",
        from: "ewa@x.test",
      });

      await expiryJob(trx).run();

      expect(await row(trx, kept.sendId)).toMatchObject({ status: "approved" });
      expect(await row(trx, old.sendId)).toMatchObject({ status: "expired", status_reason: "held_timeout" });
    });
  });

  test("1f: a tap on a reply at 7 d 1 min expires it; at 6 days it approves", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const old = await reply(trx, w, 7 * DAY_MS + MINUTE_MS);
      const fresh = await reply(trx, w, 6 * DAY_MS, { to: "ewa@x.test", from: "ewa@x.test" });

      expect(await tap(trx, w, old.sendId)).toEqual({ kind: "expired", byThisTap: true });
      expect(await row(trx, old.sendId)).toMatchObject({ status: "expired", status_reason: "timeout" });
      expect(await tap(trx, w, fresh.sendId)).toEqual({ kind: "approved" });
    });
  });

  test("1g: a tap on a reply notified 49 h ago still approves (a delegation send does not)", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, 3 * DAY_MS, { notifiedAt: ago(49 * HOUR_MS) });
      const other = await insertDraftAndSend(trx, w.ctx, w.mailboxId, {
        delegationId: randomUUID(),
        draftProviderResult: { folder: "Drafts", uid: 7 },
        createdAt: ago(3 * DAY_MS),
        notifiedAt: ago(49 * HOUR_MS),
      });

      expect(await tap(trx, w, p.sendId)).toEqual({ kind: "approved" });
      expect(await tap(trx, w, other.sendId)).toEqual({ kind: "expired", byThisTap: true });
    });
  });

  test("1i: the approval list gives a held (approved) reply expiresAt = approved_at + 48 h", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const held = await reply(trx, w, 3 * DAY_MS, {
        sendStatus: "approved",
        approved: { userId: w.userId, at: ago(5 * HOUR_MS) },
      });

      const list = await listApprovals({ db: trx as unknown as Db, sendScope: { kind: "all" } }, w.ctx, NOW);

      const item = list.items.find((entry) => entry.id === held.sendId);
      expect(item).toMatchObject({ state: "held" });
      expect(item?.expiresAt).toBe(new Date(ago(5 * HOUR_MS).getTime() + 2 * DAY_MS).toISOString());
    });
  });

  test("1h: the approval list gives a reply expiresAt = created_at + 7 d, notified or not", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const plain = await reply(trx, w, 2 * DAY_MS);
      const told = await reply(trx, w, 3 * DAY_MS, { to: "ewa@x.test", from: "ewa@x.test", notifiedAt: ago(HOUR_MS) });
      const other = await insertDraftAndSend(trx, w.ctx, w.mailboxId, {
        delegationId: randomUUID(),
        draftProviderResult: { folder: "Drafts", uid: 7 },
        createdAt: ago(3 * DAY_MS),
        notifiedAt: ago(HOUR_MS),
      });

      const list = await listApprovals({ db: trx as unknown as Db, sendScope: { kind: "all" } }, w.ctx, NOW);

      const expires = (id: string) => list.items.find((item) => item.id === id)?.expiresAt;
      expect(expires(plain.sendId)).toBe(new Date(ago(2 * DAY_MS).getTime() + 7 * DAY_MS).toISOString());
      expect(expires(told.sendId)).toBe(new Date(ago(3 * DAY_MS).getTime() + 7 * DAY_MS).toISOString());
      // The old rule for another kind: 48 h after the owner was told.
      expect(expires(other.sendId)).toBe(new Date(ago(HOUR_MS).getTime() + 2 * DAY_MS).toISOString());
    });
  });
});
