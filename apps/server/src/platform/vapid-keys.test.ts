import { describe, expect, test } from "bun:test";

import { decodeBase64Url, generateVapidKeyPair, vapidPublicKeyOf } from "./vapid-keys";

describe("vapid-keys", () => {
  test("a generated pair has a 32-byte private key and a 65-byte public key that belongs to it", () => {
    for (let i = 0; i < 20; i += 1) {
      const pair = generateVapidKeyPair();
      expect(decodeBase64Url(pair.privateKey)?.length).toBe(32);
      expect(decodeBase64Url(pair.publicKey)?.length).toBe(65);
      expect(vapidPublicKeyOf(pair.privateKey)).toBe(pair.publicKey);
    }
    expect(generateVapidKeyPair().privateKey).not.toBe(generateVapidKeyPair().privateKey);
  });

  test("decodeBase64Url refuses padding, the standard alphabet, spaces and the empty string", () => {
    for (const bad of ["", "ab==", "a+b/", "a b", "a\nb"])
      expect({ bad, out: decodeBase64Url(bad) }).toEqual({ bad, out: null });
    expect(decodeBase64Url("a-_b")?.length).toBe(3);
  });

  test("vapidPublicKeyOf is null for a bad private key (wrong size, not base64url, zero scalar)", () => {
    expect(vapidPublicKeyOf("")).toBeNull();
    expect(vapidPublicKeyOf("AAAA")).toBeNull();
    expect(vapidPublicKeyOf(Buffer.alloc(32).toString("base64url"))).toBeNull();
    expect(vapidPublicKeyOf("!".repeat(43))).toBeNull();
  });
});
