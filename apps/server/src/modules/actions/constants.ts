// A claim or a lock older than this is stale (S3 D7). Kept apart from committer.ts: expiry.ts must not import the committer.
export const STALE_AFTER_MS = 10 * 60_000;

// A send is approved for 48 h: an `awaiting_approval` send expires after it, an `approved` one is not claimed after it (D17, D22).
export const APPROVAL_TTL_MS = 48 * 3_600_000;

// S3 D7: a hard error is tried 3 times; a retry waits 5 min. Kept apart from apply.ts: drafts.ts and send.ts import them.
export const HARD_ERROR_TRIES = 3;
export const RETRY_WAIT_MS = 5 * 60_000;
