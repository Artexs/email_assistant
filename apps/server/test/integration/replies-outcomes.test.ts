import { randomUUID } from "node:crypto";

import { replyOutcomeCounts, weekRange, type ReplyOutcomeCounts, type WeekQuery, DAY_MS, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { noApprovalHooks, noDelegationHooks } from "../../src/modules/actions";
import { listUrgentNoticeTimes } from "../../src/modules/channels";
import { insertMailbox } from "../../src/modules/mail/repo";
import { redraftReply, replyOutcomeRows } from "../../src/modules/replies";
import { weekStats } from "../../src/modules/reports";
import type { DB } from "../../src/platform/db";

import { insertAction, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertReplyRequest } from "./reply-fixtures";
import {
  addReplyMail,
  CLEAN_ANSWER,
  draftedReply,
  fakeLlm,
  jobDeps,
  NOW,
  runJob,
  setupBox,
  type Clock,
  type JobBox,
} from "./reply-job-fixtures";

// The outcome counts of the reply drafts of a week: the readers (`replyOutcomeRows`), the pure function and the join in `weekStats`.
// The week is 2026-11-16 (Europe/Warsaw); every pair is made on the Wednesday of it (the fixture NOW) unless a test moves it.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const WEEK = "2026-11-16";
const RANGE = weekRange(WEEK, "Europe/Warsaw");
const clock: Clock = { now: NOW };
const query = (over: Partial<WeekQuery> = {}): WeekQuery => ({
  range: RANGE,
  mailboxId: null,
  testMail: { senders: [] },
  ...over,
});

async function countsOf(trx: Trx, box: JobBox, over: Partial<WeekQuery> = {}): Promise<ReplyOutcomeCounts> {
  return replyOutcomeCounts(await replyOutcomeRows(trx, box.ctx, query(over)));
}

// A drafted reply (version 1) that the test puts into a state: `status` and `reason` of its send, made at `at`.
async function pairIn(
  trx: Trx,
  box: JobBox,
  state: { status: string; reason?: string | null },
  opts: { at?: Date; from?: string } = {}
): Promise<{ emailId: string; sendId: string }> {
  const made = await draftedReply(trx, box, clock, opts.from === undefined ? {} : { from: opts.from });
  await setSend(trx, made.sendId, state, opts.at ?? NOW);
  return made;
}

async function setSend(trx: Trx, sendId: string, state: { status: string; reason?: string | null }, at?: Date) {
  await trx
    .updateTable("actions")
    .set({
      status: state.status,
      status_reason: state.reason ?? null,
      ...(state.status === "applied" ? { applied_at: NOW, approved_at: NOW } : {}),
      ...(at === undefined ? {} : { created_at: at }),
    })
    .where("id", "=", sendId)
    .execute();
}

const deps = (trx: Trx) => ({
  db: trx,
  now: () => NOW,
  hooks: noDelegationHooks,
  approvalHooks: noApprovalHooks,
  uidplus: async () => true,
});

// A pair that was redrafted once: version 2 (a new send that supersedes version 1) is the newest; the test puts version 2 into `state`.
async function redraftedPair(trx: Trx, box: JobBox, state: { status: string; reason?: string | null }, at: Date) {
  const first = await draftedReply(trx, box, clock);
  await setSend(trx, first.sendId, { status: "awaiting_approval" }, at);
  const result = await redraftReply(deps(trx), box.ctx, {
    userId: box.userId,
    via: "web",
    sendId: first.sendId,
    instruction: "say yes",
  });
  expect(result.kind).toBe("queued");
  await runJob(jobDeps(trx, fakeLlm(() => CLEAN_ANSWER).llm, clock), box);
  const second = await trx
    .selectFrom("actions")
    .select("id")
    .where("supersedes_action_id", "=", first.sendId)
    .where("type", "=", "send")
    .executeTakeFirstOrThrow();
  await setSend(trx, second.id, state, new Date(at.getTime() + MINUTE_MS));
  return { first: first.sendId, second: second.id, emailId: first.emailId };
}

describe("replyOutcomeRows and the counts", () => {
  test("1. five pairs (applied, rejected, newer_mail, redrafted then applied, timeout): made 5, sent_by_tap 2, rejected 1, newer_mail 1, expired 1", async () => {
    await withRollback(db, async (trx) => {
      const box = await setupBox(trx);
      await pairIn(trx, box, { status: "applied" });
      await pairIn(trx, box, { status: "rejected" });
      await pairIn(trx, box, { status: "expired", reason: "newer_mail" });
      const chain = await redraftedPair(trx, box, { status: "applied" }, NOW);
      await pairIn(trx, box, { status: "expired", reason: "timeout" });

      const counts = await countsOf(trx, box);
      expect(counts).toMatchObject({
        made: 5,
        sent_by_tap: 2,
        rejected: 1,
        newer_mail: 1,
        expired: 1,
        sent_by_user: 0,
        answered: 0,
        original_moved: 0,
        draft_changed: 0,
        no_draft: 0,
        failed: 0,
      });
      // Version 1 stands in no count: the pair is counted once, as its newest version.
      const version1 = await trx
        .selectFrom("actions")
        .select("status")
        .where("id", "=", chain.first)
        .executeTakeFirstOrThrow();
      expect(version1.status).toBe("expired");
    });
  });

  test("2. every close reason of a send lands in its count, and a waiting pair is only made", async () => {
    await withRollback(db, async (trx) => {
      const box = await setupBox(trx);
      for (const state of [
        { status: "expired", reason: "sent_by_user" },
        { status: "expired", reason: "answered" },
        { status: "expired", reason: "original_moved" },
        { status: "expired", reason: "draft_changed" },
        { status: "expired", reason: "draft_missing" },
        { status: "expired", reason: "policy_changed" },
        { status: "failed" },
        { status: "awaiting_approval" },
      ]) {
        await pairIn(trx, box, state);
      }
      // A send of another kind (a delegation) is no reply pair.
      const other = await addReplyMail(trx, box);
      await insertAction(trx, box.ctx, other, {
        type: "send",
        status: "applied",
        approvedAt: NOW,
        createdAt: NOW,
        payload: { kind: "delegation" },
      });
      expect(await countsOf(trx, box)).toMatchObject({
        made: 8,
        sent_by_user: 1,
        answered: 1,
        original_moved: 1,
        draft_changed: 2,
        failed: 1,
        expired: 0,
        sent_by_tap: 0,
        rejected: 0,
      });
    });
  });

  test("3. the counts hold the own organization only", async () => {
    await withRollback(db, async (trx) => {
      const mine = await setupBox(trx);
      const theirs = await setupBox(trx);
      await pairIn(trx, mine, { status: "applied" });
      await pairIn(trx, theirs, { status: "applied" });
      await pairIn(trx, theirs, { status: "rejected" });
      const request = await addReplyMail(trx, theirs);
      await insertReplyRequest(trx, theirs.ctx, theirs.mailboxId, request, {
        trigger: "tap",
        status: "failed",
        reason_code: "llm_error",
        updated_at: NOW,
      });

      expect(await countsOf(trx, mine)).toMatchObject({ made: 1, sent_by_tap: 1, rejected: 0, failed: 0 });
      expect(await countsOf(trx, theirs)).toMatchObject({ made: 2, sent_by_tap: 1, rejected: 1, failed: 1 });
    });
  });

  test("4. a pair counts in the week where its first version was made; a version made later does not move it", async () => {
    await withRollback(db, async (trx) => {
      const box = await setupBox(trx);
      const before = new Date(RANGE.start.getTime() - DAY_MS);
      const after = new Date(RANGE.end.getTime() + DAY_MS);
      await pairIn(trx, box, { status: "applied" }, { at: before });
      await pairIn(trx, box, { status: "applied" }, { at: after });
      // Made the week before, redrafted in this week: not a pair of this week.
      await redraftedPair(trx, box, { status: "applied" }, before);
      await trx
        .updateTable("actions")
        .set({ created_at: NOW })
        .where("type", "=", "send")
        .where("supersedes_action_id", "is not", null)
        .execute();
      expect(await countsOf(trx, box)).toMatchObject({ made: 0, sent_by_tap: 0 });

      const previous = { start: new Date(before.getTime() - 3 * DAY_MS), end: RANGE.start };
      expect(await countsOf(trx, box, { range: previous })).toMatchObject({ made: 2, sent_by_tap: 2 });
    });
  });

  test("5. a mailbox filter keeps the pairs of that mailbox, and test mail is not counted", async () => {
    await withRollback(db, async (trx) => {
      const box = await setupBox(trx);
      const secondId = randomUUID();
      await insertMailbox(trx, box.ctx, {
        id: secondId,
        address: `second-${secondId}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      await pairIn(trx, box, { status: "applied" });
      const moved = await pairIn(trx, box, { status: "rejected" });
      await trx.updateTable("emails").set({ mailbox_id: secondId }).where("id", "=", moved.emailId).execute();
      const testSender = `test-${randomUUID()}@x.test`;
      await pairIn(trx, box, { status: "applied" }, { from: testSender });

      expect(await countsOf(trx, box)).toMatchObject({ made: 3, sent_by_tap: 2, rejected: 1 });
      expect(await countsOf(trx, box, { mailboxId: box.mailboxId })).toMatchObject({
        made: 2,
        sent_by_tap: 2,
        rejected: 0,
      });
      expect(await countsOf(trx, box, { mailboxId: secondId })).toMatchObject({ made: 1, sent_by_tap: 0, rejected: 1 });
      expect(await countsOf(trx, box, { testMail: { senders: [testSender] } })).toMatchObject({
        made: 2,
        sent_by_tap: 1,
      });
    });
  });

  test("6. requests that ended with no draft or failed in the week count; a sample, a request outside the week and a done request do not", async () => {
    await withRollback(db, async (trx) => {
      const box = await setupBox(trx);
      const request = async (over: Record<string, unknown>) =>
        insertReplyRequest(trx, box.ctx, box.mailboxId, await addReplyMail(trx, box), {
          trigger: "tap",
          updated_at: NOW,
          ...over,
        });
      await request({ status: "no_draft", reason_code: "needs_facts" });
      await request({ status: "no_draft", reason_code: "not_a_reply", trigger: "auto" });
      await request({ status: "failed", reason_code: "llm_error" });
      await request({ status: "failed", reason_code: "llm_cap", trigger: "sample" });
      await request({ status: "failed", reason_code: "timeout", updated_at: new Date(RANGE.end.getTime() + DAY_MS) });
      await request({ status: "failed", reason_code: "timeout", updated_at: new Date(RANGE.start.getTime() - DAY_MS) });
      await request({ status: "done" });
      await request({ status: "cancelled", reason_code: "feature_off" });

      // A request on test mail, and a request of another mailbox when the query names one, are left out.
      const testSender = `test-${randomUUID()}@x.test`;
      await insertReplyRequest(trx, box.ctx, box.mailboxId, await addReplyMail(trx, box, { from: testSender }), {
        trigger: "tap",
        updated_at: NOW,
        status: "failed",
        reason_code: "llm_error",
      });
      expect(await countsOf(trx, box)).toMatchObject({ made: 0, no_draft: 2, failed: 2 });
      expect(await countsOf(trx, box, { testMail: { senders: [testSender] } })).toMatchObject({
        no_draft: 2,
        failed: 1,
      });
      const otherMailbox = randomUUID();
      await insertMailbox(trx, box.ctx, {
        id: otherMailbox,
        address: `other-${otherMailbox}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      expect(await countsOf(trx, box, { mailboxId: otherMailbox })).toMatchObject({ no_draft: 0, failed: 0 });
      expect(await countsOf(trx, box, { mailboxId: box.mailboxId })).toMatchObject({ no_draft: 2, failed: 2 });
    });
  });

  test("7. weekStats carries the counts of its week (the join in the report service)", async () => {
    await withRollback(db, async (trx) => {
      const box = await setupBox(trx);
      await pairIn(trx, box, { status: "applied" });
      await pairIn(trx, box, { status: "expired", reason: "answered" });
      const stats = await weekStats(
        trx,
        box.ctx,
        { weekStart: WEEK, mailboxId: null, now: new Date("2026-11-30T12:00:00Z") },
        { urgentNotices: listUrgentNoticeTimes, testMail: { senders: [] } }
      );
      if (stats === "not_found") throw new Error("not found");
      expect(stats.replyDrafts).toMatchObject({ made: 2, sent_by_tap: 1, answered: 1 });
    });
  });
});
