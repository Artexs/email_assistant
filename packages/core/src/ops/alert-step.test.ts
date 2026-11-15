import { describe, expect, test } from "bun:test";

import { nextAlertStep, type AlertState } from "./alert-step";
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
  test("1. no row and firing opens", () => {
    expect(nextAlertStep(null, check("firing"), NOW, REPEAT_MS)).toBe("open");
  });

  test("2. no row and clear does nothing", () => {
    expect(nextAlertStep(null, check("clear"), NOW, REPEAT_MS)).toBe("none");
  });

  test("3. no row and between does nothing", () => {
    expect(nextAlertStep(null, check("between"), NOW, REPEAT_MS)).toBe("none");
  });

  test("4. an open notice that was not sent is sent again while firing", () => {
    expect(nextAlertStep(unsent, check("firing"), NOW, REPEAT_MS)).toBe("open");
  });

  test("4b. an open notice that was not sent is sent again while between", () => {
    expect(nextAlertStep(unsent, check("between"), NOW, REPEAT_MS)).toBe("open");
  });

  test("5. an open notice that was not sent closes silently when clear", () => {
    expect(nextAlertStep(unsent, check("clear"), NOW, REPEAT_MS)).toBe("silent_close");
  });

  test("6. firing less than 6 h after the last notice does nothing", () => {
    expect(nextAlertStep(sent("2026-11-20T04:00:01Z"), check("firing"), NOW, REPEAT_MS)).toBe("none");
  });

  test("7. firing exactly 6 h after the last notice repeats", () => {
    expect(nextAlertStep(sent("2026-11-20T04:00:00Z"), check("firing"), NOW, REPEAT_MS)).toBe("repeat");
  });

  test("8. between 7 h after the last notice repeats", () => {
    expect(nextAlertStep(sent("2026-11-20T03:00:00Z"), check("between"), NOW, REPEAT_MS)).toBe("repeat");
  });

  test("8b. between less than 6 h after the last notice does nothing", () => {
    expect(nextAlertStep(sent("2026-11-20T09:00:00Z"), check("between"), NOW, REPEAT_MS)).toBe("none");
  });

  test("9. clear after an open notice resolves", () => {
    expect(nextAlertStep(sent("2026-11-20T09:55:00Z"), check("clear"), NOW, REPEAT_MS)).toBe("resolve");
  });

  test("10. a resolved row with no resolved notice resolves again, whatever the check says", () => {
    const row: AlertState = { ...sent("2026-11-20T09:00:00Z"), resolvedAt: new Date("2026-11-20T09:58:00Z") };
    expect(nextAlertStep(row, check("firing"), NOW, REPEAT_MS)).toBe("resolve");
    expect(nextAlertStep(row, check("between"), NOW, REPEAT_MS)).toBe("resolve");
    expect(nextAlertStep(row, check("clear"), NOW, REPEAT_MS)).toBe("resolve");
  });
});
