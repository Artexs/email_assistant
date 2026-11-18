import { describe, expect, test } from "bun:test";

import { costPerMail, llmPrices, monthlyCost, priceRowFor, toEndpointKind } from "./cost";

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

  test("every price row names a source and a check date; only an unverified row has no URL", () => {
    for (const rows of Object.values(llmPrices)) {
      for (const row of rows) {
        if (row.unverified === true) expect(row.source).not.toBeEmpty();
        else expect(row.source).toStartWith("https://");
        expect(row.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  test("gpt-6.1-terra (the model of the F109 cascade eval) has a standard price row with a source and a date", () => {
    const rows = llmPrices["gpt-6.1-terra"] ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ inputPerM: 1, cachedInputPerM: 0.05, outputPerM: 5 });
    expect(rows[0]?.source).toStartWith("https://");
    expect(rows[0]?.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(costPerMail("gpt-6.1-terra", 1e6, 1e6, new Date("2026-11-15T00:00:00Z"))).toBeCloseTo(6, 10);
  });

  test("the EU price row is marked unverified (secondary source)", () => {
    const eu = (llmPrices["gpt-6-luna"] ?? []).filter((row) => row.endpoint === "eu");
    expect(eu).toHaveLength(1);
    expect(eu[0]?.unverified).toBe(true);
  });
});

describe("costPerMail by endpoint (F111 D7)", () => {
  const at = new Date("2026-11-15T00:00:00Z");

  test("no endpoint argument is the standard price; eu is the EU price; own is 0", () => {
    expect(costPerMail("gpt-6-luna", 1e6, 1e6, at)).toBeCloseTo(0.6, 10);
    expect(costPerMail("gpt-6-luna", 1e6, 1e6, at, "standard")).toBeCloseTo(0.6, 10);
    expect(costPerMail("gpt-6-luna", 1e6, 1e6, at, "eu")).toBeCloseTo(0.66, 10);
    expect(costPerMail("gpt-6-luna", 1e6, 1e6, at, "own")).toBe(0);
  });

  test("an own endpoint costs 0 also for a model with no price row", () => {
    expect(costPerMail("no-such-model", 10, 10, at, "own")).toBe(0);
  });

  test("a model with no EU row is unpriced on eu, not priced at the standard rate", () => {
    expect(costPerMail("gemini-3.8-flash", 1, 1, at, "eu")).toBeNull();
    expect(costPerMail("no-such-model", 1, 1, at, "eu")).toBeNull();
  });

  test("a standard call never takes the EU row", () => {
    expect(priceRowFor("gpt-6-luna", at, "standard")?.endpoint).toBeUndefined();
    expect(priceRowFor("gpt-6-luna", at, "eu")?.endpoint).toBe("eu");
    expect(priceRowFor("gpt-6-luna", at, "own")).toBeNull();
  });

  test("an EU row with `from` is picked only for eu, on or after `from`", () => {
    const key = "f111-test-model";
    llmPrices[key] = [
      { inputPerM: 1, outputPerM: 1, source: "https://example.test/std", checked: "2026-11-15" },
      {
        inputPerM: 2,
        outputPerM: 2,
        endpoint: "eu",
        from: "2026-12-01",
        source: "https://example.test/eu",
        checked: "2026-11-15",
      },
    ];
    try {
      const before = new Date("2026-11-30T23:59:59Z");
      const onDay = new Date("2026-12-01T00:00:00Z");
      expect(costPerMail(key, 1e6, 0, before, "eu")).toBeNull();
      expect(costPerMail(key, 1e6, 0, onDay, "eu")).toBeCloseTo(2, 10);
      expect(costPerMail(key, 1e6, 0, onDay, "standard")).toBeCloseTo(1, 10);
    } finally {
      Reflect.deleteProperty(llmPrices, key);
    }
  });
});

describe("toEndpointKind", () => {
  test("a missing key reads standard; a damaged value reads standard (the dearest rate)", () => {
    expect(toEndpointKind(undefined)).toBe("standard");
    expect(toEndpointKind(null)).toBe("standard");
    expect(toEndpointKind("OWN")).toBe("standard");
    expect(toEndpointKind(7)).toBe("standard");
    expect(toEndpointKind("eu")).toBe("eu");
    expect(toEndpointKind("own")).toBe("own");
  });
});

describe("monthlyCost", () => {
  test("multiplies by the mails per day and 30", () => {
    expect(monthlyCost(0.001, 200)).toBeCloseTo(6);
  });
});
