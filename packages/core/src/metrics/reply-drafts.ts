// Reply drafts: what became of the drafts that the system made in a week. Plain rows in, counts out.

/** One reply pair of the week, as its newest version stands now (an edit or a redraft replaced the older versions). */
export interface ReplyPairRow {
  /** The `status` of the newest `send` of the pair. */
  status: string;
  /** Its `status_reason`; null for a send with no reason. */
  reason: string | null;
}

/** One request that ended without a draft in the week: the model said no draft, or the request failed. */
export interface ReplyRequestEndRow {
  status: "no_draft" | "failed";
}

export interface ReplyOutcomeRows {
  pairs: readonly ReplyPairRow[];
  requests: readonly ReplyRequestEndRow[];
}

export const replyOutcomes = [
  "made",
  "sent_by_tap",
  "sent_by_user",
  "rejected",
  "expired",
  "newer_mail",
  "answered",
  "original_moved",
  "draft_changed",
  "no_draft",
  "failed",
] as const;
export type ReplyOutcome = (typeof replyOutcomes)[number];
export type ReplyOutcomeCounts = Record<ReplyOutcome, number>;

// The reasons of an `expired` send that mean "nobody tapped in time".
const TIME_REASONS: readonly (string | null)[] = [null, "timeout", "held_timeout", "not_notified", "not_seen"];

// The outcome of the newest version of a pair. A pair that still waits, a pair that a switch or a suspicious-mail check closed
// (`policy_changed`, `suspicious`) and an unknown state have no outcome: they stay in `made` only.
// A copy that is gone from Drafts (`draft_missing`) counts as a changed copy: the user took it out of the system's hands.
function outcomeOfPair(row: ReplyPairRow): Exclude<ReplyOutcome, "made" | "no_draft"> | null {
  if (row.status === "applied") return "sent_by_tap";
  if (row.status === "rejected") return "rejected";
  if (row.status === "failed") return "failed";
  if (row.status !== "expired") return null;
  switch (row.reason) {
    case "sent_by_user":
    case "newer_mail":
    case "answered":
    case "original_moved":
    case "draft_changed":
      return row.reason;
    case "draft_missing":
      return "draft_changed";
    default:
      return TIME_REASONS.includes(row.reason) ? "expired" : null;
  }
}

/**
 * The counts of the weekly report line and the stats page. `made` is the number of pairs; every other pair count is the end of
 * the newest version of a pair, so a redraft counts once. `no_draft` and `failed` also count the requests that ended so (a failed
 * send is a failed pair).
 */
export function replyOutcomeCounts(rows: ReplyOutcomeRows): ReplyOutcomeCounts {
  const counts = Object.fromEntries(replyOutcomes.map((name) => [name, 0])) as ReplyOutcomeCounts;
  counts.made = rows.pairs.length;
  for (const pair of rows.pairs) {
    const outcome = outcomeOfPair(pair);
    if (outcome !== null) counts[outcome] += 1;
  }
  for (const request of rows.requests) counts[request.status] += 1;
  return counts;
}

/** The "closed" figure of the weekly line: the drafts that the system closed because the mail changed under them. */
export function replyClosedCount(counts: ReplyOutcomeCounts): number {
  return counts.newer_mail + counts.answered + counts.original_moved + counts.draft_changed;
}
