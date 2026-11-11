import { describe, expect, test } from "bun:test";

import { ruleBodySchema, ruleListSchema, rulesQuerySchema } from "./rules";

function issueOf(input: unknown): { message: string; path: string } | undefined {
  const result = ruleBodySchema.safeParse(input);
  if (result.success) return undefined;
  const [issue] = result.error.issues;
  return issue === undefined ? undefined : { message: issue.message, path: issue.path.join(".") };
}

describe("ruleBodySchema", () => {
  test("normalizes the pattern", () => {
    const result = ruleBodySchema.parse({ kind: "vip", pattern: " Anna@X.pl " });
    expect(result.pattern).toBe("anna@x.pl");
  });

  test("refuses a pattern without a local part and domain dot", () => {
    expect(issueOf({ kind: "vip", pattern: "@x.pl" })).toEqual({ message: "pattern_invalid", path: "pattern" });
  });

  test("refuses an unknown kind", () => {
    expect(issueOf({ kind: "other", pattern: "x.pl" })?.path).toBe("kind");
  });

  test("refuses a bad mailbox id", () => {
    expect(issueOf({ kind: "vip", pattern: "x.pl", mailboxId: "x" })?.path).toBe("mailboxId");
  });

  test("refuses a 255 character pattern", () => {
    expect(issueOf({ kind: "vip", pattern: "a".repeat(255) })).toEqual({
      message: "pattern_invalid",
      path: "pattern",
    });
  });
});

describe("rule lists and queries", () => {
  test("ruleListSchema parses a rule", () => {
    const rule = {
      id: "11111111-1111-4111-8111-111111111111",
      kind: "blocklist",
      pattern: "x.pl",
      mailboxId: null,
      createdAt: "2026-11-11T08:00:00.000Z",
    };
    expect(ruleListSchema.safeParse([rule]).success).toBe(true);
  });

  test("rulesQuerySchema allows no mailbox id", () => {
    expect(rulesQuerySchema.safeParse({}).success).toBe(true);
    expect(rulesQuerySchema.safeParse({ mailboxId: "x" }).success).toBe(false);
  });
});
