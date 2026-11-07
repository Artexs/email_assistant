// A claim or a lock older than this is stale (S3 D7). Kept apart from committer.ts: expiry.ts must not import the committer.
export const STALE_AFTER_MS = 10 * 60_000;
