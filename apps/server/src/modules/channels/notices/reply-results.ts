import { NoticeViewError, MINUTE_MS } from "@ea/core";

import { listEndedRequestsVia, USER_REQUEST_TIMEOUT_MS, type EndedRequest } from "../../replies";
import { isFeatureOn } from "../../tenancy";
import { replyConsentOf } from "../consent";
import { queueReviewCardOfSend } from "../reply-review";
import { hasReviewCardSince } from "../repo";

import { queue, warnSkipped, type Detector, type OrgRun } from "./run";

// The answer to a "Draft reply" tap or a Redraft line from Telegram, when the drafter has ended the request. A new version or the open draft
// of the thread comes as a review card (outbox kind `approval`); every other end comes as one fixed line (kind `reply_result`) for the
// reason code. Only the owner who asked gets it, only when the request came through Telegram (the audit row of the service says so) and
// only while the consent of that owner covers reply data. Each answer is queued once: the line by its dedup key, the card by a check for a
// card of that send queued after the end of the request. A request is looked at for 30 minutes after its end.
export const REPLY_RESULT_WINDOW_MS = 30 * MINUTE_MS;
const RESULT_LIMIT = 50;

async function answerCard(run: OrgRun, request: EndedRequest): Promise<"queued" | "none"> {
  const { db, ctx, now } = run;
  const owner = run.owners.find((entry) => entry.userId === request.requestedBy);
  const sendId = request.sendActionId;
  if (owner === undefined || sendId === null) return "none";
  if (await hasReviewCardSince(db, ctx, owner.userId, sendId, request.endedAt)) return "queued";
  const result = await queueReviewCardOfSend(run.deps, ctx, owner, sendId, now);
  return result === "none" ? "none" : "queued";
}

async function detectReplyResults(run: OrgRun): Promise<void> {
  const { db, ctx, owners, now } = run;
  if (owners.length === 0) return;
  if (!(await isFeatureOn(db, ctx, "reply_drafts"))) return;
  const ended = await listEndedRequestsVia(db, ctx, {
    via: "telegram",
    since: new Date(now.getTime() - REPLY_RESULT_WINDOW_MS),
    limit: RESULT_LIMIT,
    maxLifeMs: USER_REQUEST_TIMEOUT_MS,
  });
  if (ended.length === 0) return;
  const covered = await replyConsentOf(
    db,
    ctx,
    owners.map((owner) => owner.userId)
  );
  for (const request of ended) {
    const owner = owners.find((entry) => entry.userId === request.requestedBy);
    if (owner === undefined || !covered.has(owner.userId)) continue;
    try {
      let reason: string = request.reasonCode ?? request.status;
      if (request.status === "done" || request.status === "superseded") {
        if ((await answerCard(run, request)) === "queued") continue;
        // The send does not wait for a tap any more (it was sent, rejected or replaced meanwhile): say so.
        reason = request.status === "done" ? "closed" : "open_newer";
      }
      await queue(
        db,
        ctx,
        {
          userId: owner.userId,
          locale: owner.locale,
          kind: "reply_result",
          dedupKey: `reply_result:${request.id}`,
          emailId: request.emailId,
          view: { emailId: request.emailId, reason },
        },
        now
      );
    } catch (error) {
      if (!(error instanceof NoticeViewError)) throw error;
      warnSkipped("reply_result", request.id, error);
    }
  }
}

export const replyResultsDetector: Detector = {
  name: "reply_results",
  kinds: ["reply_result"],
  detect: detectReplyResults,
};
