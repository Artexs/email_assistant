import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import {
  CLAIM_MAX_AGE_MS,
  claimActions,
  countActionsSince,
  countClaimable,
  createPlanned,
  expireReadyOriginals,
  expireStaleReady,
  finishAction,
  insertReverse,
  listActionsForEmail,
  listActionsForEmails,
  listFailedUnnotified,
  listSummaries,
  lockActionsForUndo,
  lockLatestOriginalMove,
  markNotified,
  markUndone,
  releaseAction,
  releaseActions,
  type ClaimFilter,
  type PlannedActionInput,
} from "../../src/modules/actions";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertAction, insertTestEmail, insertTriagedWithActions } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

interface Tenant {
  ctx: TenantContext;
  mailboxId: string;
}

async function createTwoTenants(trx: Transaction<DB>): Promise<{ a: Tenant; b: Tenant }> {
  const a = await createOrgWithMailbox(trx);
  const b = await createOrgWithMailbox(trx);
  return {
    a: { ctx: { orgId: a.orgId }, mailboxId: a.mailboxId },
    b: { ctx: { orgId: b.orgId }, mailboxId: b.mailboxId },
  };
}

async function actionRows(trx: Transaction<DB>, orgId: string) {
  return trx
    .selectFrom("actions")
    .select(["id", "org_id", "email_id", "type", "status", "payload", "idempotency_key"])
    .where("org_id", "=", orgId)
    .execute();
}

describe("actions repository", () => {
  test("createPlanned stores the context org and inserts each key once per org", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const emailA = await insertTestEmail(trx, a.ctx, a.mailboxId);
      const emailB = await insertTestEmail(trx, b.ctx, b.mailboxId);
      const move: PlannedActionInput = {
        type: "move",
        payload: { folder: "ai_info" },
        status: "logged",
        idempotencyKey: "k-move",
      };
      const items: PlannedActionInput[] = [
        move,
        { type: "save_summary", payload: { summary: "short summary" }, status: "logged", idempotencyKey: "k-summary" },
      ];

      const first = await createPlanned(trx, a.ctx, emailA, items);
      expect(first).toHaveLength(2);
      expect(first.map((row) => [row.type, row.status])).toEqual([
        ["move", "logged"],
        ["save_summary", "logged"],
      ]);

      const rowsA = await actionRows(trx, a.ctx.orgId);
      expect(rowsA).toHaveLength(2);
      expect(rowsA.map((row) => row.id).sort()).toEqual(first.map((row) => row.id).sort());
      expect(rowsA.find((row) => row.type === "move")).toMatchObject({
        org_id: a.ctx.orgId,
        email_id: emailA,
        status: "logged",
        payload: { folder: "ai_info" },
        idempotency_key: "k-move",
      });

      // The same keys again: no insert, no rows returned.
      expect(await createPlanned(trx, a.ctx, emailA, items)).toEqual([]);
      expect(await actionRows(trx, a.ctx.orgId)).toHaveLength(2);

      // The key is unique per org: the same key in the other org inserts.
      const inB = await createPlanned(trx, b.ctx, emailB, [move]);
      expect(inB).toHaveLength(1);
      expect(await actionRows(trx, b.ctx.orgId)).toHaveLength(1);
      expect(await actionRows(trx, a.ctx.orgId)).toHaveLength(2);

      expect(await createPlanned(trx, a.ctx, emailA, [])).toEqual([]);
    });
  });

  test("listActionsForEmail returns the rows of the context org only", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const emailA = await insertTestEmail(trx, a.ctx, a.mailboxId);
      await createPlanned(trx, a.ctx, emailA, [
        { type: "move", payload: { folder: "ai_spam" }, status: "ready", idempotencyKey: "l-move" },
        { type: "mark_read", payload: {}, status: "awaiting_approval", idempotencyKey: "l-read" },
      ]);

      const rows = await listActionsForEmail(trx, a.ctx, emailA);
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.type === "move")).toMatchObject({
        status: "ready",
        payload: { folder: "ai_spam" },
      });
      expect(rows.find((row) => row.type === "mark_read")).toMatchObject({ status: "awaiting_approval", payload: {} });

      expect(await listActionsForEmail(trx, b.ctx, emailA)).toEqual([]);
    });
  });

  test("listSummaries returns only save_summary payloads of the context org", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const emailA1 = await insertTestEmail(trx, a.ctx, a.mailboxId);
      const emailA2 = await insertTestEmail(trx, a.ctx, a.mailboxId);
      const emailA3 = await insertTestEmail(trx, a.ctx, a.mailboxId);
      const emailB = await insertTestEmail(trx, b.ctx, b.mailboxId);

      await createPlanned(trx, a.ctx, emailA1, [
        { type: "save_summary", payload: { summary: "summary A1" }, status: "logged", idempotencyKey: "s-a1" },
        { type: "move", payload: { folder: "ai_info" }, status: "logged", idempotencyKey: "s-a1-move" },
      ]);
      // A `move` action only: no summary for this email.
      await createPlanned(trx, a.ctx, emailA2, [
        { type: "move", payload: { folder: "ai_notifications" }, status: "logged", idempotencyKey: "s-a2-move" },
      ]);
      await createPlanned(trx, b.ctx, emailB, [
        { type: "save_summary", payload: { summary: "summary B" }, status: "logged", idempotencyKey: "s-b" },
      ]);

      const summaries = await listSummaries(trx, a.ctx, [emailA1, emailA2, emailA3, emailB]);
      expect([...summaries.entries()]).toEqual([[emailA1, "summary A1"]]);

      const otherOrg = await listSummaries(trx, b.ctx, [emailA1, emailB]);
      expect([...otherOrg.entries()]).toEqual([[emailB, "summary B"]]);

      const empty = await listSummaries(trx, a.ctx, []);
      expect(empty.size).toBe(0);
    });
  });
});

