import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  ActionAnchorError,
  anchorOfRow,
  claimActions,
  countClaimable,
  countHeldSends,
  countWaitingApprovals,
  createExpiryJob,
  emailIdOf,
  getDraft,
  getSend,
  listActionsForEmails,
  listApprovalSends,
  listExpiredApprovals,
  listFailedUnnotified,
  listRecentSends,
  listSendLimitHolds,
  listSendResultsToNotify,
  listSendsToNotify,
  listSetsToNotify,
  lockDraft,
  lockSend,
  noDelegationHooks,
  type ClaimFilter,
} from "../../src/modules/actions";
import { countApprovals, listAwaitingSendIds, listUnseenApprovalSends } from "../../src/modules/actions/repo";
import { findOpenActions } from "../../src/modules/privacy/dsr-match";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertDraftAndSend, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertLoopActionPair, insertLoopRow } from "./loops-fixtures";

// Stage 9 of the open loops feature (spec/features/active/F116-e5b-open-loops/stages/stage-09-action-anchor.md): an
// action that hangs on a loop has no mail. Until the follow-up stages open the paths, no reader of mail may see it.
// Each test puts a loop pair and a mail pair in organization A and a mail pair in organization B, on one connection
// without a tenant scope: a missing `org_id` filter would show the rows of the other organization.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const NOW = new Date("2026-11-20T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const STALE_BEFORE = new Date(NOW.getTime() - 10 * 60_000);
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const FILTER: ClaimFilter = { mailbox: { kind: "all" }, send: { kind: "all" } };
const CLAIM = { now: NOW, staleBefore: STALE_BEFORE, filter: FILTER };
const APPLIED = { folder: "Drafts", uid: 7 };

interface Side {
  orgId: string;
  userId: string;
  mailboxId: string;
  ctx: { orgId: string };
}

async function side(trx: Trx): Promise<Side> {
  const o = await createOrgWithMailbox(trx);
  return { ...o, ctx: { orgId: o.orgId } };
}

