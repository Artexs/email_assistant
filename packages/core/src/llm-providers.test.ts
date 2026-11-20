import { describe, expect, test } from "bun:test";

import {
  llmProviderCatalog,
  llmProviderIds,
  llmRoleModels,
  llmTiers,
  providerEffort,
  tierModel,
} from "./llm-providers";
import { llmRoles } from "./llm-roles";
import { costPerMail, llmPrices, priceRowFor } from "./triage/cost";

describe("llm provider catalog", () => {
  test("every tier model of every row has a standard price row valid on 2026-11-19", () => {
    const at = new Date("2026-11-19T00:00:00Z");
    for (const id of llmProviderIds) {
      for (const tier of llmTiers) {
        const model = tierModel(id, tier);
        expect(Object.keys(llmProviderCatalog[id].prices)).toContain(model);
        expect(priceRowFor(model, at, "standard")).not.toBeNull();
      }
    }
  });

  test("no model id is in two rows: the flat map holds every row key", () => {
    const rowKeys = llmProviderIds.flatMap((id) => Object.keys(llmProviderCatalog[id].prices));
    expect(new Set(rowKeys).size).toBe(rowKeys.length);
    expect(Object.keys(llmPrices).sort()).toEqual([...rowKeys].sort());
  });

  test("deepseek prices a call at the peak rate", () => {
    const at = new Date("2026-11-20T00:00:00Z");
    expect(costPerMail("deepseek-flash", 1_000_000, 1_000_000, at)).toBeCloseTo(1.5, 10);
    expect(costPerMail("deepseek-v4-pro", 1_000_000, 1_000_000, at)).toBeCloseTo(5.28, 10);
  });

  test("a price moved from cost.ts keeps its value", () => {
    const at = new Date("2026-11-20T00:00:00Z");
    expect(costPerMail("gpt-6-luna", 1000, 100, at, "eu")).toBeCloseTo(0.000165, 10);
    expect(costPerMail("gpt-6-luna", 1000, 100, at)).toBeCloseTo(0.00015, 10);
  });

  test("the effort rule: gemini gets none, the others the role level", () => {
    expect(providerEffort("gemini", "low")).toBeNull();
    expect(providerEffort("deepseek", "none")).toBe("none");
    expect(providerEffort("openai", "low")).toBe("low");
  });

  test("every role has a tier and an effort; the judge uses the strong tier", () => {
    expect(Object.keys(llmRoleModels).sort()).toEqual([...llmRoles].sort());
    expect(tierModel("openai", "strong")).toBe("gpt-6.1-terra");
    expect(llmRoleModels.judge.tier).toBe("strong");
    for (const role of llmRoles) if (role !== "judge") expect(llmRoleModels[role].tier).toBe("light");
    expect(llmRoleModels.drafter.effort).toBe("low");
  });
});