const NOW = new Date("2026-11-07T12:00:00.000Z");
const STALE_BEFORE = new Date(NOW.getTime() - 10 * 60_000);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ALL: ClaimFilter = { kind: "all" };

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function claimOpts(filter: ClaimFilter = ALL, limit = 50) {
  return { now: NOW, limit, staleBefore: STALE_BEFORE, filter };
}

function countOpts(filter: ClaimFilter = ALL) {
  return { now: NOW, staleBefore: STALE_BEFORE, filter };
}

async function actionState(trx: Transaction<DB>, id: string) {
  return trx.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

const ready = (type: "move" | "flag" | "mark_read" | "save_summary") => ({ type, status: "ready" });

describe("claimActions", () => {
  test("orders by received_at, email id and type rank; locked_at = now; a second claim returns nothing", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const newer = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR),
        receivedAt: ago(HOUR),
        actions: [ready("move"), ready("flag"), ready("save_summary"), ready("mark_read")],
      });
      const older = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(2 * HOUR),
        receivedAt: ago(2 * HOUR),
        actions: [ready("move"), ready("flag")],
      });

      const claimed = await claimActions(trx, a.ctx, a.mailboxId, claimOpts());
      expect(claimed.map((row) => [row.email_id, row.type])).toEqual([
        [older.emailId, "flag"],
        [older.emailId, "move"],
        [newer.emailId, "save_summary"],
        [newer.emailId, "flag"],
        [newer.emailId, "mark_read"],
        [newer.emailId, "move"],
      ]);
      expect(claimed[0]?.email).toMatchObject({ id: older.emailId, mailbox_id: a.mailboxId, folder: "INBOX", uid: 1 });
      for (const row of claimed) {
        expect(row.locked_at.getTime()).toBe(NOW.getTime());
        expect((await actionState(trx, row.id)).locked_at?.getTime()).toBe(NOW.getTime());
        expect((await actionState(trx, row.id)).attempts).toBe(0);
      }

      expect(await claimActions(trx, a.ctx, a.mailboxId, claimOpts())).toEqual([]);
    });
  });

  test("the claim orders ties on received_at by email id", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const first = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR),
        actions: [ready("flag")],
      });
      const second = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR),
        actions: [ready("flag")],
      });
      const expected = [first.emailId, second.emailId].sort();
      const claimed = await claimActions(trx, a.ctx, a.mailboxId, claimOpts());
      expect(claimed.map((row) => row.email_id)).toEqual(expected);
    });
  });

  test("filters: none, synthetic and all", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const synthetic = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(2 * HOUR),
        messageId: "<seed-1@ea-seed.test>",
        actions: [ready("flag"), ready("save_summary")],
      });
      const real = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR),
        messageId: "<real-1@example.com>",
        actions: [ready("flag"), ready("save_summary")],
      });
      const summed = (rows: { email_id: string; type: string }[]) =>
        rows.map((row) => `${row.email_id === synthetic.emailId ? "syn" : "real"}:${row.type}`).sort();

      expect(summed(await claimActions(trx, a.ctx, a.mailboxId, claimOpts({ kind: "none" })))).toEqual([
        "real:save_summary",
        "syn:save_summary",
      ]);
      await trx.updateTable("actions").set({ locked_at: null }).execute();
      expect(summed(await claimActions(trx, a.ctx, a.mailboxId, claimOpts({ kind: "synthetic" })))).toEqual([
        "real:save_summary",
        "syn:flag",
        "syn:save_summary",
      ]);
      await trx.updateTable("actions").set({ locked_at: null }).execute();
      expect(summed(await claimActions(trx, a.ctx, a.mailboxId, claimOpts(ALL)))).toEqual([
        "real:flag",
        "real:save_summary",
        "syn:flag",
        "syn:save_summary",
      ]);
      expect(real.emailId).not.toBe(synthetic.emailId);
    });
  });

  test("next_attempt_at in the future and a fresh lock are skipped; a stale lock is claimed", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR),
        actions: [],
      });
      const waiting = await insertAction(trx, a.ctx, mail.emailId, {
        ...ready("flag"),
        nextAttemptAt: new Date(NOW.getTime() + 60_000),
        createdAt: ago(HOUR),
      });
      const fresh = await insertAction(trx, a.ctx, mail.emailId, {
        ...ready("mark_read"),
        lockedAt: ago(60_000),
        createdAt: ago(HOUR),
      });
      const stale = await insertAction(trx, a.ctx, mail.emailId, {
        ...ready("move"),
        lockedAt: ago(20 * 60_000),
        createdAt: ago(HOUR),
      });
      const due = await insertAction(trx, a.ctx, mail.emailId, {
        ...ready("save_summary"),
        nextAttemptAt: ago(60_000),
        createdAt: ago(HOUR),
      });

      expect(await countClaimable(trx, a.ctx, a.mailboxId, countOpts())).toEqual({ total: 2, mailboxChanging: 1 });
      const claimed = await claimActions(trx, a.ctx, a.mailboxId, claimOpts());
      expect(claimed.map((row) => row.id).sort()).toEqual([stale, due].sort());
      expect(claimed.map((row) => row.id)).not.toContain(waiting);
      expect(claimed.map((row) => row.id)).not.toContain(fresh);
    });
  });

  test("M10: an original of mail received 8 days ago is not claimed; summary and reverse rows are", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const old = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(8 * DAY),
        receivedAt: ago(8 * DAY),
        actions: [],
      });
      await insertAction(trx, a.ctx, old.emailId, { ...ready("move"), createdAt: NOW });
      const summary = await insertAction(trx, a.ctx, old.emailId, { ...ready("save_summary"), createdAt: NOW });
      const applied = await insertAction(trx, a.ctx, old.emailId, {
        type: "flag",
        status: "applied",
        createdAt: ago(DAY),
      });
      const reverse = await insertAction(trx, a.ctx, old.emailId, {
        ...ready("flag"),
        reversesActionId: applied,
        createdAt: ago(3 * DAY),
      });

      expect(await countClaimable(trx, a.ctx, a.mailboxId, countOpts())).toEqual({ total: 2, mailboxChanging: 1 });
      const claimed = await claimActions(trx, a.ctx, a.mailboxId, claimOpts());
      expect(claimed.map((row) => row.id).sort()).toEqual([summary, reverse].sort());
    });
  });

  test("the 25-hour-old original move is never claimed", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR),
        actions: [],
      });
      await insertAction(trx, a.ctx, mail.emailId, { ...ready("move"), createdAt: ago(CLAIM_MAX_AGE_MS + HOUR) });
      expect(await claimActions(trx, a.ctx, a.mailboxId, claimOpts())).toEqual([]);
      expect(await countClaimable(trx, a.ctx, a.mailboxId, countOpts())).toEqual({ total: 0, mailboxChanging: 0 });
    });
  });
});