describe("a loop-anchored pair is invisible to the readers of mail", () => {
  test("claim: the draft and the approved send of a loop are not claimed or counted", async () => {
    await withRollback(db, async (trx) => {
      const a = await side(trx);
      const b = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      await insertLoopActionPair(trx, a, loopId, { createdAt: ago(HOUR) });
      await insertLoopActionPair(trx, a, loopId, {
        draftStatus: "applied",
        sendStatus: "approved",
        createdAt: ago(HOUR),
        send: { approved_at: ago(HOUR), approved_by: a.userId, approved_via: "telegram" },
      });
      const mine = await insertDraftAndSend(trx, a.ctx, a.mailboxId, { draftStatus: "ready", createdAt: ago(HOUR) });
      const theirs = await insertDraftAndSend(trx, b.ctx, b.mailboxId, { draftStatus: "ready", createdAt: ago(HOUR) });

      const claimed = await claimActions(trx, a.ctx, a.mailboxId, { ...CLAIM, limit: 50 });
      expect(claimed.map((row) => row.id)).toEqual([mine.draftId]);
      const counts = await countClaimable(trx, a.ctx, a.mailboxId, CLAIM);
      expect(counts.total).toBe(0); // the control draft is locked by the claim above
      const forB = await claimActions(trx, b.ctx, b.mailboxId, { ...CLAIM, limit: 50 });
      expect(forB.map((row) => row.id)).toEqual([theirs.draftId]);
      const heldFilter = { kind: "none" } as const;
      expect(await countHeldSends(trx, a.ctx, a.mailboxId, { send: heldFilter })).toBe(0);
    });
  });

  test("claim count: only the mail pair counts", async () => {
    await withRollback(db, async (trx) => {
      const a = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      await insertLoopActionPair(trx, a, loopId, { createdAt: ago(HOUR) });
      await insertDraftAndSend(trx, a.ctx, a.mailboxId, { draftStatus: "ready", createdAt: ago(HOUR) });
      expect((await countClaimable(trx, a.ctx, a.mailboxId, CLAIM)).total).toBe(1);
    });
  });

  test("held sends: an approved loop send with an applied draft is not held", async () => {
    await withRollback(db, async (trx) => {
      const a = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      await insertLoopActionPair(trx, a, loopId, {
        draftStatus: "applied",
        sendStatus: "approved",
        send: { approved_at: ago(HOUR), approved_by: a.userId, approved_via: "telegram" },
      });
      await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "approved",
        approved: { userId: a.userId, at: ago(HOUR) },
      });
      expect(await countHeldSends(trx, a.ctx, a.mailboxId, { send: { kind: "none" } })).toBe(1);
    });
  });

  test("approvals: the list, the nav count and the /status count leave the loop send out", async () => {
    await withRollback(db, async (trx) => {
      const a = await side(trx);
      const b = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      await insertLoopActionPair(trx, a, loopId, { draftStatus: "applied", createdAt: ago(HOUR) });
      const mine = await insertDraftAndSend(trx, a.ctx, a.mailboxId, { createdAt: ago(2 * HOUR) });
      const theirs = await insertDraftAndSend(trx, b.ctx, b.mailboxId, { createdAt: ago(HOUR) });

      const list = await listApprovalSends(trx, a.ctx, { staleBefore: STALE_BEFORE, limit: 100 });
      expect(list.map((send) => send.id)).toEqual([mine.sendId]);
      expect((await listApprovalSends(trx, b.ctx, { staleBefore: STALE_BEFORE, limit: 100 })).map((s) => s.id)).toEqual(
        [theirs.sendId]
      );
      expect(await countWaitingApprovals(trx, a.ctx)).toBe(1);
      expect(await countWaitingApprovals(trx, b.ctx)).toBe(1);
      const status = await countApprovals(trx, a.ctx, { send: { kind: "all" } });
      expect(status.waiting).toBe(1);
      const byMailbox = await countApprovals(trx, a.ctx, { send: { kind: "all" }, mailboxId: a.mailboxId });
      expect(byMailbox.waiting).toBe(1);
    });
  });

  test("cards: the send, set and result detectors leave the loop send out", async () => {
    await withRollback(db, async (trx) => {
      const a = await side(trx);
      const b = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      const setId = "11111111-1111-4111-8111-111111111111";
      await insertLoopActionPair(trx, a, loopId, { draftStatus: "applied", createdAt: ago(HOUR) });
      await insertLoopActionPair(trx, a, loopId, { draftStatus: "applied", setId, createdAt: ago(HOUR) });
      await insertLoopActionPair(trx, a, loopId, {
        draftStatus: "applied",
        sendStatus: "expired",
        createdAt: ago(HOUR),
      });
      const mine = await insertDraftAndSend(trx, a.ctx, a.mailboxId, { createdAt: ago(HOUR) });
      const mineSet = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        setId: "22222222-2222-4222-8222-222222222222",
        createdAt: ago(HOUR),
      });
      const done = await insertDraftAndSend(trx, a.ctx, a.mailboxId, { sendStatus: "expired", createdAt: ago(HOUR) });
      const theirs = await insertDraftAndSend(trx, b.ctx, b.mailboxId, { createdAt: ago(HOUR) });

      const single = await listSendsToNotify(trx, a.ctx, { limit: 50 });
      expect(single.map((send) => send.id)).toEqual([mine.sendId]);
      expect((await listSendsToNotify(trx, b.ctx, { limit: 50 })).map((send) => send.id)).toEqual([theirs.sendId]);

      const sets = await listSetsToNotify(trx, a.ctx, { limit: 50 });
      expect([...sets.keys()]).toEqual(["22222222-2222-4222-8222-222222222222"]);
      expect(sets.get("22222222-2222-4222-8222-222222222222")?.map((send) => send.id)).toEqual([mineSet.sendId]);

      const results = await listSendResultsToNotify(trx, a.ctx, {
        limit: 50,
        now: NOW,
        pendingCopyMaxAgeMs: HOUR,
      });
      expect(results.map((send) => send.id)).toEqual([done.sendId]);
    });
  });

  test("a failed reverse draft of a loop gets no failure notice; a send held by a limit is not counted", async () => {
    await withRollback(db, async (trx) => {
      const a = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      const loop = await insertLoopActionPair(trx, a, loopId, {
        draftStatus: "applied",
        sendStatus: "approved",
        send: {
          approved_at: ago(HOUR),
          approved_by: a.userId,
          approved_via: "telegram",
          last_error: "send_limit:hourly",
          next_attempt_at: new Date(NOW.getTime() + HOUR),
        },
      });
      await trx
        .insertInto("actions")
        .values({
          org_id: a.orgId,
          email_id: null,
          loop_id: loopId,
          type: "create_draft",
          status: "failed",
          payload: "{}",
          idempotency_key: "test:reverse-of-loop-draft",
          reverses_action_id: loop.draftId,
        })
        .execute();
      const mail = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "approved",
        approved: { userId: a.userId, at: ago(HOUR) },
      });
      await trx
        .updateTable("actions")
        .set({ last_error: "send_limit:hourly", next_attempt_at: new Date(NOW.getTime() + HOUR) })
        .where("id", "=", mail.sendId)
        .execute();

      expect(await listFailedUnnotified(trx, a.ctx, { limit: 50 })).toEqual([]);
      const holds = await listSendLimitHolds(trx, a.ctx, NOW);
      expect(holds).toHaveLength(1);
      expect(holds[0]?.waiting).toBe(1);
    });
  });

  test("send limits: a started loop send is not in the recent sends of the mailbox (until a later stage counts it)", async () => {
    await withRollback(db, async (trx) => {
      const a = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      await insertLoopActionPair(trx, a, loopId, {
        draftStatus: "applied",
        sendStatus: "applied",
        send: {
          approved_at: ago(HOUR),
          approved_by: a.userId,
          approved_via: "telegram",
          applied_at: ago(HOUR),
          send_started_at: ago(HOUR),
        },
      });
      await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "applying",
        approved: { userId: a.userId, at: ago(HOUR) },
      });
      await trx
        .updateTable("actions")
        .set({ send_started_at: ago(HOUR) })
        .where("status", "=", "applying")
        .execute();
      const recent = await listRecentSends(trx, a.ctx, a.mailboxId, ago(DAY));
      expect(recent).toHaveLength(1);
    });
  });

  test("by id: the lookups of a draft and a send return nothing for a loop row", async () => {
    await withRollback(db, async (trx) => {
      const a = await side(trx);
      const b = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      const loop = await insertLoopActionPair(trx, a, loopId, { draftStatus: "applied" });
      const mine = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {});
      expect(await getSend(trx, a.ctx, loop.sendId)).toBeUndefined();
      expect(await lockSend(trx, a.ctx, loop.sendId)).toBeUndefined();
      expect(await getDraft(trx, a.ctx, loop.draftId)).toBeUndefined();
      expect(await lockDraft(trx, a.ctx, loop.draftId)).toBeUndefined();
      expect((await getSend(trx, a.ctx, mine.sendId))?.id).toBe(mine.sendId);
      expect((await getDraft(trx, a.ctx, mine.draftId))?.id).toBe(mine.draftId);
      // The tenant filter still holds for mail rows.
      expect(await getSend(trx, b.ctx, mine.sendId)).toBeUndefined();
      expect(await getDraft(trx, b.ctx, mine.draftId)).toBeUndefined();
    });
  });

  test("the activity of a mail lists the actions of that mail only", async () => {
    await withRollback(db, async (trx) => {
      const a = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      await insertLoopActionPair(trx, a, loopId);
      const mine = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {});
      const views = await listActionsForEmails(trx, a.ctx, [mine.emailId], NOW);
      expect([...views.keys()]).toEqual([mine.emailId]);
      expect(
        views
          .get(mine.emailId)
          ?.map((view) => view.type)
          .sort()
      ).toEqual(["create_draft", "send"]);
    });
  });
});

