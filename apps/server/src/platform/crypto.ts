import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";

// AES-256-GCM for mailbox secrets (ADR 0009).
// ciphertext = base64 of iv (12 bytes) || auth tag (16 bytes) || encrypted bytes.

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export interface EncryptedSecret {
  ciphertext: string;
  keyVersion: number;
}

export interface SecretBox {
  encrypt(plain: string, aad: string): EncryptedSecret;
  decrypt(secret: EncryptedSecret, aad: string): string;
}

// Messages never contain the plain text, the key or the ciphertext.
export class CryptoError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CryptoError";
  }
}

/** The stored secret was sealed under another key version than the configured one. A configuration problem, not a damaged secret. */
export class CryptoKeyVersionError extends CryptoError {
  constructor(stored: number, configured: number) {
    super(`Secret has key version ${stored}, configured is ${configured}`);
    this.name = "CryptoKeyVersionError";
  }
}

function decodeBase64(value: string): Buffer | null {
  return BASE64.test(value) ? Buffer.from(value, "base64") : null;
}

export function createSecretBox(keyBase64: string, keyVersion: number): SecretBox {
  const key = decodeBase64(keyBase64);
  if (key === null || key.length !== KEY_BYTES) {
    throw new CryptoError(`Credentials key must be base64 of exactly ${KEY_BYTES} bytes`);
  }
  if (!Number.isInteger(keyVersion) || keyVersion <= 0) {
    throw new CryptoError("Credentials key version must be a positive integer");
  }

  return {
    encrypt(plain, aad) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(Buffer.from(aad, "utf8"));
      const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      const ciphertext = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
      return { ciphertext, keyVersion };
    },

    decrypt(secret, aad) {
      if (secret.keyVersion !== keyVersion) {
        throw new CryptoKeyVersionError(secret.keyVersion, keyVersion);
      }
      const bytes = decodeBase64(secret.ciphertext);
      if (bytes === null || bytes.length < IV_BYTES + TAG_BYTES) {
        throw new CryptoError("Secret ciphertext is not valid");
      }
      const iv = bytes.subarray(0, IV_BYTES);
      const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const encrypted = bytes.subarray(IV_BYTES + TAG_BYTES);
      try {
        const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
        decipher.setAAD(Buffer.from(aad, "utf8"));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
      } catch (error) {
        throw new CryptoError("Secret decryption failed: wrong key, wrong aad or changed data", { cause: error });
      }
    },
  };
}

// DSR tombstones: the SHA-256 hex of the dedup key without a trailing `#<n>` copy suffix.
// The trigger `emails_skip_tombstoned` computes the same value in SQL; a test pins them equal.
export function tombstoneKeyHash(dedupKey: string): string {
  return createHash("sha256")
    .update(dedupKey.replace(/#[0-9]+$/, ""), "utf8")
    .digest("hex");
}

const DSR_HASH_INFO = "ea/dsr-address/v1";
const SENDER_KEY_INFO = "ea/sender-profile/v1";

// The hash of a DSR address for the audit row: HMAC-SHA256 hex over the normalized address. The key is the
// HKDF-SHA256 of the credentials key (empty salt, info `ea/dsr-address/v1`, 32 bytes), so a person who reads the audit
// table without the credentials key cannot test guessed addresses against it. A change of the credentials key makes
// old hashes unmatchable. The caller normalizes the address first; this module cannot import the privacy module.
export function dsrAddressHash(credentialsKeyBase64: string, address: string): string {
  const key = decodeBase64(credentialsKeyBase64);
  if (key === null || key.length !== KEY_BYTES) {
    throw new CryptoError(`Credentials key must be base64 of exactly ${KEY_BYTES} bytes`);
  }
  const derived = Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), DSR_HASH_INFO, KEY_BYTES));
  return createHmac("sha256", derived).update(address, "utf8").digest("hex");
}

// The key of a sender in the profile and suggestion tables: HMAC-SHA256 hex over `<orgId>:<value>`, with a key
// derived by HKDF-SHA256 from the credentials key (empty salt, info `ea/sender-profile/v1`). The org id in the message
// gives a different key for the same address in each organization. The value is an address or `@domain`; the caller
// normalizes it (trim, lower case). The hash never leaves the server. A change of the credentials key orphans old rows.
export function senderKeyHash(credentialsKeyBase64: string, orgId: string, value: string): string {
  const key = decodeBase64(credentialsKeyBase64);
  if (key === null || key.length !== KEY_BYTES) {
    throw new CryptoError(`Credentials key must be base64 of exactly ${KEY_BYTES} bytes`);
  }
  const derived = Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), SENDER_KEY_INFO, KEY_BYTES));
  return createHmac("sha256", derived).update(`${orgId}:${value}`, "utf8").digest("hex");
}