describe("finishAction", () => {
  test("needs the claim token; applied and failed set their columns", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR),
        actions: [ready("flag"), ready("move")],
      });
      await trx
        .updateTable("actions")
        .set({ next_attempt_at: ago(1000) })
        .execute();
      const [flag, move] = mail.actionIds as [string, string];
      await claimActions(trx, a.ctx, a.mailboxId, claimOpts());

      const wrong = new Date(NOW.getTime() + 1);
      expect(await finishAction(trx, a.ctx, flag, wrong, { status: "applied", appliedAt: NOW })).toBe(false);
      expect(await actionState(trx, flag)).toMatchObject({ status: "ready", applied_at: null });

      expect(
        await finishAction(trx, a.ctx, flag, NOW, {
          status: "applied",
          appliedAt: ago(1000),
          providerResult: { uid: 7 },
        })
      ).toBe(true);
      const applied = await actionState(trx, flag);
      expect(applied).toMatchObject({ status: "applied", locked_at: null, next_attempt_at: null });
      expect(applied.applied_at?.getTime()).toBe(ago(1000).getTime());
      expect(applied.provider_result).toEqual({ uid: 7 });
      expect(await finishAction(trx, a.ctx, flag, NOW, { status: "applied", appliedAt: NOW })).toBe(false);

      expect(
        await finishAction(trx, a.ctx, move, NOW, {
          status: "failed",
          reason: "mail_not_found",
          lastError: "HardError",
        })
      ).toBe(true);
      expect(await actionState(trx, move)).toMatchObject({
        status: "failed",
        status_reason: "mail_not_found",
        last_error: "HardError",
        locked_at: null,
        next_attempt_at: null,
        applied_at: null,
      });
    });
  });
});

