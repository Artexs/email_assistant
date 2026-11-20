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

  const failed: FlowEvent = { type: "verify_failed_status", enabled: true };
  test.each<[string, FlowEvent]>([
    ["path A: after the failed verify, turning TOTP off clears the warning", { type: "turned_off" }],
    ["path B: after the failed verify, a new enrolment that shows the codes clears the warning", { type: "verified" }],
    ["new backup codes clear the warning", { type: "codes_made" }],
  ])("%s", (_name, event) => {
    expect(run([failed, event])).toBe(false);
  });
});
