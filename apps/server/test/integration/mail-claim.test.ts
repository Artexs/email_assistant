import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { claimEmails, finishEmail, listThreadContext, releaseEmail, type ClaimedEmail } from "../../src/modules/mail";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// Milliseconds in `now` check that the locked_at token survives the round trip.
const now = new Date("2026-11-05T12:00:00.123Z");
const staleBefore = new Date(now.getTime() - 5 * 60_000);

function minutesFromNow(minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000);
}

function claimOpts(overrides: Partial<{ limit: number; syntheticOnly: boolean }> = {}) {
  return { now, limit: 10, staleBefore, syntheticOnly: false, ...overrides };
}

async function tenant(trx: Transaction<DB>): Promise<{ ctx: TenantContext; mailboxId: string }> {
  const created = await createOrgWithMailbox(trx);
  return { ctx: { orgId: created.orgId }, mailboxId: created.mailboxId };
}

async function emailState(trx: Transaction<DB>, id: string) {
  return trx
    .selectFrom("emails")
    .select(["status", "skip_reason", "attempts", "locked_at", "next_attempt_at"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

function ids(rows: ClaimedEmail[]): string[] {
  return rows.map((row) => row.id);
}

describe("claimEmails", () => {
  test("claims due pending rows oldest first up to the limit, and the locked_at token round-trips", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId } = await tenant(trx);
      const p1 = await insertTestEmail(trx, ctx, mailboxId, { received_at: minutesFromNow(-300) });
      const p2 = await insertTestEmail(trx, ctx, mailboxId, {
        received_at: minutesFromNow(-240),
        next_attempt_at: minutesFromNow(-1),
      });
      const p3 = await insertTestEmail(trx, ctx, mailboxId, {
        received_at: minutesFromNow(-180),
        next_attempt_at: now,
      });
      const p4 = await insertTestEmail(trx, ctx, mailboxId, { received_at: minutesFromNow(-120) });
      await insertTestEmail(trx, ctx, mailboxId, {
        received_at: minutesFromNow(-400),
        next_attempt_at: minutesFromNow(1),
      });
      await insertTestEmail(trx, ctx, mailboxId, { received_at: minutesFromNow(-500), status: "triaged" });
      await insertTestEmail(trx, ctx, mailboxId, { received_at: minutesFromNow(-600), status: "skipped" });

      const claimed = await claimEmails(trx, ctx, mailboxId, claimOpts({ limit: 3 }));
      expect(ids(claimed)).toEqual([p1, p2, p3]);
      for (const row of claimed) {
        expect(row.locked_at.getTime()).toBe(now.getTime());
        expect(row.mailbox_id).toBe(mailboxId);
        expect((await emailState(trx, row.id)).status).toBe("processing");
      }
      expect(claimed[1]?.next_attempt_at?.getTime()).toBe(minutesFromNow(-1).getTime());

      const first = claimed[0] as ClaimedEmail;
      expect(
        await releaseEmail(trx, ctx, first.id, first.locked_at, {
          nextAttemptAt: first.next_attempt_at,
          countAttempt: false,
        })
      ).toBe(true);
      expect(await emailState(trx, first.id)).toMatchObject({ status: "pending", locked_at: null, attempts: 0 });

      expect(ids(await claimEmails(trx, ctx, mailboxId, claimOpts()))).toEqual([p1, p4]);
      // A pending row does not count an attempt when it is claimed.
      expect((await emailState(trx, p4)).attempts).toBe(0);
    });
  });

  test("takes a stale processing row and leaves a fresh one", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId } = await tenant(trx);
      const stale = await insertTestEmail(trx, ctx, mailboxId, {
        status: "processing",
        locked_at: minutesFromNow(-10),
        attempts: 2,
      });
      const fresh = await insertTestEmail(trx, ctx, mailboxId, { status: "processing", locked_at: minutesFromNow(-1) });

      const claimed = await claimEmails(trx, ctx, mailboxId, claimOpts());
      expect(ids(claimed)).toEqual([stale]);
      // The take-back counts an attempt.
      expect(claimed[0]?.attempts).toBe(3);
      expect((await emailState(trx, stale)).attempts).toBe(3);
      expect(claimed[0]?.locked_at.getTime()).toBe(now.getTime());
      expect((await emailState(trx, fresh)).locked_at?.getTime()).toBe(minutesFromNow(-1).getTime());
    });
  });

  test("syntheticOnly returns only @ea-seed.test> ids", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId } = await tenant(trx);
      const lower = await insertTestEmail(trx, ctx, mailboxId, {
        message_id_header: "<s1@ea-seed.test>",
        received_at: minutesFromNow(-3),
      });
      const upper = await insertTestEmail(trx, ctx, mailboxId, {
        message_id_header: "<S2@EA-SEED.TEST>",
        received_at: minutesFromNow(-2),
      });
      await insertTestEmail(trx, ctx, mailboxId, { message_id_header: "<r@x.test>" });
      await insertTestEmail(trx, ctx, mailboxId, { message_id_header: "<e@ea-seed.test.evil>" });
      await insertTestEmail(trx, ctx, mailboxId, { message_id_header: null });

      expect(ids(await claimEmails(trx, ctx, mailboxId, claimOpts({ syntheticOnly: true })))).toEqual([lower, upper]);
      expect(await claimEmails(trx, ctx, mailboxId, claimOpts())).toHaveLength(3);
    });
  });

  test("another org's rows never come back", async () => {
    await withRollback(db, async (trx) => {
      const a = await tenant(trx);
      const b = await tenant(trx);
      const own = await insertTestEmail(trx, a.ctx, a.mailboxId);
      await insertTestEmail(trx, b.ctx, b.mailboxId);
      await insertTestEmail(trx, b.ctx, b.mailboxId, { status: "processing", locked_at: minutesFromNow(-10) });

      expect(await claimEmails(trx, a.ctx, b.mailboxId, claimOpts())).toEqual([]);
      expect(await claimEmails(trx, b.ctx, a.mailboxId, claimOpts())).toEqual([]);
      expect(ids(await claimEmails(trx, a.ctx, a.mailboxId, claimOpts()))).toEqual([own]);
    });
  });

  test("two connections claim disjoint rows (FOR UPDATE SKIP LOCKED)", async () => {
    const created = await db.transaction().execute((trx) => createOrgWithMailbox(trx));
    const ctx = { orgId: created.orgId };
    try {
      await db.transaction().execute(async (trx) => {
        for (let n = 0; n < 6; n += 1) {
          await insertTestEmail(trx, ctx, created.mailboxId, { received_at: minutesFromNow(n - 10) });
        }
      });

      let first: ClaimedEmail[] = [];
      let second: ClaimedEmail[] = [];
      await db.transaction().execute(async (trx1) => {
        first = await claimEmails(trx1, ctx, created.mailboxId, claimOpts({ limit: 3 }));
        second = await claimEmails(db, ctx, created.mailboxId, claimOpts({ limit: 3 }));
      });

      expect(first).toHaveLength(3);
      expect(second).toHaveLength(3);
      const firstIds = new Set(ids(first));
      for (const id of ids(second)) expect(firstIds.has(id)).toBe(false);
    } finally {
      await db.deleteFrom("organizations").where("id", "=", created.orgId).execute();
      await db.deleteFrom("users").where("id", "=", created.userId).execute();
    }
  });
});

