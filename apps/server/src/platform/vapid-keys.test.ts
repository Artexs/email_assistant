import { createECDH } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { decodeBase64Url, generateVapidKeyPair, type KeyMaker, vapidPublicKeyOf } from "./vapid-keys";

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

  // Some runtimes return the private scalar without its leading zero bytes. The stand-in holds a real key with `zeros` leading
  // zero bytes and returns the scalar WITHOUT them, as such a runtime does.
  function shortScalarMaker(zeros: number): { make: () => KeyMaker; full: Buffer } {
    const full = Buffer.concat([Buffer.alloc(zeros), Buffer.from(crypto.getRandomValues(new Uint8Array(32 - zeros)))]);
    full[zeros] = (full[zeros] ?? 0) | 0x01; // never zero: the scalar is valid
    const real = createECDH("prime256v1");
    real.setPrivateKey(full);
    return {
      full,
      make: () => ({
        generateKeys: () => real.getPublicKey(),
        getPrivateKey: () => full.subarray(zeros),
        getPublicKey: () => real.getPublicKey(),
      }),
    };
  }

  test("TG1. a 31-byte and a 30-byte scalar are padded to 32 bytes and the public key still matches", () => {
    for (const zeros of [1, 2]) {
      const { make, full } = shortScalarMaker(zeros);
      expect(make().getPrivateKey().length).toBe(32 - zeros);
      const pair = generateVapidKeyPair(make);
      expect({ zeros, size: decodeBase64Url(pair.privateKey)?.length }).toEqual({ zeros, size: 32 });
      expect({ zeros, same: decodeBase64Url(pair.privateKey)?.equals(full) }).toEqual({ zeros, same: true });
      expect({ zeros, match: vapidPublicKeyOf(pair.privateKey) === pair.publicKey }).toEqual({ zeros, match: true });
    }
  });
});
