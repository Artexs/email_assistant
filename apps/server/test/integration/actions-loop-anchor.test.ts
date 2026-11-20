import { randomUUID } from "node:crypto";

import { MINUTE_MS, HOUR_MS, DAY_MS } from "@ea/core";
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
  getAnySend,
  getDraft,
  getSend,
  getSetSend,
  listActionsForEmails,
  listApprovalSends,
  listExpiredApprovals,
  listFailedFollowUps,
  listFailedUnnotified,
  listFollowUpLimitHolds,
  listRecentSends,
  listSendLimitHolds,
  listSendResultsToNotify,
  listSendsToNotify,
  listSetSends,
  listSetsToNotify,
  lockAnySend,
  lockDraft,
  lockSend,
  noDelegationHooks,
  type ClaimFilter,
} from "../../src/modules/actions";
import { countApprovals, listAwaitingSendIds, listUnseenApprovalSends } from "../../src/modules/actions/repo";
import { insertMailbox } from "../../src/modules/mail/repo";
import { findOpenActions } from "../../src/modules/privacy/dsr-match";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertDraftAndSend, pauseOtherMailboxes, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertLoopActionPair, insertLoopRow } from "./loops-fixtures";

// Loop-anchored actions: an
// action that hangs on a loop has no mail. The claim, the draft lookups and the send limits are open for it, and
// the readers of cards, lists, notices and the expiry are open for it too. The approval set readers stay mail-only on purpose (a follow-up
// is one card), and the failure notice of a mail action stays mail-only (a follow-up has its own, see `listFailedFollowUps`).
// Each test puts a loop pair and a mail pair in organization A and a mail pair in organization B, on one connection
// without a tenant scope: a missing `org_id` filter would show the rows of the other organization.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const NOW = new Date("2026-11-20T12:00:00Z");
const STALE_BEFORE = new Date(NOW.getTime() - 10 * MINUTE_MS);
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