describe("releaseEmail", () => {
  test("needs the right locked_at, org and status; countAttempt and nextAttemptAt are applied", async () => {
    await withRollback(db, async (trx) => {
      const a = await tenant(trx);
      const b = await tenant(trx);
      const id = await insertTestEmail(trx, a.ctx, a.mailboxId);
      const [claimed] = await claimEmails(trx, a.ctx, a.mailboxId, claimOpts());
      const lockedAt = (claimed as ClaimedEmail).locked_at;

      const release = { nextAttemptAt: minutesFromNow(-1), countAttempt: true };
      expect(await releaseEmail(trx, a.ctx, id, new Date(lockedAt.getTime() + 1), release)).toBe(false);
      expect(await releaseEmail(trx, b.ctx, id, lockedAt, release)).toBe(false);
      expect((await emailState(trx, id)).status).toBe("processing");

      expect(await releaseEmail(trx, a.ctx, id, lockedAt, release)).toBe(true);
      let state = await emailState(trx, id);
      expect(state).toMatchObject({ status: "pending", locked_at: null, attempts: 1 });
      expect(state.next_attempt_at?.getTime()).toBe(minutesFromNow(-1).getTime());
      // The row is pending now: the same token no longer matches.
      expect(await releaseEmail(trx, a.ctx, id, lockedAt, release)).toBe(false);

      await claimEmails(trx, a.ctx, a.mailboxId, claimOpts());
      expect(await releaseEmail(trx, a.ctx, id, now, { nextAttemptAt: null, countAttempt: false })).toBe(true);
      state = await emailState(trx, id);
      expect(state).toMatchObject({ status: "pending", locked_at: null, attempts: 1, next_attempt_at: null });
    });
  });
});

