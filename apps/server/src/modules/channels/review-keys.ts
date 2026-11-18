// The dedup keys of the approval cards (outbox kind `approval`). The card that the approval detector queues for a send has the key
// `approval:<send id>`. A review card of a reply draft  has `approval:<send id>:r<n>`: `n` is 1 plus the review cards of
// that send that the user got before, so a card that the owner skipped shows again later. No heavy imports: the sender uses this file.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const REVIEW_KEY = new RegExp(`^approval:(${UUID}):r[1-9][0-9]*$`);
const CARD_KEY = new RegExp(`^approval:(${UUID})(?::r[1-9][0-9]*)?$`);

export function reviewCardKey(sendId: string, n: number): string {
  return `approval:${sendId}:r${n}`;
}

// A review card goes out at once: quiet hours do not hold it (the owner asked for it with a tap).
export function isReviewCardKey(kind: string, dedupKey: string): boolean {
  return kind === "approval" && REVIEW_KEY.test(dedupKey);
}

// The send that an approval card asks about, for the key of a plain card and of a review card. null: not an approval card key.
export function sendIdOfCardKey(dedupKey: string): string | null {
  return CARD_KEY.exec(dedupKey)?.[1] ?? null;
}
