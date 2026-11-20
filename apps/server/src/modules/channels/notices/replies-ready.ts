import { NoticeViewError, HOUR_MS } from "@ea/core";

import { listOpenReplySends, markNotified } from "../../actions";
import { isFeatureOn } from "../../tenancy";
import { replyConsentOf } from "../consent";
import { listReviewableReplies, panelBaseOf, REVIEW_SCAN_MAX } from "../reply-review";
import { lastRepliesReady } from "../repo";

import { panelListUrlOf } from "./approval";
import { inTransaction, queue, warnSkipped, type Detector, type OrgRun } from "./run";

// The "replies ready" notice. At most one for each owner in 2 hours, counted from the queue time of the last one.
// It counts the open reply sends of the organization that the DB facts do not close (not answered, not suspicious). Quiet hours hold it
// in the sender, like every notice. An owner whose Telegram consent does not cover reply data gets the count, the panel link and one fixed
// line, and no Review button (`replyConsentOf`).
export const REPLIES_READY_GAP_MS = 2 * HOUR_MS;

async function detectRepliesReady(run: OrgRun): Promise<void> {
  const { db, ctx, owners, now, timeZone } = run;
  if (owners.length === 0) return;
  if (!(await isFeatureOn(db, ctx, "reply_drafts"))) return;
  // A cheap first look: no unnotified open reply send, no work (the detector runs every 15 s).
  if ((await listOpenReplySends(db, ctx, { limit: 1, unnotifiedOnly: true })).length === 0) return;
  const open = await listReviewableReplies(db, ctx, { max: REVIEW_SCAN_MAX });
  // A send that an earlier notice counted has `notified_at` set (the 7-day life of a reply ignores it).
  const fresh = open.filter((send) => send.notified_at === null);
  const first = fresh[0];
  if (first === undefined) return;
  const panelBase = await panelBaseOf(db, ctx, run.deps.webBaseUrl);
  const panelUrl = panelBase === undefined ? undefined : panelListUrlOf(panelBase);
  const covered = await replyConsentOf(
    db,
    ctx,
    owners.map((owner) => owner.userId)
  );
  let reached = false;
  for (const owner of owners) {
    const last = await lastRepliesReady(db, ctx, owner.userId);
    // The gap counts from the queue time. A notice that no sender took yet (quiet hours hold it) is not doubled.
    if (last !== undefined && (last.status === "pending" || last.status === "sending")) continue;
    if (last !== undefined && now.getTime() - last.createdAt.getTime() < REPLIES_READY_GAP_MS) continue;
    try {
      await queue(
        db,
        ctx,
        {
          userId: owner.userId,
          locale: owner.locale,
          kind: "replies_ready",
          dedupKey: `replies_ready:${owner.userId}:${first.id}`,
          // The newest reply that waits made the count what it is.
          eventAt: new Date(Math.max(...fresh.map((send) => send.updated_at.getTime()))),
          view: {
            count: open.length,
            now,
            timeZone,
            review: covered.has(owner.userId),
            ...(panelUrl === undefined ? {} : { panelUrl }),
          },
        },
        now
      );
      reached = true;
    } catch (error) {
      if (!(error instanceof NoticeViewError)) throw error;
      warnSkipped("replies_ready", first.id, error, `${owner.userId}:${first.id}`);
    }
  }
  if (!reached) return;
  // The counted sends are told about: the next notice waits for a send that is not in this count.
  await inTransaction(db, async (trx) => {
    for (const send of fresh) await markNotified(trx, ctx, send.id, now);
  });
}

export const repliesReadyDetector: Detector = {
  name: "replies_ready",
  kinds: ["replies_ready"],
  detect: detectRepliesReady,
};
