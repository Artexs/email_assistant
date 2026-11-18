// The dedup keys of the approval cards (outbox kind `approval`). The card that the approval detector queues for a send has the key
// `approval:<send id>`. A review card of a reply draft has `approval:<send id>:r<n>`: `n` is 1 plus the review cards of
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

// The question after a Redraft tap: `reply_prompt:<send>:<n>`, `n` counts the prompts that this user got of the send.
const PROMPT_KEY = new RegExp(`^reply_prompt:(${UUID}):[1-9][0-9]*$`);

export function replyPromptKey(sendId: string, n: number): string {
  return `reply_prompt:${sendId}:${n}`;
}

// The send that a prompt asks about. null: not a prompt key.
export function sendIdOfPromptKey(dedupKey: string): string | null {
  return PROMPT_KEY.exec(dedupKey)?.[1] ?? null;
}

// A message that the user asked for with a tap or a line of text and waits for: a review card, the question after Redraft, the result of
// a request. Quiet hours do not hold it.
export function isAskedForKey(kind: string, dedupKey: string): boolean {
  return isReviewCardKey(kind, dedupKey) || kind === "reply_prompt" || kind === "reply_result";
}

// The send that an approval card asks about, for the key of a plain card and of a review card. null: not an approval card key.
export function sendIdOfCardKey(dedupKey: string): string | null {
  return CARD_KEY.exec(dedupKey)?.[1] ?? null;
}
