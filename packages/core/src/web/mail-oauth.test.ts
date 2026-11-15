import { describe, expect, test } from "bun:test";

import { apiErrorCodes } from "./errors";
import { mailOAuthProviderKeys, mailOAuthProviderParamsSchema, mailOAuthStartBodySchema } from "./mail-oauth";

describe("mail OAuth start schemas", () => {
  test("the body takes no mailbox id, a uuid, and nothing else", () => {
    const id = "6f1c2c1e-8d5e-4b8e-9d57-0a3f2f5c7b11";
    expect(mailOAuthStartBodySchema.safeParse({}).success).toBe(true);
    expect(mailOAuthStartBodySchema.safeParse({ mailboxId: id }).success).toBe(true);
    expect(mailOAuthStartBodySchema.safeParse({ mailboxId: "not-a-uuid" }).success).toBe(false);
  });

  test("the provider param is one of the registry keys", () => {
    for (const provider of mailOAuthProviderKeys) {
      expect(mailOAuthProviderParamsSchema.safeParse({ provider }).success).toBe(true);
    }
    expect(mailOAuthProviderParamsSchema.safeParse({ provider: "yahoo" }).success).toBe(false);
  });

  test("the error codes of the start route are listed", () => {
    expect(apiErrorCodes).toContain("feature_off");
    expect(apiErrorCodes).toContain("not_configured");
  });
});
