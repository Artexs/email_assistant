import { describe, expect, test } from "bun:test";

import {
  type FeatureFlag,
  expiredFlags,
  featureEpicPattern,
  featureFlags,
  featureKeyPattern,
  featureKeys,
  isFeatureKey,
  resolveFeature,
} from "./features";

describe("featureFlags registry", () => {
  test("every flag has a valid key, description, epic and remove-by date", () => {
    for (const [key, flag] of Object.entries<FeatureFlag>(featureFlags)) {
      expect(key).toMatch(featureKeyPattern);
      expect(flag.description.length).toBeGreaterThan(0);
      expect(flag.description).toBe(flag.description.trim());
      expect(flag.epic).toMatch(featureEpicPattern);
      expect(flag.removeBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${flag.removeBy}T00:00:00Z`).toISOString().slice(0, 10)).toBe(flag.removeBy);
    }
  });

  test("the epic pattern accepts every epic code form and refuses the rest", () => {
    for (const ok of ["E3a", "E4-A", "E5a", "E7-T2", "E8-LR", "E11b", "E7i"]) {
      expect(featureEpicPattern.test(ok)).toBe(true);
    }
    for (const bad of ["E", "e3a", "E3-a", "E123"]) {
      expect(featureEpicPattern.test(bad)).toBe(false);
    }
  });

  test("the three placeholder flags exist and default off", () => {
    expect(featureFlags.stats_page.default).toBe(false);
    expect(featureFlags.approvals_page.default).toBe(false);
    expect(featureFlags.sent_sync.default).toBe(false);
  });

  test("featureKeys lists the registry keys in registry order", () => {
    expect(featureKeys).toEqual(Object.keys(featureFlags));
    expect(featureKeys.slice(0, 3)).toEqual(["stats_page", "approvals_page", "sent_sync"]);
  });

  test("isFeatureKey accepts registry keys only", () => {
    expect(isFeatureKey("stats_page")).toBe(true);
    for (const bad of ["STATS_PAGE", "", "stats_page ", "toString", "__proto__", "constructor"]) {
      expect(isFeatureKey(bad)).toBe(false);
    }
  });
});

describe("expiredFlags", () => {
  const flag = (removeBy: string): FeatureFlag => ({ default: false, description: "x", epic: "E1", removeBy });
  const fixture = { a: flag("2027-03-01"), b: flag("2027-04-01") };

  test("a flag is past its date the day after, not on the day", () => {
    expect(expiredFlags(fixture, "2027-02-28")).toEqual([]);
    expect(expiredFlags(fixture, "2027-03-01")).toEqual([]);
    expect(expiredFlags(fixture, "2027-03-02")).toEqual(["a"]);
    expect(expiredFlags(fixture, "2027-04-02")).toEqual(["a", "b"]);
  });

  test("no registry flag is past its remove-by date", () => {
    const today = new Date().toISOString().slice(0, 10);
    const lines = expiredFlags(featureFlags, today).map(
      (key) =>
        `flag ${key} is past its remove-by date ${featureFlags[key as keyof typeof featureFlags].removeBy}: open a cleanup ticket`
    );
    expect(lines).toEqual([]);
  });
});

describe("resolveFeature", () => {
  test.each([
    { defaultOn: true, killed: true, row: true, enabled: false, source: "env" },
    { defaultOn: false, killed: true, row: undefined, enabled: false, source: "env" },
    { defaultOn: true, killed: false, row: false, enabled: false, source: "row" },
    { defaultOn: false, killed: false, row: true, enabled: true, source: "row" },
    { defaultOn: false, killed: false, row: undefined, enabled: false, source: "default" },
    { defaultOn: true, killed: false, row: undefined, enabled: true, source: "default" },
  ] as const)("default $defaultOn, killed $killed, row $row → $enabled from $source", (row) => {
    const { enabled, source } = row;
    expect(resolveFeature({ defaultOn: row.defaultOn, killed: row.killed, row: row.row })).toEqual({ enabled, source });
  });
});