describe("releaseAction and releaseActions", () => {
  test("releaseAction counts an attempt on request and keeps the row ready", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR),
        actions: [ready("flag")],
      });
      const [id] = mail.actionIds as [string];
      await claimActions(trx, a.ctx, a.mailboxId, claimOpts());
      const next = new Date(NOW.getTime() + 5 * 60_000);

      expect(
        await releaseAction(trx, a.ctx, id, new Date(NOW.getTime() + 1), { nextAttemptAt: next, countAttempt: true })
      ).toBe(false);
      expect(
        await releaseAction(trx, a.ctx, id, NOW, { nextAttemptAt: next, countAttempt: true, lastError: "HardError" })
      ).toBe(true);
      const state = await actionState(trx, id);
      expect(state).toMatchObject({ status: "ready", attempts: 1, locked_at: null, last_error: "HardError" });
      expect(state.next_attempt_at?.getTime()).toBe(next.getTime());
    });
  });

  test("releaseActions clears the lock and changes neither attempts nor next_attempt_at", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR),
        actions: [ready("flag"), ready("mark_read")],
      });
      const [first, second] = mail.actionIds as [string, string];
      await trx
        .updateTable("actions")
        .set({ attempts: 2, next_attempt_at: ago(1000) })
        .execute();
      await claimActions(trx, a.ctx, a.mailboxId, claimOpts());

      expect(await releaseActions(trx, a.ctx, [], NOW)).toBe(0);
      expect(await releaseActions(trx, a.ctx, [first, second], new Date(NOW.getTime() + 1))).toBe(0);
      expect(await releaseActions(trx, a.ctx, [first, second], NOW)).toBe(2);
      for (const id of [first, second]) {
        const state = await actionState(trx, id);
        expect(state).toMatchObject({ status: "ready", attempts: 2, locked_at: null });
        expect(state.next_attempt_at?.getTime()).toBe(ago(1000).getTime());
      }
    });
  });
});

describe("expireStaleReady", () => {
  test("expires old ready originals of mailbox types only", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR),
        actions: [],
      });
      const old = ago(25 * HOUR);
      const staleMove = await insertAction(trx, a.ctx, mail.emailId, { ...ready("move"), createdAt: old });
      const freshMove = await insertAction(trx, a.ctx, mail.emailId, { ...ready("move"), createdAt: ago(HOUR) });
      const appliedFlag = await insertAction(trx, a.ctx, mail.emailId, {
        type: "flag",
        status: "applied",
        createdAt: old,
      });
      const reverse = await insertAction(trx, a.ctx, mail.emailId, {
        ...ready("flag"),
        reversesActionId: appliedFlag,
        createdAt: old,
      });
      const summary = await insertAction(trx, a.ctx, mail.emailId, { ...ready("save_summary"), createdAt: old });
      const lockedMove = await insertAction(trx, a.ctx, mail.emailId, {
        ...ready("mark_read"),
        createdAt: old,
        lockedAt: ago(60_000),
      });

      const expired = await expireStaleReady(trx, a.ctx, a.mailboxId, { now: NOW, staleBefore: STALE_BEFORE });
      expect(expired).toEqual([{ id: staleMove, emailId: mail.emailId, type: "move" }]);
      expect(await actionState(trx, staleMove)).toMatchObject({ status: "expired", status_reason: "stale" });
      for (const id of [freshMove, reverse, summary, lockedMove]) {
        expect((await actionState(trx, id)).status).toBe("ready");
      }
    });
  });
});