describe("a loop-anchored pair is not expired by the 48 hour job", () => {
  const request = { delegationId: "33333333-3333-4333-8333-333333333333", draftProviderResult: APPLIED };

  test("the lists: only the mail pair is due", async () => {
    await withRollback(db, async (trx) => {
      const a = await side(trx);
      const b = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      // Old and never notified: due for `not_notified` when it hangs on a mail.
      await insertLoopActionPair(trx, a, loopId, { draftStatus: "applied", createdAt: ago(8 * DAY) });
      // Notified long ago, the request unseen: due for `not_seen` when it hangs on a mail.
      await insertLoopActionPair(trx, a, loopId, {
        draftStatus: "applied",
        createdAt: ago(5 * DAY),
        notifiedAt: ago(3 * DAY),
      });
      const mine = await insertDraftAndSend(trx, a.ctx, a.mailboxId, { ...request, createdAt: ago(8 * DAY) });
      const unseen = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        ...request,
        createdAt: ago(5 * DAY),
        notifiedAt: ago(3 * DAY),
      });
      const theirs = await insertDraftAndSend(trx, b.ctx, b.mailboxId, { ...request, createdAt: ago(8 * DAY) });

      const due = await listExpiredApprovals(trx, a.ctx, a.mailboxId, {
        now: NOW,
        limit: 100,
        staleBefore: STALE_BEFORE,
      });
      expect(due.map((row) => row.id).sort()).toEqual([mine.sendId, unseen.sendId].sort());
      const unseenList = await listUnseenApprovalSends(trx, a.ctx, { before: ago(HOUR) });
      expect(unseenList.map((row) => row.id)).toEqual([unseen.sendId]);
      const awaiting = await listAwaitingSendIds(trx, a.ctx, a.mailboxId);
      expect(awaiting.map((row) => row.id).sort()).toEqual([mine.sendId, unseen.sendId].sort());
      const forB = await listExpiredApprovals(trx, b.ctx, b.mailboxId, {
        now: NOW,
        limit: 100,
        staleBefore: STALE_BEFORE,
      });
      expect(forB.map((row) => row.id)).toEqual([theirs.sendId]);
    });
  });

  test("the job closes the mail send and leaves the loop send awaiting approval", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      const loop = await insertLoopActionPair(trx, a, loopId, { draftStatus: "applied", createdAt: ago(8 * DAY) });
      const mine = await insertDraftAndSend(trx, a.ctx, a.mailboxId, { ...request, createdAt: ago(8 * DAY) });

      await createExpiryJob({
        db: trx,
        now: () => NOW,
        hooks: noDelegationHooks,
        uidplus: async () => true,
      }).run();

      const states = await trx
        .selectFrom("actions")
        .select(["id", "status"])
        .where("id", "in", [loop.sendId, mine.sendId])
        .execute();
      const statusOf = (id: string) => states.find((row) => row.id === id)?.status;
      expect(statusOf(mine.sendId)).toBe("expired");
      expect(statusOf(loop.sendId)).toBe("awaiting_approval");
    });
  });
});

