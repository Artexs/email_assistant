import { NoticeViewError } from "@ea/core";

import type { TenantContext } from "../../platform/db";
import { getSend, listOpenReplySends, type SendRow } from "../actions";
import { replyFactsOf } from "../mail";
import { getOrganization, isFeatureOn } from "../tenancy";
import { suspiciousReasonsOf } from "../triage";

import { approvalViewFor } from "./notices/approval";
import { queue, warnSkipped, type DbOrTrx } from "./notices/run";
import type { LinkedChat } from "./port";
import { findReviewCards } from "./repo";
import { reviewCardKey } from "./review-keys";

// The replies of an organization that an owner may review in Telegram, and the review cards.

// One page of the scan, and the most that one call reads. A reply lives 7 days, so an organization with more open reply sends than this
// is not expected; the count shows at most this many.
const PAGE = 50;
export const REVIEW_SCAN_MAX = 500;

// The open reply sends of the organization that the owner may still review, oldest first (`created_at`, id). The DB facts leave out a
// send whose mail is answered (`\Answered` or a user reply in Sent) or flagged suspicious (notes §3.7): the sweep closes it soon, and a
// card for it would only waste a tap. `after`: only the sends after this one. `max`: stop when this many are found.
export async function listReviewableReplies(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { max: number; after?: { createdAt: Date; id: string } }
): Promise<SendRow[]> {
  const found: SendRow[] = [];
  let cursor = opts.after;
  let scanned = 0;
  while (found.length < opts.max && scanned < REVIEW_SCAN_MAX) {
    const page = await listOpenReplySends(db, ctx, { limit: PAGE, ...(cursor === undefined ? {} : { after: cursor }) });
    if (page.length === 0) break;
    const emailIds = page.flatMap((send) => (send.email_id === null ? [] : [send.email_id]));
    const facts = await replyFactsOf(db, ctx, emailIds);
    const suspicious = await suspiciousReasonsOf(db, ctx, emailIds);
    for (const send of page) {
      if (found.length >= opts.max) break;
      const fact = send.email_id === null ? undefined : facts.get(send.email_id);
      if (fact === undefined || fact.answered || suspicious.has(send.email_id as string)) continue;
      found.push(send);
    }
    scanned += page.length;
    const last = page[page.length - 1];
    if (last === undefined || page.length < PAGE) break;
    cursor = { createdAt: last.created_at, id: last.id };
  }
  return found;
}

// The base URL of the panel when the link goes into a message: `WEB_BASE_URL` set and the flag `approvals_page` on.
export async function panelBaseOf(
  db: DbOrTrx,
  ctx: TenantContext,
  webBaseUrl: string | undefined
): Promise<string | undefined> {
  return webBaseUrl !== undefined && (await isFeatureOn(db, ctx, "approvals_page")) ? webBaseUrl : undefined;
}

export type ReviewCardResult = "queued" | "waiting" | "exists";

// One review card of one send for one owner. A card of that send that no sender took yet (`pending`, `sending`) is not doubled
// ("waiting"). Else the key is `approval:<send>:r<n>`: `n` counts the review cards that this owner got of the send, so a send that the
// owner skipped shows again at the next review. The view is the one the committer sends. The card goes out at once (the sender
// does not hold review cards in quiet hours).
export async function queueReviewCard(
  db: DbOrTrx,
  ctx: TenantContext,
  owner: Pick<LinkedChat, "userId" | "locale">,
  send: SendRow,
  input: { now: Date; timeZone: string; panelBase?: string }
): Promise<ReviewCardResult> {
  const earlier = await findReviewCards(db, ctx, owner.userId, send.id);
  if (earlier.some((card) => card.status === "pending" || card.status === "sending")) return "waiting";
  const { view } = await approvalViewFor(
    db,
    ctx,
    send,
    input.panelBase === undefined ? {} : { panelBase: input.panelBase }
  );
  const queued = await queue(
    db,
    ctx,
    {
      userId: owner.userId,
      locale: owner.locale,
      kind: "approval",
      dedupKey: reviewCardKey(send.id, earlier.length + 1),
      ...(send.email_id === null ? {} : { emailId: send.email_id }),
      view: { actionId: send.id, view, now: input.now, timeZone: input.timeZone },
      // The answer to a tap in Telegram: it stays in that chat, the phone gets no copy.
      only: "telegram",
    },
    input.now
  );
  return queued ? "queued" : "exists";
}

export type NextReviewResult = { kind: "card"; result: ReviewCardResult } | { kind: "none" };

// The next open reply of the organization after `afterId` (none: the first one), as a review card of `owner`. `afterId` may name a send
// that is closed now: only its place in the order counts. An unknown `afterId` starts again at the first reply. A card that the renderer
// refuses (for example recipients that do not fit one message) is skipped: nothing is marked, the log line holds the send id only, and the
// next reply is tried, so one bad send never blocks the review.
export async function queueNextReviewCard(
  deps: { db: DbOrTrx; webBaseUrl?: string },
  ctx: TenantContext,
  owner: Pick<LinkedChat, "userId" | "locale">,
  opts: { afterId?: string; now: Date }
): Promise<NextReviewResult> {
  const anchor = opts.afterId === undefined ? undefined : await getSend(deps.db, ctx, opts.afterId);
  const organization = await getOrganization(deps.db, ctx);
  if (organization === undefined) return { kind: "none" };
  const panelBase = await panelBaseOf(deps.db, ctx, deps.webBaseUrl);
  let cursor = anchor === undefined ? undefined : { createdAt: anchor.created_at, id: anchor.id };
  for (;;) {
    const [next] = await listReviewableReplies(deps.db, ctx, {
      max: 1,
      ...(cursor === undefined ? {} : { after: cursor }),
    });
    if (next === undefined) return { kind: "none" };
    try {
      const result = await queueReviewCard(deps.db, ctx, owner, next, {
        now: opts.now,
        timeZone: organization.timezone,
        ...(panelBase === undefined ? {} : { panelBase }),
      });
      return { kind: "card", result };
    } catch (error) {
      if (!(error instanceof NoticeViewError)) throw error;
      warnSkipped("reply_review", next.id, error, `${owner.userId}:${next.id}`);
      cursor = { createdAt: next.created_at, id: next.id };
    }
  }
}

// The review card of one named send (the new version after a change, the draft that a tap found) for `owner`. Only a reply that waits for
// a tap gets a card. "none": no such send, not a reply, not waiting, or the renderer refuses the card (the log line holds the send id only).
export async function queueReviewCardOfSend(
  deps: { db: DbOrTrx; webBaseUrl?: string },
  ctx: TenantContext,
  owner: Pick<LinkedChat, "userId" | "locale">,
  sendId: string,
  now: Date
): Promise<ReviewCardResult | "none"> {
  const send = await getSend(deps.db, ctx, sendId);
  if (send === undefined || send.status !== "awaiting_approval" || send.payload.kind !== "reply") return "none";
  const organization = await getOrganization(deps.db, ctx);
  if (organization === undefined) return "none";
  const panelBase = await panelBaseOf(deps.db, ctx, deps.webBaseUrl);
  try {
    return await queueReviewCard(deps.db, ctx, owner, send, {
      now,
      timeZone: organization.timezone,
      ...(panelBase === undefined ? {} : { panelBase }),
    });
  } catch (error) {
    if (!(error instanceof NoticeViewError)) throw error;
    warnSkipped("reply_review", send.id, error, `${owner.userId}:${send.id}`);
    return "none";
  }
}
