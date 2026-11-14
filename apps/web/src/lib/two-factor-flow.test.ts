import { describe, expect, test } from "bun:test";

import { withoutCodesAfter, type FlowEvent } from "./two-factor-flow";

function run(events: FlowEvent[]): boolean {
  return events.reduce(withoutCodesAfter, false);
}

describe("withoutCodesAfter", () => {
  test("a failed verify that left TOTP on sets the warning", () => {
    expect(run([{ type: "verify_failed_status", enabled: true }])).toBe(true);
  });

  test("a failed verify that left TOTP off sets no warning", () => {
    expect(run([{ type: "verify_failed_status", enabled: false }])).toBe(false);
  });

  test("path A: after the failed verify, turning TOTP off clears the warning", () => {
    expect(run([{ type: "verify_failed_status", enabled: true }, { type: "turned_off" }])).toBe(false);
  });

  test("path B: after the failed verify, a new enrolment that shows the codes clears the warning", () => {
    expect(run([{ type: "verify_failed_status", enabled: true }, { type: "verified" }])).toBe(false);
  });

  test("new backup codes clear the warning", () => {
    expect(run([{ type: "verify_failed_status", enabled: true }, { type: "codes_made" }])).toBe(false);
  });
});
