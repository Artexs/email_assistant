import { describe, expect, test } from "bun:test";

import {
  isAskedForKey,
  isReviewCardKey,
  replyPromptKey,
  reviewCardKey,
  sendIdOfCardKey,
  sendIdOfPromptKey,
} from "./review-keys";

const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

describe("the keys of the approval cards", () => {
  test("a review card key is `approval:<send>:r<n>`; the plain card key and every other shape is not one", () => {
    expect(reviewCardKey(ID, 3)).toBe(`approval:${ID}:r3`);
    expect(isReviewCardKey("approval", `approval:${ID}:r1`)).toBe(true);
    expect(isReviewCardKey("approval", `approval:${ID}:r12`)).toBe(true);
    // The plain card of the approval detector is held in quiet hours like every notice.
    expect(isReviewCardKey("approval", `approval:${ID}`)).toBe(false);
    expect(isReviewCardKey("approval", `approval:${ID}:r0`)).toBe(false);
    expect(isReviewCardKey("approval", `approval:${ID}:r1x`)).toBe(false);
    expect(isReviewCardKey("approval", `approval:${ID}:x1`)).toBe(false);
    expect(isReviewCardKey("approval", `approval_set:${ID}:r1`)).toBe(false);
    expect(isReviewCardKey("approval", `approval:not-an-id:r1`)).toBe(false);
    // Only the kind `approval` counts: another kind with such a key is held.
    expect(isReviewCardKey("replies_ready", `approval:${ID}:r1`)).toBe(false);
  });

  test("the send of a card key is read from both forms and from nothing else", () => {
    expect(sendIdOfCardKey(`approval:${ID}`)).toBe(ID);
    expect(sendIdOfCardKey(`approval:${ID}:r2`)).toBe(ID);
    expect(sendIdOfCardKey(`approval:${ID}:rx`)).toBeNull();
    expect(sendIdOfCardKey(`approval_set:${ID}`)).toBeNull();
    expect(sendIdOfCardKey("approval:x")).toBeNull();
  });
});

describe("the keys of the question after Redraft", () => {
  test("a prompt key is `reply_prompt:<send>:<n>`; the send is read from it and from no other shape", () => {
    expect(replyPromptKey(ID, 2)).toBe(`reply_prompt:${ID}:2`);
    expect(sendIdOfPromptKey(`reply_prompt:${ID}:1`)).toBe(ID);
    expect(sendIdOfPromptKey(`reply_prompt:${ID}:12`)).toBe(ID);
    for (const key of [
      `reply_prompt:${ID}`,
      `reply_prompt:${ID}:0`,
      `reply_prompt:${ID}:1x`,
      `approval:${ID}:r1`,
      "reply_prompt:x:1",
    ]) {
      expect(sendIdOfPromptKey(key), key).toBeNull();
    }
    // A card key is no prompt key and a prompt key is no card key: a line of text answers each by its own rule.
    expect(sendIdOfCardKey(`reply_prompt:${ID}:1`)).toBeNull();
  });

  test("a message that the user asked for is never held in quiet hours: a review card, the question and the result; a plain card and every other kind are", () => {
    expect(isAskedForKey("approval", `approval:${ID}:r1`)).toBe(true);
    expect(isAskedForKey("reply_prompt", `reply_prompt:${ID}:1`)).toBe(true);
    expect(isAskedForKey("reply_result", "reply_result:any")).toBe(true);
    expect(isAskedForKey("approval", `approval:${ID}`)).toBe(false);
    expect(isAskedForKey("replies_ready", `replies_ready:${ID}`)).toBe(false);
    expect(isAskedForKey("urgent", `urgent:${ID}`)).toBe(false);
  });
});
