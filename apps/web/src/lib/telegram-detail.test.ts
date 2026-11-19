import { describe, expect, test } from "bun:test";

import { linkDetailBody, preselectedDetail } from "../components/telegram/TelegramDetail";

// The level that the link step and the change dialog preselect: the stored one, `minimal` for a new member, and `minimal` while locked.
describe("preselectedDetail", () => {
  test("the stored level is preselected, so a panel load never lowers a member who chose full", () => {
    expect(preselectedDetail({ detail: "full", locked: false })).toBe("full");
    expect(preselectedDetail({ detail: "minimal", locked: false })).toBe("minimal");
  });

  test("a new member and a state with no detail get minimal", () => {
    expect(preselectedDetail({})).toBe("minimal");
    expect(preselectedDetail({ detail: undefined, locked: undefined })).toBe("minimal");
  });

  test("the lock wins over a stored full", () => {
    expect(preselectedDetail({ detail: "full", locked: true })).toBe("minimal");
  });
});

// The body of the link under the lock must not overwrite a stored `full` (the lock changes no stored choice).
describe("linkDetailBody", () => {
  test("without the lock the body carries the level that the step shows: the stored one, or the pick", () => {
    expect(linkDetailBody({ detail: "full", locked: false }, null)).toEqual({ detail: "full" });
    expect(linkDetailBody({ detail: "minimal", locked: false }, null)).toEqual({ detail: "minimal" });
    expect(linkDetailBody({ detail: "minimal", locked: false }, "full")).toEqual({ detail: "full" });
    expect(linkDetailBody({}, null)).toEqual({ detail: "minimal" });
  });

  test("under the lock a stored full sends no detail, so the server keeps it", () => {
    expect(linkDetailBody({ detail: "full", locked: true }, null)).toEqual({});
    // A pick of full before the lock came is not an active choice of minimal.
    expect(linkDetailBody({ detail: "full", locked: true }, "full")).toEqual({});
    expect(linkDetailBody({ detail: "minimal", locked: true }, null)).toEqual({});
  });

  test("under the lock an active pick of minimal is sent", () => {
    expect(linkDetailBody({ detail: "full", locked: true }, "minimal")).toEqual({ detail: "minimal" });
  });
});
