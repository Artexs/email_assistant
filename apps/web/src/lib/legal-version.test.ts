import { TERMS_HISTORY } from "@ea/core/web";
import { describe, expect, test } from "bun:test";

import { legalTextParts, legalTextsDigest } from "./legal-checks";

describe("legalTextsDigest", () => {
  test("1. a CRLF line end gives the digest of an LF line end", () => {
    expect(legalTextsDigest(["x\r\n"])).toBe(legalTextsDigest(["x\n"]));
  });

  test("1. the order of the parts changes the digest, and so does a split", () => {
    expect(legalTextsDigest(["a", "b"])).not.toBe(legalTextsDigest(["b", "a"]));
    expect(legalTextsDigest(["ab"])).not.toBe(legalTextsDigest(["a", "b"]));
  });

  test("the digest is 64 hex characters", () => {
    expect(legalTextsDigest(["x"])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the version guard", () => {
  test("the parts hold the six pages, two registries and both languages of the legal keys", () => {
    const parts = legalTextParts();
    expect(parts.length).toBeGreaterThan(6 + 2 + 2);
    expect(parts.some((part) => part.startsWith("tg_consent_text="))).toBe(true);
    expect(parts.some((part) => part.startsWith("legal_draft_line="))).toBe(true);
  });

  test("2. the last TERMS_HISTORY digest equals the digest of the current texts", () => {
    const last = TERMS_HISTORY[TERMS_HISTORY.length - 1];
    const digest = legalTextsDigest(legalTextParts());
    // A mismatch: a legal text, a registry, a legal_* key or tg_consent_text changed since the last entry.
    expect(
      last?.sha256,
      `append a new TERMS_HISTORY entry in packages/core/src/web/terms.ts (digest of the current texts: ${digest})`
    ).toBe(digest);
  });
});
