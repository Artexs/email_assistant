import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { OWNER_REVIEW_PENDING, publishHoldReason, unknownPendingIds } from "./publish-gate";

const CONTENT_DIR = join(import.meta.dir, "content/docs");

// An English page id is a file `<id>.mdx`, or a folder page `<id>/index.mdx` (the home page is `index`).
const pageFileExists = (id: string): boolean =>
  existsSync(join(CONTENT_DIR, `${id}.mdx`)) || existsSync(join(CONTENT_DIR, id, "index.mdx"));

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
  test("an id that is no page is found, and every id of the real list is an English page", () => {
    expect(unknownPendingIds(["security", "nope"], pageFileExists)).toEqual(["nope"]);
    expect(unknownPendingIds(OWNER_REVIEW_PENDING, pageFileExists)).toEqual([]);
  });
  test("an English page id of the list is not a Polish page id", () => {
    expect(OWNER_REVIEW_PENDING.filter((id) => id.startsWith("pl/"))).toEqual([]);
  });
});
