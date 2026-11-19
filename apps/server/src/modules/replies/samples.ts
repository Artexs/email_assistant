import { QUOTA_TIMEZONE, quotaDayStart, REPLY_SAMPLE_COUNT, replyEligibility, replyRequestStatuses } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { getMailbox, type TestMailRule } from "../mail";
import { getMembership, isFeatureOn } from "../tenancy";

import { loadReplyFacts } from "./facts";
import { createReplyRequest } from "./repo/requests";
import { countSampleRequestsSince, listSampleRequests, lockSampleRun } from "./repo/samples";
import { listSampleCandidates } from "./repo/scan";
import { recordRequested, type ReplyBlock } from "./service";
import { runInTransaction } from "./write";

// The newest mails that the sample run looks at: the rule of the sample trigger drops some of them, so the pool is wider than three.
export const SAMPLE_POOL = 30;

export interface SampleDeps {
  db: Db | Transaction<DB>;
  now(): Date;
  // The scope of the model: `synthetic` lets only test mail through, as the drafter job does. null: every mail.
  testOnly: TestMailRule | null;
}

// What the composition root knows of the sample drafts: the clock and the scope.
export type ReplySampleScope = Pick<SampleDeps, "now" | "testOnly">;

export type SampleRepliesResult =
  // `requestIds` has `count` entries. 0: no mail qualifies, nothing is queued and the day's run is not used up.
  | { kind: "queued"; requestIds: string[]; count: number }
  | { kind: "blocked"; reason: ReplyBlock }
  // This mailbox had its sample run in this quota day.
  | { kind: "sample_limit" }
  | { kind: "feature_off" }
  | { kind: "forbidden" }
  | { kind: "not_found" };

/**
 * Sample drafts on recent real mail, for an owner who wants to see the style before the drafts go to Drafts (shadow mode too). One
 * `sample` request for each of the newest mails of the last 7 days that pass `replyEligibility` for the trigger `sample` and are
 * `needs_reply` (at most `count`). The drafter job stores each text in `reply_requests.sample_body`; no action, no Drafts copy and no
 * notice follow. One run for each mailbox and quota day. A mailbox of an OAuth provider answers `blocked` (`oauth_mailbox`).
 */
export async function sampleReplies(
  deps: SampleDeps,
  ctx: TenantContext,
  input: { mailboxId: string; userId: string; via: "web"; count: number }
): Promise<SampleRepliesResult> {
  if ((await getMembership(deps.db, ctx, input.userId))?.role !== "owner") return { kind: "forbidden" };
  if (!(await isFeatureOn(deps.db, ctx, "reply_drafts"))) return { kind: "feature_off" };
  const count = Math.min(Math.max(input.count, 0), REPLY_SAMPLE_COUNT);
  const now = deps.now();
  return runInTransaction(deps.db, async (trx): Promise<SampleRepliesResult> => {
    const mailbox = await getMailbox(trx, ctx, input.mailboxId);
    if (mailbox === undefined) return { kind: "not_found" };
    if (mailbox.oauth_provider !== null) return { kind: "blocked", reason: "oauth_mailbox" };
    await lockSampleRun(trx, ctx, input.mailboxId);
    const dayStart = quotaDayStart(now, QUOTA_TIMEZONE);
    if ((await countSampleRequestsSince(trx, ctx, input.mailboxId, dayStart)) > 0) return { kind: "sample_limit" };

    const pool = await listSampleCandidates(trx, ctx, input.mailboxId, {
      now,
      limit: SAMPLE_POOL,
      testOnly: deps.testOnly,
    });
    const loaded = await loadReplyFacts(
      trx,
      ctx,
      pool.map((candidate) => candidate.emailId),
      { ownerLocale: null }
    );
    const requestIds: string[] = [];
    for (const candidate of pool) {
      if (requestIds.length >= count) break;
      const entry = loaded.get(candidate.emailId);
      if (entry === undefined || !replyEligibility(entry.facts, { trigger: "sample", now }).ok) continue;
      const requestId = await createReplyRequest(trx, ctx, {
        mailboxId: input.mailboxId,
        emailId: candidate.emailId,
        threadKey: candidate.threadKey,
        folder: candidate.folder,
        trigger: "sample",
        requestedBy: input.userId,
        nextAttemptAt: now,
        createdAt: now,
      });
      if (requestId === null) throw new Error("a sample request must insert");
      await recordRequested(trx, ctx, {
        emailId: candidate.emailId,
        requestId,
        actor: { userId: input.userId, via: input.via },
        trigger: "sample",
        now,
      });
      requestIds.push(requestId);
    }
    return { kind: "queued", requestIds, count: requestIds.length };
  });
}

export interface SampleItem {
  requestId: string;
  status: (typeof replyRequestStatuses)[number];
  reasonCode: string | null;
  subject: string | null;
  body: string | null;
}

// The samples of today's run of a mailbox. Only the body of a `done` request is shown. `null`: the mailbox is not in the organization.
export async function listSamples(
  deps: Pick<SampleDeps, "db" | "now">,
  ctx: TenantContext,
  mailboxId: string
): Promise<SampleItem[] | null> {
  if ((await getMailbox(deps.db, ctx, mailboxId)) === undefined) return null;
  const rows = await listSampleRequests(deps.db, ctx, mailboxId, quotaDayStart(deps.now(), QUOTA_TIMEZONE));
  return rows.map((row) => {
    const status = replyRequestStatuses.find((name) => name === row.status);
    if (status === undefined) throw new Error("unknown reply request status");
    return {
      requestId: row.id,
      status,
      reasonCode: row.reasonCode,
      subject: row.subject,
      body: status === "done" ? row.sampleBody : null,
    };
  });
}
