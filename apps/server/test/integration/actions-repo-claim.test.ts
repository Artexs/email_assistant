import { MINUTE_MS, HOUR_MS, DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import {
  CLAIM_MAX_AGE_MS,
  claimActions,
  countClaimable,
  expireStaleReady,
  finishAction,
  listActionsForEmails,
  releaseAction,
  releaseActions,
} from "../../src/modules/actions";
import { NO_TEST_SENDERS } from "../../src/modules/mail";

import {
  createTwoTenants,
  NOW,
  STALE_BEFORE,
  ALL,
  ago,
  claimOpts,
  countOpts,
  actionState,
  ready,
} from "./actions-repo-helpers";
import { createOrgWithMailbox, insertAction, insertDraftAndSend, insertTriagedWithActions } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("claimActions", () => {
  test("orders by received_at, email id and type rank; locked_at = now; a second claim returns nothing", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const newer = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        receivedAt: ago(HOUR_MS),
        actions: [ready("move"), ready("flag"), ready("save_summary"), ready("mark_read")],
      });
      const older = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(2 * HOUR_MS),
        receivedAt: ago(2 * HOUR_MS),
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
        createdAt: ago(HOUR_MS),
        actions: [ready("flag")],
      });
      const second = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
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
        createdAt: ago(2 * HOUR_MS),
        messageId: "<seed-1@ea-seed.test>",
        actions: [ready("flag"), ready("save_summary")],
      });
      const real = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        messageId: "<real-1@example.com>",
        actions: [ready("flag"), ready("save_summary")],
      });
      const summed = (rows: { email_id: string | null; type: string }[]) =>
        rows.map((row) => `${row.email_id === synthetic.emailId ? "syn" : "real"}:${row.type}`).sort();

      expect(summed(await claimActions(trx, a.ctx, a.mailboxId, claimOpts({ kind: "none" })))).toEqual([
        "real:save_summary",
        "syn:save_summary",
      ]);
      await trx.updateTable("actions").set({ locked_at: null }).execute();
      expect(
        summed(await claimActions(trx, a.ctx, a.mailboxId, claimOpts({ kind: "synthetic", testMail: NO_TEST_SENDERS })))
      ).toEqual(["real:save_summary", "syn:flag", "syn:save_summary"]);
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

  test("filter synthetic with a test sender rule claims a planned move from that sender only", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const fromTestSender = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(2 * HOUR_MS),
        messageId: "<t-1@ses.test>",
        from: "T@a.test",
        actions: [ready("move")],
      });
      await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        messageId: "<b-1@firma.test>",
        from: "boss@firma.test",
        actions: [ready("move")],
      });
      const claimed = await claimActions(
        trx,
        a.ctx,
        a.mailboxId,
        claimOpts({ kind: "synthetic", testMail: { senders: ["t@a.test"] } })
      );
      expect(claimed.map((row) => `${row.type}:${row.email_id}`)).toEqual([`move:${fromTestSender.emailId}`]);
    });
  });

  test("next_attempt_at in the future and a fresh lock are skipped; a stale lock is claimed", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        actions: [],
      });
      const waiting = await insertAction(trx, a.ctx, mail.emailId, {
        ...ready("flag"),
        nextAttemptAt: new Date(NOW.getTime() + MINUTE_MS),
        createdAt: ago(HOUR_MS),
      });
      const fresh = await insertAction(trx, a.ctx, mail.emailId, {
        ...ready("mark_read"),
        lockedAt: ago(MINUTE_MS),
        createdAt: ago(HOUR_MS),
      });
      const stale = await insertAction(trx, a.ctx, mail.emailId, {
        ...ready("move"),
        lockedAt: ago(20 * MINUTE_MS),
        createdAt: ago(HOUR_MS),
      });
      const due = await insertAction(trx, a.ctx, mail.emailId, {
        ...ready("save_summary"),
        nextAttemptAt: ago(MINUTE_MS),
        createdAt: ago(HOUR_MS),
      });

      expect(await countClaimable(trx, a.ctx, a.mailboxId, countOpts())).toEqual({
        total: 2,
        mailboxChanging: 1,
        sending: 0,
      });
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
        createdAt: ago(8 * DAY_MS),
        receivedAt: ago(8 * DAY_MS),
        actions: [],
      });
      await insertAction(trx, a.ctx, old.emailId, { ...ready("move"), createdAt: NOW });
      const summary = await insertAction(trx, a.ctx, old.emailId, { ...ready("save_summary"), createdAt: NOW });
      const applied = await insertAction(trx, a.ctx, old.emailId, {
        type: "flag",
        status: "applied",
        createdAt: ago(DAY_MS),
      });
      const reverse = await insertAction(trx, a.ctx, old.emailId, {
        ...ready("flag"),
        reversesActionId: applied,
        createdAt: ago(3 * DAY_MS),
      });

      expect(await countClaimable(trx, a.ctx, a.mailboxId, countOpts())).toEqual({
        total: 2,
        mailboxChanging: 1,
        sending: 0,
      });
      const claimed = await claimActions(trx, a.ctx, a.mailboxId, claimOpts());
      expect(claimed.map((row) => row.id).sort()).toEqual([summary, reverse].sort());
    });
  });

  test("the 25-hour-old original move is never claimed", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        actions: [],
      });
      await insertAction(trx, a.ctx, mail.emailId, { ...ready("move"), createdAt: ago(CLAIM_MAX_AGE_MS + HOUR_MS) });
      expect(await claimActions(trx, a.ctx, a.mailboxId, claimOpts())).toEqual([]);
      expect(await countClaimable(trx, a.ctx, a.mailboxId, countOpts())).toEqual({
        total: 0,
        mailboxChanging: 0,
        sending: 0,
      });
    });
  });
});

