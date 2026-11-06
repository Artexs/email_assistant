import { describe, expect, test } from "bun:test";

import { costPerMail, llmPrices, monthlyCost } from "./cost";

describe("costPerMail", () => {
  test("uses the price of the day", () => {
    expect(costPerMail("gemini-3.8-flash", 1_000_000, 1_000_000, new Date("2026-12-31T23:59:59Z"))).toBeCloseTo(4.5);
  });

  test("switches the 3.8 Flash price on 2027-01-01", () => {
    expect(costPerMail("gemini-3.8-flash", 1_000_000, 1_000_000, new Date("2027-01-01T00:00:00Z"))).toBeCloseTo(9);
  });

  test("prices a Flash-Lite mail", () => {
    expect(costPerMail("gemini-3.5-flash-lite", 2000, 100, new Date("2026-11-05T00:00:00Z"))).toBeCloseTo(0.00085);
  });

  test("prices a gpt-6-luna mail", () => {
    expect(costPerMail("gpt-6-luna", 700, 90, new Date("2026-11-06T00:00:00Z"))).toBeCloseTo(0.000115);
  });

  test("an unknown model has no price", () => {
    expect(costPerMail("gemini-unknown", 100, 100, new Date("2026-11-05T00:00:00Z"))).toBeNull();
  });

  test("an Object.prototype key is not a model", () => {
    const date = new Date("2026-11-05T00:00:00Z");
    expect(costPerMail("constructor", 1, 1, date)).toBeNull();
    expect(costPerMail("toString", 1, 1, date)).toBeNull();
  });

  test("every price row names a source URL and a check date", () => {
    for (const rows of Object.values(llmPrices)) {
      for (const row of rows) {
        expect(row.source).toStartWith("https://");
        expect(row.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});

describe("monthlyCost", () => {
  test("multiplies by the mails per day and 30", () => {
    expect(monthlyCost(0.001, 200)).toBeCloseTo(6);
  });
});
