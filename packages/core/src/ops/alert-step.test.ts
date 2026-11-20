import { describe, expect, test } from "bun:test";

import { nextAlertStep, type AlertState, type AlertStep } from "./alert-step";
import type { SloCheck } from "./kinds";

const NOW = new Date("2026-11-20T10:00:00Z");
const REPEAT_MS = 6 * 3_600_000;

const check = (state: SloCheck["state"]): SloCheck => ({ kind: "slo_disk", state, facts: { free_gb: 2 } });
const sent = (lastSentAt: string): AlertState => ({
  openSentAt: new Date("2026-11-20T01:00:00Z"),
  lastSentAt: new Date(lastSentAt),
  resolvedAt: null,
  resolvedSentAt: null,
});
const unsent: AlertState = { openSentAt: null, lastSentAt: null, resolvedAt: null, resolvedSentAt: null };

describe("nextAlertStep", () => {
  test.each<[string, AlertState | null, SloCheck["state"], AlertStep]>([
    ["1. no row and firing opens", null, "firing", "open"],
    ["2. no row and clear does nothing", null, "clear", "none"],
    ["3. no row and between does nothing", null, "between", "none"],
    ["4. an open notice that was not sent is sent again while firing", unsent, "firing", "open"],
    ["4b. an open notice that was not sent is sent again while between", unsent, "between", "open"],
    ["5. an open notice that was not sent closes silently when clear", unsent, "clear", "silent_close"],
    ["6. firing less than 6 h after the last notice does nothing", sent("2026-11-20T04:00:01Z"), "firing", "none"],
    ["7. firing exactly 6 h after the last notice repeats", sent("2026-11-20T04:00:00Z"), "firing", "repeat"],
    ["8. between 7 h after the last notice repeats", sent("2026-11-20T03:00:00Z"), "between", "repeat"],
    ["8b. between less than 6 h after the last notice does nothing", sent("2026-11-20T09:00:00Z"), "between", "none"],
    ["9. clear after an open notice resolves", sent("2026-11-20T09:55:00Z"), "clear", "resolve"],
  ])("%s", (_name, row, state, step) => {
    expect(nextAlertStep(row, check(state), NOW, REPEAT_MS)).toBe(step);
  });

  test("10. a resolved row with no resolved notice resolves again, whatever the check says", () => {
    const row: AlertState = { ...sent("2026-11-20T09:00:00Z"), resolvedAt: new Date("2026-11-20T09:58:00Z") };
    expect(nextAlertStep(row, check("firing"), NOW, REPEAT_MS)).toBe("resolve");
    expect(nextAlertStep(row, check("between"), NOW, REPEAT_MS)).toBe("resolve");
    expect(nextAlertStep(row, check("clear"), NOW, REPEAT_MS)).toBe("resolve");
  });
});
