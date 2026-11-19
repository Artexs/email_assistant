import { describe, expect, test } from "bun:test";

import { preselectedDetail } from "../components/telegram/TelegramDetail";

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
