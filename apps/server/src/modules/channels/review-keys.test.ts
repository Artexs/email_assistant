import { describe, expect, test } from "bun:test";

import { isReviewCardKey, reviewCardKey, sendIdOfCardKey } from "./review-keys";

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