describe("tenant filter", () => {
  test("org B's context sees nothing of org A", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR),
        actions: [ready("flag"), ready("move")],
      });
      const [flag, move] = mail.actionIds as [string, string];
      await insertAction(trx, a.ctx, mail.emailId, { ...ready("move"), createdAt: ago(25 * HOUR) });

      // org B asks for org A's mailbox
      expect(await countClaimable(trx, b.ctx, a.mailboxId, countOpts())).toEqual({ total: 0, mailboxChanging: 0 });
      expect(await claimActions(trx, b.ctx, a.mailboxId, claimOpts())).toEqual([]);
      expect(await expireStaleReady(trx, b.ctx, a.mailboxId, { now: NOW, staleBefore: STALE_BEFORE })).toEqual([]);
      expect((await listActionsForEmails(trx, b.ctx, [mail.emailId])).size).toBe(0);

      await trx.updateTable("actions").set({ locked_at: NOW }).where("id", "in", [flag, move]).execute();
      expect(await finishAction(trx, b.ctx, flag, NOW, { status: "applied", appliedAt: NOW })).toBe(false);
      expect(await releaseAction(trx, b.ctx, flag, NOW, { nextAttemptAt: null, countAttempt: true })).toBe(false);
      expect(await releaseActions(trx, b.ctx, [flag, move], NOW)).toBe(0);
      expect(await actionState(trx, flag)).toMatchObject({ status: "ready", attempts: 0 });
      expect((await actionState(trx, flag)).locked_at?.getTime()).toBe(NOW.getTime());
    });
  });
});

describe("claimActions with two connections", () => {
  test("SKIP LOCKED: the second connection gets the other rows", async () => {
    const created = await db.transaction().execute((trx) => createOrgWithMailbox(trx));
    const ctx = { orgId: created.orgId };
    try {
      await db.transaction().execute(async (trx) => {
        for (let n = 0; n < 6; n += 1) {
          await insertTriagedWithActions(trx, ctx, created.mailboxId, {
            category: "info",
            createdAt: ago((n + 1) * HOUR),
            actions: [ready("flag")],
          });
        }
      });

      let first: { id: string }[] = [];
      let second: { id: string }[] = [];
      await db.transaction().execute(async (trx1) => {
        first = await claimActions(trx1, ctx, created.mailboxId, claimOpts(ALL, 3));
        second = await claimActions(db, ctx, created.mailboxId, claimOpts(ALL, 3));
      });

      expect(first).toHaveLength(3);
      expect(second).toHaveLength(3);
      const firstIds = new Set(first.map((row) => row.id));
      for (const row of second) expect(firstIds.has(row.id)).toBe(false);
    } finally {
      await db.deleteFrom("organizations").where("id", "=", created.orgId).execute();
      await db.deleteFrom("users").where("id", "=", created.userId).execute();
    }
  });
});

describe("listActionsForEmails (grown view)", () => {
  test("returns id, reverse, reversesActionId and appliedAt", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(2 * HOUR),
        actions: [{ type: "move", status: "undone", payload: { folder: "ai_info" }, appliedAt: ago(HOUR) }],
      });
      const [original] = mail.actionIds as [string];
      const reverse = await insertAction(trx, a.ctx, mail.emailId, {
        type: "move",
        status: "applied",
        payload: { folder: "ai_info" },
        reversesActionId: original,
        appliedAt: ago(1000),
        createdAt: ago(60_000),
      });

      const views = (await listActionsForEmails(trx, a.ctx, [mail.emailId])).get(mail.emailId);
      expect(views).toEqual([
        {
          id: original,
          type: "move",
          status: "undone",
          folder: "ai_info",
          reverse: false,
          reversesActionId: null,
          appliedAt: ago(HOUR),
        },
        {
          id: reverse,
          type: "move",
          status: "applied",
          folder: "ai_info",
          reverse: true,
          reversesActionId: original,
          appliedAt: ago(1000),
        },
      ]);
    });
  });
});

describe("markUndone", () => {
  test("only from applied", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(2 * HOUR),
        actions: [
          { type: "move", status: "ready", payload: { folder: "ai_info" } },
          { type: "flag", status: "applied" },
        ],
      });
      const [readyMove, appliedFlag] = mail.actionIds as [string, string];

      expect(await markUndone(trx, a.ctx, readyMove, { at: NOW, reason: "undo" })).toBe(false);
      expect((await actionState(trx, readyMove)).status).toBe("ready");

      expect(await markUndone(trx, a.ctx, appliedFlag, { at: NOW, reason: "user_moved_back" })).toBe(true);
      expect(await actionState(trx, appliedFlag)).toMatchObject({ status: "undone", status_reason: "user_moved_back" });
      expect(await markUndone(trx, a.ctx, appliedFlag, { at: NOW, reason: "undo" })).toBe(false);
    });
  });
});

describe("insertReverse", () => {
  test("a second call returns null and only one reverse row exists", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(2 * HOUR),
        actions: [{ type: "move", status: "applied", payload: { folder: "ai_info" } }],
      });
      const [original] = mail.actionIds as [string];
      const input = { id: original, emailId: mail.emailId, type: "move" as const, payload: { folder: "ai_info" } };

      const first = await insertReverse(trx, a.ctx, input);
      expect(first).not.toBeNull();
      expect(await insertReverse(trx, a.ctx, input)).toBeNull();

      const reverses = await trx
        .selectFrom("actions")
        .selectAll()
        .where("org_id", "=", a.ctx.orgId)
        .where("reverses_action_id", "=", original)
        .execute();
      expect(reverses).toHaveLength(1);
      expect(reverses[0]).toMatchObject({
        id: first,
        status: "ready",
        type: "move",
        payload: { folder: "ai_info" },
        idempotency_key: `${original}:undo`,
      });
    });
  });
});

