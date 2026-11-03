import { randomBytes } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { CryptoError, createSecretBox } from "./crypto";

const key = randomBytes(32).toString("base64");
const otherKey = randomBytes(32).toString("base64");
const plain = "s3cret-mailbox-password";
const aad = "mailbox:11111111-1111-1111-1111-111111111111";

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("did not throw");
}

describe("createSecretBox", () => {
  test("decrypt gives back the plain text", () => {
    const box = createSecretBox(key, 1);
    const secret = box.encrypt(plain, aad);
    expect(secret.keyVersion).toBe(1);
    expect(box.decrypt(secret, aad)).toBe(plain);
  });

  test("two encrypt calls of the same text give different ciphertext", () => {
    const box = createSecretBox(key, 1);
    expect(box.encrypt(plain, aad).ciphertext).not.toBe(box.encrypt(plain, aad).ciphertext);
  });

  test("wrong aad throws CryptoError", () => {
    const box = createSecretBox(key, 1);
    const secret = box.encrypt(plain, aad);
    expect(() => box.decrypt(secret, "mailbox:other")).toThrow(CryptoError);
  });

  test("one changed byte throws CryptoError", () => {
    const box = createSecretBox(key, 1);
    const secret = box.encrypt(plain, aad);
    const bytes = Buffer.from(secret.ciphertext, "base64");
    for (const index of [0, 12, bytes.length - 1]) {
      const changed = Buffer.from(bytes);
      changed[index] = (changed[index] ?? 0) ^ 0x01;
      const tampered = { ...secret, ciphertext: changed.toString("base64") };
      expect(() => box.decrypt(tampered, aad)).toThrow(CryptoError);
    }
  });

  test("another key throws CryptoError", () => {
    const secret = createSecretBox(key, 1).encrypt(plain, aad);
    expect(() => createSecretBox(otherKey, 1).decrypt(secret, aad)).toThrow(CryptoError);
  });

  test("another keyVersion throws CryptoError", () => {
    const box = createSecretBox(key, 1);
    const secret = box.encrypt(plain, aad);
    expect(() => box.decrypt({ ...secret, keyVersion: 2 }, aad)).toThrow(CryptoError);
  });

  test("bad base64 or a too short ciphertext throws CryptoError", () => {
    const box = createSecretBox(key, 1);
    expect(() => box.decrypt({ ciphertext: "not base64!", keyVersion: 1 }, aad)).toThrow(CryptoError);
    expect(() => box.decrypt({ ciphertext: "", keyVersion: 1 }, aad)).toThrow(CryptoError);
    expect(() => box.decrypt({ ciphertext: "AAAA", keyVersion: 1 }, aad)).toThrow(CryptoError);
  });

  test("ciphertext does not contain the plain text", () => {
    const { ciphertext } = createSecretBox(key, 1).encrypt(plain, aad);
    expect(ciphertext).not.toContain(plain);
    expect(ciphertext).not.toContain(Buffer.from(plain).toString("base64"));
  });

  test("a 16-byte key throws CryptoError", () => {
    expect(() => createSecretBox(randomBytes(16).toString("base64"), 1)).toThrow(CryptoError);
  });

  test("a key that is not base64 throws CryptoError", () => {
    expect(() => createSecretBox(`${"x".repeat(43)}!`, 1)).toThrow(CryptoError);
  });

  test("error messages do not contain the plain text or the key", () => {
    const box = createSecretBox(key, 1);
    const secret = box.encrypt(plain, aad);
    const errors = [
      catchError(() => box.decrypt(secret, "mailbox:other")),
      catchError(() => box.decrypt({ ...secret, keyVersion: 2 }, aad)),
      catchError(() => createSecretBox(otherKey, 1).decrypt(secret, aad)),
    ];
    for (const error of errors) {
      expect(error).toBeInstanceOf(CryptoError);
      const message = (error as CryptoError).message;
      expect(message).not.toContain(plain);
      expect(message).not.toContain(key);
      expect(message).not.toContain(otherKey);
    }
    const shortKey = randomBytes(16).toString("base64");
    const keyError = catchError(() => createSecretBox(shortKey, 1));
    expect(keyError).toBeInstanceOf(CryptoError);
    expect((keyError as CryptoError).name).toBe("CryptoError");
    expect((keyError as CryptoError).message).not.toContain(shortKey);
  });
});
