import { describe, expect, test } from "bun:test";

import { resetRequestResult } from "./auth-requests";

describe("resetRequestResult", () => {
  test("maps the status of the reset request", () => {
    expect(resetRequestResult(200)).toBe("sent");
    expect(resetRequestResult(404)).toBe("off");
    expect(resetRequestResult(429)).toBe("too_many");
    expect(resetRequestResult(500)).toBe("error");
  });
});