describe("lockActionsForUndo and lockLatestOriginalMove", () => {
  test("lockActionsForUndo returns the originals of mailbox types with their reverse", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(2 * HOUR),
        actions: [
          { type: "save_summary", status: "applied", payload: { summary: "s" } },
          { type: "flag", status: "applied" },
          { type: "move", status: "applied", payload: { folder: "ai_info" } },
        ],
      });
      const [, flag, move] = mail.actionIds as [string, string, string];
      const reverse = await insertReverse(trx, a.ctx, {
        id: move,
        emailId: mail.emailId,
        type: "move",
        payload: { folder: "ai_info" },
      });

      // the rows share one created_at: the order falls back to the random id
      const candidates = (await lockActionsForUndo(trx, a.ctx, mail.emailId)).sort((x, y) =>
        x.type.localeCompare(y.type)
      );
      expect(candidates).toEqual([
        { id: flag, type: "flag", payload: {}, status: "applied", appliedAt: ago(2 * HOUR), reverse: null },
        {
          id: move,
          type: "move",
          payload: { folder: "ai_info" },
          status: "applied",
          appliedAt: ago(2 * HOUR),
          reverse: { id: reverse as string, status: "ready" },
        },
      ]);
      expect(await lockActionsForUndo(trx, a.ctx, "00000000-0000-0000-0000-000000000000")).toEqual([]);
    });
  });

  test("lockLatestOriginalMove picks the newest original move and its reverse status", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(5 * HOUR),
        actions: [{ type: "move", status: "undone", payload: { folder: "ai_info" } }],
      });
      expect(await lockLatestOriginalMove(trx, a.ctx, "00000000-0000-0000-0000-000000000000")).toBeUndefined();
      const newer = await insertAction(trx, a.ctx, mail.emailId, {
        type: "move",
        status: "applied",
        payload: { folder: "ai_info" },
        createdAt: ago(HOUR),
      });
      await insertAction(trx, a.ctx, mail.emailId, { type: "flag", status: "applied", createdAt: ago(1000) });

      expect(await lockLatestOriginalMove(trx, a.ctx, mail.emailId)).toEqual({
        id: newer,
        status: "applied",
        reverseStatus: null,
      });
      await insertAction(trx, a.ctx, mail.emailId, {
        type: "move",
        status: "ready",
        payload: { folder: "ai_info" },
        reversesActionId: newer,
        createdAt: ago(500),
      });
      expect(await lockLatestOriginalMove(trx, a.ctx, mail.emailId)).toEqual({
        id: newer,
        status: "applied",
        reverseStatus: "ready",
      });
    });
  });

  test("two connections: lockLatestOriginalMove waits for the row lock of lockActionsForUndo", async () => {
    const created = await db.transaction().execute((trx) => createOrgWithMailbox(trx));
    const ctx = { orgId: created.orgId };
    try {
      const mail = await db.transaction().execute((trx) =>
        insertTriagedWithActions(trx, ctx, created.mailboxId, {
          category: "info",
          createdAt: ago(2 * HOUR),
          actions: [{ type: "move", status: "applied", payload: { folder: "ai_info" } }],
        })
      );
      const [moveId] = mail.actionIds as [string];

      let code: unknown;
      await db.transaction().execute(async (trx1) => {
        await lockActionsForUndo(trx1, ctx, mail.emailId);
        try {
          await db.transaction().execute(async (trx2) => {
            await sql`SET LOCAL lock_timeout = '200ms'`.execute(trx2);
            await lockLatestOriginalMove(trx2, ctx, mail.emailId);
          });
        } catch (error) {
          code = (error as { code?: unknown }).code;
        }
      });
      expect(code).toBe("55P03");

      const after = await db.transaction().execute((trx2) => lockLatestOriginalMove(trx2, ctx, mail.emailId));
      expect(after).toEqual({ id: moveId, status: "applied", reverseStatus: null });
    } finally {
      await db.deleteFrom("organizations").where("id", "=", created.orgId).execute();
      await db.deleteFrom("users").where("id", "=", created.userId).execute();
    }
  });
});

