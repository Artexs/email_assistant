import { describe, expect, test } from "bun:test";

import { HardError } from "../../../platform/errors";

import { decodeOAuthSecret, encodeOAuthSecret, type OAuthSecret } from "./secret-store";

const secret: OAuthSecret = {
  v: 1,
  provider: "microsoft",
  refreshToken: "rt-canary-value",
  tenantId: "11111111-1111-1111-1111-111111111111",
  scopes: ["a", "b"],
};

describe("the OAuth secret text", () => {
  test("a round trip keeps every field; Google keeps a null tenant", () => {
    expect(decodeOAuthSecret(encodeOAuthSecret(secret))).toEqual(secret);
    const google: OAuthSecret = { ...secret, provider: "google", tenantId: null };
    expect(decodeOAuthSecret(encodeOAuthSecret(google))).toEqual(google);
  });

  test("the text has the version 1 and no access token field", () => {
    const parsed = JSON.parse(encodeOAuthSecret(secret)) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["provider", "refreshToken", "scopes", "tenantId", "v"]);
    expect(parsed.v).toBe(1);
  });

  test("another shape is a HardError whose message holds none of the text", () => {
    const bad = [
      "not json rt-canary-value",
      "[]",
      "null",
      JSON.stringify({ ...secret, v: 2 }),
      JSON.stringify({ ...secret, provider: "yahoo" }),
      JSON.stringify({ ...secret, refreshToken: "" }),
      JSON.stringify({ ...secret, refreshToken: 5 }),
      JSON.stringify({ ...secret, scopes: "a b" }),
      JSON.stringify({ v: 1, provider: "google", refreshToken: "rt-canary-value", scopes: [] }),
      "a-plain-password",
    ];
    for (const text of bad) {
      let error: unknown;
      try {
        decodeOAuthSecret(text);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(HardError);
      expect((error as HardError).message).not.toContain("canary");
      expect((error as HardError).message).not.toContain("password");
    }
  });
});
