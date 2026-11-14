import { afterEach, describe, expect, test } from "bun:test";

import { en } from "../i18n/en";
import { setLocaleForTest, t } from "../i18n";
import { ageText, costText, dayText, llmTodayText, shortId, sortNotices } from "./operator-view";

afterEach(() => setLocaleForTest("en"));

const NOW = new Date("2026-11-20T10:00:00Z");
const since = "2026-11-20T00:00:00.000Z";

describe("operator view helpers", () => {
  test("shortId keeps the first 8 characters", () => {
    expect(shortId("0b0f3b3e-6f1c-4d57-9d0e-3f0a8f6f2a11")).toBe("0b0f3b3e");
  });

  test("costText shows 4 decimals", () => {
    expect(costText(0.06)).toBe("$0.0600");
    expect(costText(0)).toBe("$0.0000");
  });

  test("llmTodayText adds the unpriced part only when there are unpriced calls", () => {
    const text = llmTodayText({ since, calls: 5, costUsd: 0.06, unpricedCalls: 2 });
    expect(text).toContain("5");
    expect(text).toContain("$0.0600");
    expect(text).toContain(t("op_llm_unpriced", { count: 2 }));
    const plain = llmTodayText({ since, calls: 5, costUsd: 0.06, unpricedCalls: 0 });
    expect(plain).toBe(t("op_llm_today", { calls: 5, cost: "$0.0600" }));
    expect(plain).not.toContain(t("op_llm_unpriced", { count: 0 }));
  });

  test("ageText picks the unit", () => {
    expect(ageText(null, NOW)).toBe(t("op_never"));
    expect(ageText("2026-11-20T09:59:30Z", NOW)).toBe(t("op_just_now"));
    expect(ageText("2026-11-20T09:55:00Z", NOW)).toBe(t("op_minutes_ago", { count: 5 }));
    expect(ageText("2026-11-20T08:00:00Z", NOW)).toBe(t("op_hours_ago", { count: 2 }));
    expect(ageText("2026-11-17T10:00:00Z", NOW)).toBe(t("op_days_ago", { count: 3 }));
    expect(ageText("2026-11-20T10:05:00Z", NOW)).toBe(t("op_just_now"));
  });

  test("ageText reads in Polish", () => {
    setLocaleForTest("pl");
    expect(ageText("2026-11-20T09:55:00Z", NOW)).toBe("5 min temu");
    expect(ageText(null, NOW)).toBe("nigdy");
  });

  test("dayText shows the UTC day or none", () => {
    expect(dayText(null)).toBe(t("op_none"));
    expect(dayText("2026-12-01T23:30:00Z")).toContain("2026");
    expect(dayText("2026-12-01T23:30:00Z")).toContain("1");
  });

  test("sortNotices orders by time descending, then organization id", () => {
    const rows = [
      { at: "2026-11-19T10:00:00Z", orgId: "a" },
      { at: "2026-11-20T09:00:00Z", orgId: "c" },
      { at: "2026-11-20T09:00:00Z", orgId: "b" },
    ];
    const copy = [...rows];
    expect(sortNotices(rows).map((row) => row.orgId)).toEqual(["b", "c", "a"]);
    expect(rows).toEqual(copy);
  });

  test("every op_ key the helpers use exists in English", () => {
    const used = [
      "op_never",
      "op_none",
      "op_just_now",
      "op_minutes_ago",
      "op_hours_ago",
      "op_days_ago",
      "op_llm_today",
      "op_llm_unpriced",
    ];
    for (const key of used) expect(Object.keys(en)).toContain(key);
  });
});