describe("tenant filter", () => {
  test("org B's context sees nothing of org A", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        actions: [ready("flag"), ready("move")],
      });
      const [flag, move] = mail.actionIds as [string, string];
      await insertAction(trx, a.ctx, mail.emailId, { ...ready("move"), createdAt: ago(25 * HOUR_MS) });

      // org B asks for org A's mailbox
      expect(await countClaimable(trx, b.ctx, a.mailboxId, countOpts())).toEqual({
        total: 0,
        mailboxChanging: 0,
        sending: 0,
      });
      expect(await claimActions(trx, b.ctx, a.mailboxId, claimOpts())).toEqual([]);
      expect(await expireStaleReady(trx, b.ctx, a.mailboxId, { now: NOW, staleBefore: STALE_BEFORE })).toEqual([]);
      expect((await listActionsForEmails(trx, b.ctx, [mail.emailId], new Date())).size).toBe(0);

      await trx.updateTable("actions").set({ locked_at: NOW }).where("id", "in", [flag, move]).execute();
      expect(await finishAction(trx, b.ctx, flag, NOW, { status: "applied", at: NOW })).toBe(false);
      expect(
        await releaseAction(trx, b.ctx, flag, NOW, {
          toStatus: "ready",
          nextAttemptAt: null,
          countAttempt: true,
          now: NOW,
        })
      ).toBe(false);
      expect(await releaseActions(trx, b.ctx, [flag, move], NOW, NOW)).toBe(0);
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
            createdAt: ago((n + 1) * HOUR_MS),
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

describe("countClaimable: drafts and sends", () => {
  test("mailboxChanging counts drafts; sending counts sends", async () => {
    await withRollback(db, async (trx) => {
      const created = await createOrgWithMailbox(trx);
      const a = { ctx: { orgId: created.orgId }, mailboxId: created.mailboxId };
      const owner = { id: created.userId };
      await insertDraftAndSend(trx, a.ctx, a.mailboxId, { draftStatus: "ready", createdAt: ago(HOUR_MS) });
      await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "approved",
        approved: { userId: owner.id, at: ago(MINUTE_MS) },
        createdAt: ago(HOUR_MS),
      });
      await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        actions: [ready("move"), ready("save_summary")],
      });
      expect(await countClaimable(trx, a.ctx, a.mailboxId, countOpts())).toEqual({
        total: 4,
        mailboxChanging: 2,
        sending: 1,
      });
    });
  });
});
