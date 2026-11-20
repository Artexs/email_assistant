import { DAY_MS, HOUR_MS, MINUTE_MS } from "@ea/core";

// A claim or a lock older than this is stale. Kept apart from committer.ts: expiry.ts must not import the committer.
export const STALE_AFTER_MS = 10 * MINUTE_MS;

// A send is approved for 48 h: an `awaiting_approval` send expires after it, an `approved` one is not claimed after it.
export const APPROVAL_TTL_MS = 2 * DAY_MS;

// A send that never reached an owner expires 7 days after it was planned.
export const UNNOTIFIED_TTL_MS = 7 * DAY_MS;

// A reply send waits 7 days after it was made, whether or not an owner was told (`approvalExpiresAt`, lifetime.ts).
export const REPLY_TTL_MS = 7 * DAY_MS;

// A hard error is tried 3 times; a retry waits 5 min. Kept apart from apply.ts: drafts.ts and send.ts import them.
export const HARD_ERROR_TRIES = 3;
export const RETRY_WAIT_MS = 5 * MINUTE_MS;

// A delegation without a due date gets one this long after its send.
export const DELEGATION_DUE_AFTER_MS = 3 * DAY_MS;

// A send that gets only soft errors before the content ends as `failed` / `smtp_error` this long after the tap.
// Shorter than APPROVAL_TTL_MS (`held_timeout`), so the user learns sooner. It does not touch a retry with a count.
export const SEND_SOFT_CAP_MS = 6 * HOUR_MS;
