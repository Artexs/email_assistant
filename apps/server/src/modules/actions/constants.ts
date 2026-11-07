// A claim or a lock older than this is stale (S3 D7). Kept apart from committer.ts: expiry.ts must not import the committer.
export const STALE_AFTER_MS = 10 * 60_000;

// A send is approved for 48 h: an `awaiting_approval` send expires after it, an `approved` one is not claimed after it (D17, D22).
export const APPROVAL_TTL_MS = 48 * 3_600_000;