describe("emailIdOf", () => {
  test("T6: it returns the mail of a mail row and throws loop_anchor for a loop row", async () => {
    await withRollback(db, async (trx) => {
      const a = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      const loop = await insertLoopActionPair(trx, a, loopId);
      const mine = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {});
      const rowOf = (id: string) =>
        trx.selectFrom("actions").select(["email_id", "loop_id"]).where("id", "=", id).executeTakeFirstOrThrow();

      const loopRow = await rowOf(loop.sendId);
      expect(anchorOfRow(loopRow)).toEqual({ kind: "loop", loopId });
      let thrown: unknown;
      try {
        emailIdOf(loopRow);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ActionAnchorError);
      expect((thrown as ActionAnchorError).code).toBe("loop_anchor");

      const mailRow = await rowOf(mine.sendId);
      expect(emailIdOf(mailRow)).toBe(mine.emailId);
      expect(anchorOfRow(mailRow)).toEqual({ kind: "email", emailId: mine.emailId });
    });
  });
});

describe("erase of one person's data", () => {
  test("an open action of a loop that names the person stops the erase; a closed one does not", async () => {
    await withRollback(db, async (trx) => {
      const a = await side(trx);
      const b = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      const open = await insertLoopActionPair(trx, a, loopId, { payloadMarker: "person-x@x.test" });
      await insertLoopActionPair(trx, a, loopId, {
        payloadMarker: "person-x@x.test",
        draftStatus: "expired",
        sendStatus: "expired",
      });
      const loopOfB = await insertLoopRow(trx, b, b.mailboxId);
      await insertLoopActionPair(trx, b, loopOfB, { payloadMarker: "person-x@x.test" });

      // The erase names a mail that goes: `email_id = any (goes)` is then NULL for a loop row, not false.
      const goes = await insertDraftAndSend(trx, a.ctx, a.mailboxId, { sendStatus: "expired", draftStatus: "expired" });
      const found = await findOpenActions(trx, a.orgId, "person-x@x\\.test", [goes.emailId], []);
      expect(found.sort()).toEqual([open.draftId, open.sendId].sort());
    });
  });
});