describe("finishEmail", () => {
  test("sets triaged or skipped + skip_reason and clears locked_at and next_attempt_at", async () => {
    await withRollback(db, async (trx) => {
      const a = await tenant(trx);
      const b = await tenant(trx);
      const triaged = await insertTestEmail(trx, a.ctx, a.mailboxId, {
        received_at: minutesFromNow(-2),
        next_attempt_at: minutesFromNow(-1),
      });
      const skipped = await insertTestEmail(trx, a.ctx, a.mailboxId, { received_at: minutesFromNow(-1) });
      expect(ids(await claimEmails(trx, a.ctx, a.mailboxId, claimOpts()))).toEqual([triaged, skipped]);

      expect(await finishEmail(trx, a.ctx, triaged, new Date(now.getTime() - 1), { status: "triaged" })).toBe(false);
      expect(await finishEmail(trx, b.ctx, triaged, now, { status: "triaged" })).toBe(false);

      expect(await finishEmail(trx, a.ctx, triaged, now, { status: "triaged" })).toBe(true);
      expect(await emailState(trx, triaged)).toMatchObject({
        status: "triaged",
        skip_reason: null,
        locked_at: null,
        next_attempt_at: null,
      });
      expect(await finishEmail(trx, a.ctx, triaged, now, { status: "triaged" })).toBe(false);

      expect(await finishEmail(trx, a.ctx, skipped, now, { status: "skipped", skipReason: "too_old" })).toBe(true);
      expect(await emailState(trx, skipped)).toMatchObject({
        status: "skipped",
        skip_reason: "too_old",
        locked_at: null,
        next_attempt_at: null,
      });
    });
  });
});

describe("listThreadContext", () => {
  test("returns max 3 older mails of the same thread, newest first, in the same org only", async () => {
    await withRollback(db, async (trx) => {
      const a = await tenant(trx);
      const b = await tenant(trx);
      const thread = "<root@x.test>";
      const current = await insertTestEmail(trx, a.ctx, a.mailboxId, { thread_key: thread, received_at: now });
      await insertTestEmail(trx, a.ctx, a.mailboxId, {
        thread_key: thread,
        received_at: minutesFromNow(-10),
        from_address: "m1@x.test",
        subject: "Re: 1",
        body_text: "x".repeat(800),
      });
      await insertTestEmail(trx, a.ctx, a.mailboxId, {
        thread_key: thread,
        received_at: minutesFromNow(-20),
        subject: "Re: 2",
      });
      await insertTestEmail(trx, a.ctx, a.mailboxId, {
        thread_key: thread,
        received_at: minutesFromNow(-30),
        subject: "3",
      });
      await insertTestEmail(trx, a.ctx, a.mailboxId, {
        thread_key: thread,
        received_at: minutesFromNow(-40),
        subject: "4",
      });
      await insertTestEmail(trx, a.ctx, a.mailboxId, {
        thread_key: thread,
        received_at: minutesFromNow(5),
        subject: "new",
      });
      await insertTestEmail(trx, a.ctx, a.mailboxId, { thread_key: "<other@x.test>", received_at: minutesFromNow(-5) });
      await insertTestEmail(trx, b.ctx, b.mailboxId, { thread_key: thread, received_at: minutesFromNow(-5) });

      const context = await listThreadContext(trx, a.ctx, a.mailboxId, thread, now, current, { syntheticOnly: false });
      expect(context.map((row) => row.subject)).toEqual(["Re: 1", "Re: 2", "3"]);
      expect(context[0]?.from_address).toBe("m1@x.test");
      expect(context[0]?.received_at.getTime()).toBe(minutesFromNow(-10).getTime());
      expect(context[0]?.body_excerpt).toBe("x".repeat(500));
      expect(context[1]?.body_excerpt).toBeNull();

      // The current mail is excluded even when it is older than `before`.
      const later = minutesFromNow(1);
      const withoutCurrent = await listThreadContext(trx, a.ctx, a.mailboxId, thread, later, current, {
        syntheticOnly: false,
      });
      expect(withoutCurrent.map((row) => row.subject)).toEqual(["Re: 1", "Re: 2", "3"]);

      expect(await listThreadContext(trx, b.ctx, a.mailboxId, thread, now, current, { syntheticOnly: false })).toEqual(
        []
      );
    });
  });

  test("syntheticOnly returns only the synthetic older mails of the thread", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId } = await tenant(trx);
      const thread = "<mixed@x.test>";
      const current = await insertTestEmail(trx, ctx, mailboxId, {
        thread_key: thread,
        received_at: now,
        message_id_header: "<cur@ea-seed.test>",
      });
      const older = [
        { message_id_header: "<s1@ea-seed.test>", subject: "s1", minutes: -10 },
        { message_id_header: "<r1@x.test>", subject: "r1", minutes: -20 },
        { message_id_header: "<S2@EA-SEED.TEST>", subject: "s2", minutes: -30 },
        { message_id_header: null, subject: "r2", minutes: -40 },
      ];
      for (const mail of older) {
        await insertTestEmail(trx, ctx, mailboxId, {
          thread_key: thread,
          message_id_header: mail.message_id_header,
          subject: mail.subject,
          received_at: minutesFromNow(mail.minutes),
        });
      }

      const synthetic = await listThreadContext(trx, ctx, mailboxId, thread, now, current, { syntheticOnly: true });
      expect(synthetic.map((row) => row.subject)).toEqual(["s1", "s2"]);
      const all = await listThreadContext(trx, ctx, mailboxId, thread, now, current, { syntheticOnly: false });
      expect(all.map((row) => row.subject)).toEqual(["s1", "r1", "s2"]);
    });
  });
});