describe("listFailedUnnotified and markNotified", () => {
  test("filters mail_not_found originals and notified rows; markNotified runs once", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(4 * DAY),
        subject: "Quarterly plan",
        from: "boss@example.test",
        messageId: "<q@example.test>",
        actions: [
          { type: "move", status: "failed" },
          { type: "flag", status: "failed" },
          { type: "mark_read", status: "failed" },
        ],
      });
      const [notFound, old, notified] = mail.actionIds as [string, string, string];
      await trx
        .updateTable("actions")
        .set({ status_reason: "mail_not_found", updated_at: ago(2 * DAY) })
        .where("id", "=", notFound)
        .execute();
      await trx
        .updateTable("actions")
        .set({ updated_at: ago(3 * DAY) })
        .where("id", "=", old)
        .execute();
      await trx
        .updateTable("actions")
        .set({ notified_at: ago(DAY) })
        .where("id", "=", notified)
        .execute();
      const reverse = await insertAction(trx, a.ctx, mail.emailId, {
        type: "move",
        status: "failed",
        statusReason: "mail_not_found",
        reversesActionId: notFound,
        payload: { folder: "ai_info" },
        createdAt: ago(DAY),
      });

      const listed = await listFailedUnnotified(trx, a.ctx, { limit: 10 });
      expect(listed.map((row) => row.id)).toEqual([old, reverse]);
      expect(listed[0]).toMatchObject({
        email_id: mail.emailId,
        type: "flag",
        reverse: false,
        mailbox_id: a.mailboxId,
        subject: "Quarterly plan",
        from_address: "boss@example.test",
        message_id_header: "<q@example.test>",
      });
      expect(listed[0]?.updated_at.getTime()).toBe(ago(3 * DAY).getTime());
      expect(listed[1]).toMatchObject({
        reverse: true,
        status_reason: "mail_not_found",
        payload: { folder: "ai_info" },
      });
      expect(await listFailedUnnotified(trx, a.ctx, { limit: 1 })).toHaveLength(1);

      expect(await markNotified(trx, a.ctx, old, NOW)).toBe(true);
      expect(await markNotified(trx, a.ctx, old, NOW)).toBe(false);
      expect((await listFailedUnnotified(trx, a.ctx, { limit: 10 })).map((row) => row.id)).toEqual([reverse]);
    });
  });
});

describe("countActionsSince", () => {
  test("counts originals of mailbox types: applied flag, undone move; not summary, not reverse", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR),
        actions: [
          { type: "flag", status: "applied" },
          { type: "move", status: "undone", payload: { folder: "ai_info" } },
          { type: "save_summary", status: "applied", payload: { summary: "s" } },
          { type: "mark_read", status: "failed" },
        ],
      });
      const [, move] = mail.actionIds as [string, string];
      await insertAction(trx, a.ctx, mail.emailId, {
        type: "move",
        status: "applied",
        reversesActionId: move,
        createdAt: ago(1000),
      });
      // too old
      await insertAction(trx, a.ctx, mail.emailId, { type: "flag", status: "applied", createdAt: ago(3 * DAY) });
      await trx
        .updateTable("actions")
        .set({ updated_at: ago(30 * 60_000) })
        .where("email_id", "=", mail.emailId)
        .execute();

      expect(await countActionsSince(trx, a.ctx, { since: ago(2 * HOUR) })).toEqual({
        applied: 1,
        failed: 1,
        undone: 1,
      });
    });
  });
});

