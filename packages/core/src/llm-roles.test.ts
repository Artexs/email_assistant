import { describe, expect, test } from "bun:test";

import { isLlmRole, llmRoles, type PromptVersion } from "./llm-roles";

describe("llm roles", () => {
  test("the role list is fixed", () => {
    expect([...llmRoles]).toEqual(["classifier", "judge", "drafter", "extractor", "escalation"]);
  });

  test("isLlmRole accepts a role and refuses other strings", () => {
    expect(isLlmRole("judge")).toBe(true);
    expect(isLlmRole("writer")).toBe(false);
    expect(isLlmRole("toString")).toBe(false);
    expect(isLlmRole("")).toBe(false);
  });

  test("a prompt version starts with its role", () => {
    const ok: PromptVersion<"classifier"> = "classifier-v2";
    // @ts-expect-error a judge version is not a classifier version
    const wrong: PromptVersion<"classifier"> = "judge-v1";
    expect([ok, wrong]).toHaveLength(2);
  });
});