describe("a loop-anchored pair and the readers of cards, lists and notices", () => {
  test("claim (stage 10): the draft and the approved send of a loop are claimed, with the mailbox of the loop", async () => {
    await withRollback(db, async (trx) => {
      const a = await side(trx);
      const b = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      const loopOfB = await insertLoopRow(trx, b, b.mailboxId);
      const waiting = await insertLoopActionPair(trx, a, loopId, { createdAt: ago(HOUR_MS) });
      const approved = await insertLoopActionPair(trx, a, loopId, {
        draftStatus: "applied",
        sendStatus: "approved",
        createdAt: ago(HOUR_MS),
        send: { approved_at: ago(HOUR_MS), approved_by: a.userId, approved_via: "telegram" },
      });
      const theirLoop = await insertLoopActionPair(trx, b, loopOfB, { createdAt: ago(HOUR_MS) });
      const mine = await insertDraftAndSend(trx, a.ctx, a.mailboxId, { draftStatus: "ready", createdAt: ago(HOUR_MS) });
      const theirs = await insertDraftAndSend(trx, b.ctx, b.mailboxId, {
        draftStatus: "ready",
        createdAt: ago(HOUR_MS),
      });

      const claimed = await claimActions(trx, a.ctx, a.mailboxId, { ...CLAIM, limit: 50 });
      // The draft of the waiting loop send, the approved loop send and the mail draft. The waiting loop send is not claimed.
      expect(claimed.map((row) => row.id).sort()).toEqual([waiting.draftId, approved.sendId, mine.draftId].sort());
      for (const row of claimed.filter((entry) => entry.loop_id !== null)) {
        expect(row).toMatchObject({ email_id: null, email: null, loop_id: loopId, mailbox_id: a.mailboxId });
      }
      expect(claimed.find((row) => row.id === mine.draftId)).toMatchObject({ loop_id: null, mailbox_id: a.mailboxId });
      const forB = await claimActions(trx, b.ctx, b.mailboxId, { ...CLAIM, limit: 50 });
      expect(forB.map((row) => row.id).sort()).toEqual([theirLoop.draftId, theirs.draftId].sort());
      expect(await countHeldSends(trx, a.ctx, a.mailboxId, { send: { kind: "none" } })).toBe(1);
    });
  });

  test("claim (stage 10): the actions of another mailbox of the same organization are not claimed", async () => {
    await withRollback(db, async (trx) => {
      const a = await side(trx);
      const siblingId = randomUUID();
      await insertMailbox(trx, a.ctx, {
        id: siblingId,
        address: `sibling-${siblingId}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: { drafts: "Drafts" },
      });
      const mineLoop = await insertLoopRow(trx, a, a.mailboxId);
      const siblingLoop = await insertLoopRow(trx, a, siblingId);
      const mine = await insertLoopActionPair(trx, a, mineLoop, { createdAt: ago(HOUR_MS) });
      const sibling = await insertLoopActionPair(trx, a, siblingLoop, { createdAt: ago(HOUR_MS) });
      const mailOfSibling = await insertDraftAndSend(trx, a.ctx, siblingId, {
        draftStatus: "ready",
        createdAt: ago(HOUR_MS),
      });
      const claimed = await claimActions(trx, a.ctx, a.mailboxId, { ...CLAIM, limit: 50 });
      expect(claimed.map((row) => row.id)).toEqual([mine.draftId]);
      expect((await countClaimable(trx, a.ctx, siblingId, CLAIM)).total).toBe(2);
      const forSibling = await claimActions(trx, a.ctx, siblingId, { ...CLAIM, limit: 50 });
      expect(forSibling.map((row) => row.id).sort()).toEqual([sibling.draftId, mailOfSibling.draftId].sort());
    });
  });

  test("claim count (stage 10): the loop draft and the mail draft count", async () => {
    await withRollback(db, async (trx) => {
      const a = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      await insertLoopActionPair(trx, a, loopId, { createdAt: ago(HOUR_MS) });
      await insertDraftAndSend(trx, a.ctx, a.mailboxId, { draftStatus: "ready", createdAt: ago(HOUR_MS) });
      expect((await countClaimable(trx, a.ctx, a.mailboxId, CLAIM)).total).toBe(2);
    });
  });

  test("held sends (stage 10): an approved loop send with an applied draft is held like a mail send", async () => {
    await withRollback(db, async (trx) => {
      const a = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      await insertLoopActionPair(trx, a, loopId, {
        draftStatus: "applied",
        sendStatus: "approved",
        send: { approved_at: ago(HOUR_MS), approved_by: a.userId, approved_via: "telegram" },
      });
      await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "approved",
        approved: { userId: a.userId, at: ago(HOUR_MS) },
      });
      expect(await countHeldSends(trx, a.ctx, a.mailboxId, { send: { kind: "none" } })).toBe(2);
    });
  });

  test("approvals (stage 11): the list, the nav count and the /status count include the loop send", async () => {
    await withRollback(db, async (trx) => {
      const a = await side(trx);
      const b = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      const loopSend = await insertLoopActionPair(trx, a, loopId, { draftStatus: "applied", createdAt: ago(HOUR_MS) });
      const mine = await insertDraftAndSend(trx, a.ctx, a.mailboxId, { createdAt: ago(2 * HOUR_MS) });
      const theirs = await insertDraftAndSend(trx, b.ctx, b.mailboxId, { createdAt: ago(HOUR_MS) });

      const list = await listApprovalSends(trx, a.ctx, { staleBefore: STALE_BEFORE, limit: 100 });
      // Newest first: the loop send (1 h old) before the mail send (2 h old).
      expect(list.map((send) => send.id)).toEqual([loopSend.sendId, mine.sendId]);
      expect(list[0]).toMatchObject({ email_id: null, email: null, loop_id: loopId, mailbox_id: a.mailboxId });
      expect(list[1]).toMatchObject({ loop_id: null, mailbox_id: a.mailboxId });
      expect((await listApprovalSends(trx, b.ctx, { staleBefore: STALE_BEFORE, limit: 100 })).map((s) => s.id)).toEqual(
        [theirs.sendId]
      );
      expect(await countWaitingApprovals(trx, a.ctx)).toBe(2);
      expect(await countWaitingApprovals(trx, b.ctx)).toBe(1);
      const status = await countApprovals(trx, a.ctx, { send: { kind: "all" } });
      expect(status.waiting).toBe(2);
      const byMailbox = await countApprovals(trx, a.ctx, { send: { kind: "all" }, mailboxId: a.mailboxId });
      expect(byMailbox.waiting).toBe(2);
      // The mailbox filter follows the loop: another mailbox of the organization has none.
      const sibling = randomUUID();
      await insertMailbox(trx, a.ctx, {
        id: sibling,
        address: `sibling-${sibling}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: { drafts: "Drafts" },
      });
      expect((await countApprovals(trx, a.ctx, { send: { kind: "all" }, mailboxId: sibling })).waiting).toBe(0);
    });
  });

  test("cards (stage 11): the send and result readers list a loop send; the set readers never do", async () => {
    await withRollback(db, async (trx) => {
      const a = await side(trx);
      const b = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      const setId = "11111111-1111-4111-8111-111111111111";
      const single = await insertLoopActionPair(trx, a, loopId, {
        draftStatus: "applied",
        createdAt: ago(3 * HOUR_MS),
      });
      // A forged `set_id` on a follow-up: it is still one card and never part of a set.
      const forged = await insertLoopActionPair(trx, a, loopId, {
        draftStatus: "applied",
        setId,
        createdAt: ago(2 * HOUR_MS),
      });
      const ended = await insertLoopActionPair(trx, a, loopId, {
        draftStatus: "applied",
        sendStatus: "expired",
        createdAt: ago(HOUR_MS),
      });
      // A failed follow-up is told by the fixed failure notice (`listFailedFollowUps`), never by a result line.
      const failedLoop = await insertLoopActionPair(trx, a, loopId, {
        draftStatus: "applied",
        sendStatus: "failed",
        createdAt: ago(HOUR_MS),
        send: { status_reason: "outcome_unknown" },
      });
      const mine = await insertDraftAndSend(trx, a.ctx, a.mailboxId, { createdAt: ago(HOUR_MS) });
      const mineSet = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        setId: "22222222-2222-4222-8222-222222222222",
        createdAt: ago(HOUR_MS),
      });
      const done = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "expired",
        createdAt: ago(HOUR_MS),
      });
      const theirs = await insertDraftAndSend(trx, b.ctx, b.mailboxId, { createdAt: ago(HOUR_MS) });

      const cards = await listSendsToNotify(trx, a.ctx, { limit: 50 });
      expect(cards.map((send) => send.id).sort()).toEqual([single.sendId, forged.sendId, mine.sendId].sort());
      expect((await listSendsToNotify(trx, b.ctx, { limit: 50 })).map((send) => send.id)).toEqual([theirs.sendId]);

      const sets = await listSetsToNotify(trx, a.ctx, { limit: 50 });
      expect([...sets.keys()]).toEqual(["22222222-2222-4222-8222-222222222222"]);
      expect(sets.get("22222222-2222-4222-8222-222222222222")?.map((send) => send.id)).toEqual([mineSet.sendId]);
      expect(await listSetSends(trx, a.ctx, setId)).toEqual([]);
      expect(await getSetSend(trx, a.ctx, setId)).toBeUndefined();

      const results = await listSendResultsToNotify(trx, a.ctx, {
        limit: 50,
        now: NOW,
        pendingCopyMaxAgeMs: HOUR_MS,
      });
      expect(results.map((send) => send.id).sort()).toEqual([ended.sendId, done.sendId].sort());
      expect(await listFailedFollowUps(trx, a.ctx, { limit: 50 })).toEqual([
        { id: failedLoop.sendId, loopId, unknown: true, updatedAt: expect.any(Date) },
      ]);
      expect(await listFailedFollowUps(trx, b.ctx, { limit: 50 })).toEqual([]);
    });
  });

  test("a failed reverse draft of a loop gets no mail failure notice; a held loop send is in its own list", async () => {
    await withRollback(db, async (trx) => {
      const a = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      const loop = await insertLoopActionPair(trx, a, loopId, {
        draftStatus: "applied",
        sendStatus: "approved",
        send: {
          approved_at: ago(HOUR_MS),
          approved_by: a.userId,
          approved_via: "telegram",
          last_error: "send_limit:hourly",
          next_attempt_at: new Date(NOW.getTime() + HOUR_MS),
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
        approved: { userId: a.userId, at: ago(HOUR_MS) },
      });
      await trx
        .updateTable("actions")
        .set({ last_error: "send_limit:hourly", next_attempt_at: new Date(NOW.getTime() + HOUR_MS) })
        .where("id", "=", mail.sendId)
        .execute();

      expect(await listFailedUnnotified(trx, a.ctx, { limit: 50 })).toEqual([]);
      // The mail hold and the follow-up hold are two lists: each has its own notice.
      const holds = await listSendLimitHolds(trx, a.ctx, NOW);
      expect(holds).toHaveLength(1);
      expect(holds[0]?.waiting).toBe(1);
      const followUpHolds = await listFollowUpLimitHolds(trx, a.ctx, NOW);
      expect(followUpHolds).toHaveLength(1);
      expect(followUpHolds[0]).toMatchObject({ mailboxId: a.mailboxId, waiting: 1, lastError: "send_limit:hourly" });
    });
  });

  test("send limits (stage 10): a started loop send counts in the recent sends of its mailbox, with its Cc", async () => {
    await withRollback(db, async (trx) => {
      const a = await side(trx);
      const b = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      const loopOfB = await insertLoopRow(trx, b, b.mailboxId);
      const started = {
        approved_at: ago(HOUR_MS),
        approved_by: a.userId,
        approved_via: "telegram",
        applied_at: ago(HOUR_MS),
        send_started_at: ago(HOUR_MS),
      };
      await insertLoopActionPair(trx, a, loopId, {
        draftStatus: "applied",
        sendStatus: "applied",
        payloads: {
          draft: { kind: "follow_up" },
          send: { kind: "follow_up", to: ["to@x.test"], cc: ["cc1@x.test", "cc2@x.test"], loop_id: loopId },
        },
        send: started,
      });
      await insertLoopActionPair(trx, b, loopOfB, {
        draftStatus: "applied",
        sendStatus: "applied",
        send: { ...started, approved_by: b.userId },
      });
      await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "applying",
        approved: { userId: a.userId, at: ago(HOUR_MS) },
      });
      await trx
        .updateTable("actions")
        .set({ send_started_at: ago(HOUR_MS) })
        .where("status", "=", "applying")
        .execute();
      const recent = await listRecentSends(trx, a.ctx, a.mailboxId, ago(DAY_MS));
      expect(recent).toHaveLength(2);
      expect(recent.some((send) => send.to.join(",") === "to@x.test,cc1@x.test,cc2@x.test")).toBe(true);
      // The other organization's loop send is not counted here, and ours is not counted there.
      expect(await listRecentSends(trx, b.ctx, b.mailboxId, ago(DAY_MS))).toHaveLength(1);
      expect(await listRecentSends(trx, a.ctx, b.mailboxId, ago(DAY_MS))).toHaveLength(0);
    });
  });

  test("by id (stage 11): a loop draft and a loop send are found by their ids, with their mailbox", async () => {
    await withRollback(db, async (trx) => {
      const a = await side(trx);
      const b = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      const loop = await insertLoopActionPair(trx, a, loopId, { draftStatus: "applied" });
      const mine = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {});
      expect(await getSend(trx, a.ctx, loop.sendId)).toMatchObject({
        email_id: null,
        email: null,
        loop_id: loopId,
        mailbox_id: a.mailboxId,
      });
      expect(await lockSend(trx, a.ctx, loop.sendId)).toMatchObject({ email: null, loop_id: loopId });
      expect(await getSend(trx, b.ctx, loop.sendId)).toBeUndefined();
      expect(await lockSend(trx, b.ctx, loop.sendId)).toBeUndefined();
      expect(await getDraft(trx, a.ctx, loop.draftId)).toMatchObject({ email_id: null, loop_id: loopId });
      expect(await lockDraft(trx, a.ctx, loop.draftId)).toMatchObject({ email_id: null, loop_id: loopId });
      expect(await getAnySend(trx, a.ctx, loop.sendId)).toMatchObject({
        email_id: null,
        loop_id: loopId,
        mailbox_id: a.mailboxId,
      });
      expect(await lockAnySend(trx, a.ctx, loop.sendId)).toMatchObject({ loop_id: loopId });
      expect(await getAnySend(trx, a.ctx, mine.sendId)).toMatchObject({ loop_id: null, email_id: mine.emailId });
      expect((await getSend(trx, a.ctx, mine.sendId))?.id).toBe(mine.sendId);
      // The tenant filter holds for every lookup.
      expect(await getSend(trx, b.ctx, mine.sendId)).toBeUndefined();
      expect(await getDraft(trx, b.ctx, mine.draftId)).toBeUndefined();
      expect(await getDraft(trx, b.ctx, loop.draftId)).toBeUndefined();
      expect(await getAnySend(trx, b.ctx, loop.sendId)).toBeUndefined();
      expect(await lockAnySend(trx, b.ctx, mine.sendId)).toBeUndefined();
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

describe("a loop-anchored pair and the 48 hour job", () => {
  const request = { delegationId: "33333333-3333-4333-8333-333333333333", draftProviderResult: APPLIED };

  test("the lists: the loop pair is due like the mail pair, in the mailbox of its loop", async () => {
    await withRollback(db, async (trx) => {
      const a = await side(trx);
      const b = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      // Old and never notified: due for `not_notified`.
      const oldLoop = await insertLoopActionPair(trx, a, loopId, {
        draftStatus: "applied",
        createdAt: ago(8 * DAY_MS),
      });
      // Notified long ago, the request unseen: due for `not_seen`.
      const unseenLoop = await insertLoopActionPair(trx, a, loopId, {
        draftStatus: "applied",
        createdAt: ago(5 * DAY_MS),
        notifiedAt: ago(3 * DAY_MS),
      });
      const mine = await insertDraftAndSend(trx, a.ctx, a.mailboxId, { ...request, createdAt: ago(8 * DAY_MS) });
      const unseen = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        ...request,
        createdAt: ago(5 * DAY_MS),
        notifiedAt: ago(3 * DAY_MS),
      });
      const theirs = await insertDraftAndSend(trx, b.ctx, b.mailboxId, { ...request, createdAt: ago(8 * DAY_MS) });

      const due = await listExpiredApprovals(trx, a.ctx, a.mailboxId, {
        now: NOW,
        limit: 100,
        staleBefore: STALE_BEFORE,
      });
      expect(due.map((row) => [row.id, row.reason]).sort()).toEqual(
        [
          [mine.sendId, "not_notified"],
          [unseen.sendId, "not_seen"],
          [oldLoop.sendId, "not_notified"],
          [unseenLoop.sendId, "not_seen"],
        ].sort()
      );
      const unseenList = await listUnseenApprovalSends(trx, a.ctx, { before: ago(HOUR_MS) });
      expect(unseenList.map((row) => [row.id, row.mailboxId]).sort()).toEqual(
        [
          [unseen.sendId, a.mailboxId],
          [unseenLoop.sendId, a.mailboxId],
        ].sort()
      );
      const awaiting = await listAwaitingSendIds(trx, a.ctx, a.mailboxId);
      expect(awaiting.map((row) => row.id).sort()).toEqual(
        [mine.sendId, unseen.sendId, oldLoop.sendId, unseenLoop.sendId].sort()
      );
      // A follow-up has no mail: the narrow-by-mail filter never matches it.
      expect(
        (await listAwaitingSendIds(trx, a.ctx, a.mailboxId, { emailId: mine.emailId })).map((row) => row.id)
      ).toEqual([mine.sendId]);
      expect(awaiting.find((row) => row.id === oldLoop.sendId)?.emailId).toBeNull();
      const forB = await listExpiredApprovals(trx, b.ctx, b.mailboxId, {
        now: NOW,
        limit: 100,
        staleBefore: STALE_BEFORE,
      });
      expect(forB.map((row) => row.id)).toEqual([theirs.sendId]);
    });
  });

  test("the job closes the mail send and the loop send", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await side(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      const loop = await insertLoopActionPair(trx, a, loopId, { draftStatus: "applied", createdAt: ago(8 * DAY_MS) });
      const mine = await insertDraftAndSend(trx, a.ctx, a.mailboxId, { ...request, createdAt: ago(8 * DAY_MS) });

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
      expect(statusOf(loop.sendId)).toBe("expired");
      const audit = await trx
        .selectFrom("audit_log")
        .select(["event", "reason_code", "data"])
        .where("action_id", "=", loop.sendId)
        .execute();
      expect(audit).toEqual([
        {
          event: "action.expired",
          reason_code: "not_notified",
          data: { action_type: "send", reason: "not_notified", loop_id: loopId },
        },
      ]);
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
