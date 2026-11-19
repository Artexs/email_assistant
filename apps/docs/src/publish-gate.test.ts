import { describe, expect, test } from "bun:test";
import { OWNER_REVIEW_PENDING, publishHoldReason } from "./publish-gate";

describe("publish gate", () => {
  test("the hold lists the pages that wait for the owner", () => {
    expect(OWNER_REVIEW_PENDING).toEqual([
      "index",
      "security",
      "pricing",
      "reference/api",
      "reference/autonomy-evidence",
    ]);
  });
  test("the reason names every pending id, and an empty list has none", () => {
    expect(publishHoldReason(["security", "index"])).toBe("owner_review_pending security index");
    expect(publishHoldReason([])).toBeNull();
  });
});
