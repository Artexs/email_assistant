import { describe, expect, test } from "bun:test";

import { type DrafterOutput, drafterOutputSchema } from "./schema";

const draft: DrafterOutput = { decision: "draft", reason_code: null, body: "Dzień dobry", gaps: [], language: "pl" };
const noDraft: DrafterOutput = { ...draft, decision: "no_draft", reason_code: "not_a_reply", body: "" };

function issuesOf(value: unknown): readonly { code: string; path: readonly PropertyKey[]; message: string }[] {
  const result = drafterOutputSchema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({ code: issue.code, path: issue.path, message: issue.message }));
}

describe("the drafter output schema", () => {
  test("a draft with a body and no reason parses to the same value", () => {
    expect(drafterOutputSchema.parse(draft)).toEqual(draft);
  });

  test.each([
    {
      name: "a draft with a reason code",
      value: { ...draft, reason_code: "needs_facts" },
      issues: [{ code: "custom", path: ["reason_code"], message: "reason_code must be null for a draft" }],
    },
    {
      name: "a draft with a blank body",
      value: { ...draft, body: "   " },
      issues: [{ code: "custom", path: ["body"], message: "a draft needs a body" }],
    },
    {
      name: "no draft without a reason code",
      value: { ...draft, decision: "no_draft", body: "" },
      issues: [{ code: "custom", path: ["reason_code"], message: "no_draft needs a reason_code" }],
    },
  ])("refuses $name with one exact issue", ({ value, issues }) => {
    expect(issuesOf(value)).toEqual(issues);
  });

  test("a draft with a reason code and a blank body gets both issues in order", () => {
    expect(issuesOf({ ...draft, reason_code: "needs_facts", body: "" })).toEqual([
      { code: "custom", path: ["reason_code"], message: "reason_code must be null for a draft" },
      { code: "custom", path: ["body"], message: "a draft needs a body" },
    ]);
  });

  test("no draft with a reason code needs no body", () => {
    expect(drafterOutputSchema.parse(noDraft)).toEqual(noDraft);
  });

  test.each([
    { name: "a body at the limit", value: { ...draft, body: "a".repeat(10_000) }, ok: true },
    { name: "a body over the limit", value: { ...draft, body: "a".repeat(10_001) }, ok: false },
    { name: "20 gaps", value: { ...draft, gaps: Array.from({ length: 20 }, () => "x") }, ok: true },
    { name: "21 gaps", value: { ...draft, gaps: Array.from({ length: 21 }, () => "x") }, ok: false },
    { name: "a gap of 200 characters", value: { ...draft, gaps: ["g".repeat(200)] }, ok: true },
    { name: "a gap of 201 characters", value: { ...draft, gaps: ["g".repeat(201)] }, ok: false },
    { name: "an extra key", value: { ...draft, to: "a@b.pl" }, ok: false },
    { name: "a language that is not pl or en", value: { ...draft, language: "de" }, ok: false },
  ])("limits: $name is ok = $ok", ({ value, ok }) => {
    expect(drafterOutputSchema.safeParse(value).success).toBe(ok);
  });
});
