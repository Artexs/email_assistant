import { describe, expect, test } from "bun:test";

import { effectiveDetail } from "./detail";

describe("effectiveDetail", () => {
  test("flag off: full, whatever the lock and the member say", () => {
    expect(effectiveDetail({ flagOn: false, locked: true, memberDetail: "minimal" })).toBe("full");
    expect(effectiveDetail({ flagOn: false, locked: false, memberDetail: "minimal" })).toBe("full");
  });
  test("flag on, locked: minimal even for a member on full", () => {
    expect(effectiveDetail({ flagOn: true, locked: true, memberDetail: "full" })).toBe("minimal");
    expect(effectiveDetail({ flagOn: true, locked: true, memberDetail: "minimal" })).toBe("minimal");
  });
  test("flag on, not locked: the member's own level", () => {
    expect(effectiveDetail({ flagOn: true, locked: false, memberDetail: "full" })).toBe("full");
    expect(effectiveDetail({ flagOn: true, locked: false, memberDetail: "minimal" })).toBe("minimal");
  });
});