describe("expireReadyOriginals", () => {
  test("types, category, emailId, lock and reverse rows; the reason is stored", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const create = (category: "info" | "spam" | "unsure", uid: number) =>
        insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
          category,
          uid,
          createdAt: ago(HOUR),
          actions: [
            { type: "move", status: "ready", payload: { folder: "ai_info" } },
            { type: "mark_read", status: "ready" },
            { type: "flag", status: "ready" },
          ],
        });
      const info = await create("info", 1);
      const spam = await create("spam", 2);
      const unsure = await create("unsure", 3);
      const [infoMove, infoRead, infoFlag] = info.actionIds as [string, string, string];
      await insertAction(trx, a.ctx, info.emailId, {
        ...ready("move"),
        reversesActionId: infoMove,
        createdAt: ago(1000),
      });
      const locked = await insertAction(trx, a.ctx, info.emailId, {
        ...ready("mark_read"),
        lockedAt: ago(60_000),
        createdAt: ago(2000),
      });
      const filter = { mailboxId: a.mailboxId, types: ["move", "mark_read"] as const };
      const opts = { now: NOW, staleBefore: STALE_BEFORE, reason: "policy_changed" as const };

      const expired = await expireReadyOriginals(trx, a.ctx, { ...filter, category: { is: "info" } }, opts);
      expect(expired.map((row) => row.id).sort()).toEqual([infoMove, infoRead].sort());
      expect(expired.find((row) => row.id === infoMove)).toEqual({ id: infoMove, emailId: info.emailId, type: "move" });
      expect(await actionState(trx, infoMove)).toMatchObject({ status: "expired", status_reason: "policy_changed" });
      expect((await actionState(trx, infoFlag)).status).toBe("ready");
      expect((await actionState(trx, locked)).status).toBe("ready");
      for (const id of [...spam.actionIds, ...unsure.actionIds])
        expect((await actionState(trx, id)).status).toBe("ready");
      const reverseRows = await trx
        .selectFrom("actions")
        .select("status")
        .where("reverses_action_id", "=", infoMove)
        .execute();
      expect(reverseRows).toEqual([{ status: "ready" }]);

      const notUnsure = await expireReadyOriginals(
        trx,
        a.ctx,
        { ...filter, emailId: spam.emailId, category: { not: "unsure" } },
        { ...opts, reason: "undo" }
      );
      expect(notUnsure.map((row) => row.emailId)).toEqual([spam.emailId, spam.emailId]);
      expect((await actionState(trx, spam.actionIds[0] as string)).status_reason).toBe("undo");
      expect((await actionState(trx, spam.actionIds[2] as string)).status).toBe("ready");

      const rest = await expireReadyOriginals(trx, a.ctx, { ...filter, category: { not: "info" } }, opts);
      expect(rest.map((row) => row.emailId)).toEqual([unsure.emailId, unsure.emailId]);
      expect(
        await expireReadyOriginals(trx, a.ctx, { mailboxId: a.mailboxId, types: [] }, { ...opts, reason: "manual" })
      ).toEqual([]);
    });
  });

  test("category not: without emailId, expires info and spam, keeps unsure", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const create = (category: "info" | "spam" | "unsure", uid: number) =>
        insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
          category,
          uid,
          createdAt: ago(HOUR),
          actions: [
            { type: "move", status: "ready", payload: { folder: "ai_info" } },
            { type: "mark_read", status: "ready" },
          ],
        });
      const info = await create("info", 1);
      const spam = await create("spam", 2);
      const unsure = await create("unsure", 3);

      const expired = await expireReadyOriginals(
        trx,
        a.ctx,
        { mailboxId: a.mailboxId, types: ["move", "mark_read"], category: { not: "unsure" } },
        { now: NOW, staleBefore: STALE_BEFORE, reason: "policy_changed" }
      );
      expect(expired.map((row) => row.id).sort()).toEqual([...info.actionIds, ...spam.actionIds].sort());
      for (const id of [...info.actionIds, ...spam.actionIds])
        expect((await actionState(trx, id)).status).toBe("expired");
      for (const id of unsure.actionIds) expect((await actionState(trx, id)).status).toBe("ready");
    });
  });
});

describe("tenant filter (7.1b)", () => {
  test("org B's context sees nothing of org A", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR),
        actions: [
          { type: "move", status: "applied", payload: { folder: "ai_info" } },
          { type: "flag", status: "failed" },
          { type: "mark_read", status: "ready" },
        ],
      });
      const [move, flag] = mail.actionIds as [string, string];
      const applied = { id: move, emailId: mail.emailId, type: "move" as const, payload: { folder: "ai_info" } };

      expect(await markUndone(trx, b.ctx, move, { at: NOW, reason: "undo" })).toBe(false);
      expect(await lockActionsForUndo(trx, b.ctx, mail.emailId)).toEqual([]);
      expect(await lockLatestOriginalMove(trx, b.ctx, mail.emailId)).toBeUndefined();
      expect(await listFailedUnnotified(trx, b.ctx, { limit: 10 })).toEqual([]);
      expect(await markNotified(trx, b.ctx, flag, NOW)).toBe(false);
      expect(await countActionsSince(trx, b.ctx, { since: ago(DAY) })).toEqual({ applied: 0, failed: 0, undone: 0 });
      expect(
        await expireReadyOriginals(
          trx,
          b.ctx,
          { mailboxId: a.mailboxId, types: ["move", "mark_read", "flag"] },
          { now: NOW, staleBefore: STALE_BEFORE, reason: "manual" }
        )
      ).toEqual([]);
      // org B cannot attach a reverse row to org A's mail: the composite foreign key rejects it
      await sql`savepoint cross_org`.execute(trx);
      await expect(insertReverse(trx, b.ctx, applied)).rejects.toThrow();
      await sql`rollback to savepoint cross_org`.execute(trx);
      expect((await actionState(trx, move)).status).toBe("applied");
      expect((await actionState(trx, flag)).notified_at).toBeNull();
    });
  });
});
