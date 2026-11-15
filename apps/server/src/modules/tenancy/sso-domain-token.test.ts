import { describe, expect, test } from "bun:test";

import { ssoDomainKey, ssoDomainRecord, ssoDomainToken } from "./sso-domain-token";

const KEY = Buffer.alloc(32, 7);
const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";

describe("ssoDomainToken", () => {
  test("1a: the same input gives the same 32 lower-case hex characters", () => {
    const first = ssoDomainToken(KEY, ORG, "x.test");
    expect(ssoDomainToken(KEY, ORG, "x.test")).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
  });

  test("1b: another domain, another organization or another key gives another token", () => {
    const base = ssoDomainToken(KEY, ORG, "x.test");
    expect(ssoDomainToken(KEY, ORG, "y.test")).not.toBe(base);
    expect(ssoDomainToken(KEY, OTHER_ORG, "x.test")).not.toBe(base);
    expect(ssoDomainToken(Buffer.alloc(32, 8), ORG, "x.test")).not.toBe(base);
  });

  test("1c: the record has the name and the value of the TXT", () => {
    expect(ssoDomainRecord(KEY, ORG, "x.test")).toEqual({
      name: "_ea-sso.x.test",
      value: `ea-sso=${ssoDomainToken(KEY, ORG, "x.test")}`,
    });
  });
});

describe("ssoDomainKey", () => {
  const credentials = Buffer.alloc(32, 3).toString("base64");

  test("1d: the same input gives the same 32 bytes; another input another bytes", () => {
    expect(ssoDomainKey(credentials).equals(ssoDomainKey(credentials))).toBe(true);
    expect(ssoDomainKey(credentials).length).toBe(32);
    expect(ssoDomainKey(Buffer.alloc(32, 4).toString("base64")).equals(ssoDomainKey(credentials))).toBe(false);
  });

  test("1e: the key is not the credentials key", () => {
    expect(ssoDomainKey(credentials).equals(Buffer.alloc(32, 3))).toBe(false);
  });

  test("1f: a key that is not base64 of 32 bytes throws without echoing it", () => {
    for (const bad of ["", "short", Buffer.alloc(16).toString("base64")]) {
      expect(() => ssoDomainKey(bad)).toThrow(TypeError);
    }
    try {
      ssoDomainKey("not-the-key-secret");
    } catch (error) {
      expect(String(error)).not.toContain("not-the-key-secret");
    }
  });
});
