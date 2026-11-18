import { createCipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";

import { decodeBase64Url, PRIVATE_KEY_BYTES, PUBLIC_KEY_BYTES } from "../../../platform/vapid-keys";

// Web Push message encryption: RFC 8291 on the `aes128gcm` content coding of RFC 8188. Pure: node:crypto only, no I/O.
// The body is `salt (16) || rs (4, big endian) || idlen (1) || keyid (65, the sender public key) || one record`.
// The record is AES-128-GCM of `plaintext || 0x02` (0x02 = padding delimiter of the last record) with the 16-byte tag appended.
// Errors hold a fixed text and a field name. They never hold key bytes, the auth secret or the plaintext.

export const RECORD_SIZE = 4096;
const SALT_BYTES = 16;
const AUTH_BYTES = 16;
const TAG_BYTES = 16;
const HEADER_BYTES = SALT_BYTES + 4 + 1 + PUBLIC_KEY_BYTES;
/** The push services accept a body of 4096 bytes; header, padding delimiter and tag take 103 of them. */
export const MAX_PLAINTEXT_BYTES = RECORD_SIZE - HEADER_BYTES - 1 - TAG_BYTES;

export type PushKeyField = "p256dh" | "auth" | "ephemeral" | "salt";

/** A subscription key (or a test seam value) is not a valid base64url value of the right size, or not a P-256 point. */
export class PushKeyError extends Error {
  constructor(readonly field: PushKeyField) {
    super("Push key is not valid");
    this.name = "PushKeyError";
  }
}

export class PushPayloadTooLarge extends Error {
  constructor() {
    super(`Push payload is larger than ${MAX_PLAINTEXT_BYTES} bytes`);
    this.name = "PushPayloadTooLarge";
  }
}

/** Raw P-256 key pair: 32-byte private scalar, 65-byte uncompressed public point. */
export interface KeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface EncryptDeps {
  /** Test seam: a fixed sender key (the RFC 8291 example). Production never sets it. */
  ephemeral?: KeyPair;
  /** Test seam: a fixed 16-byte salt. Production never sets it. */
  salt?: Uint8Array;
}

const textBytes = (text: string): Buffer => Buffer.from(text, "utf8");

function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Buffer {
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, length));
}

function newEphemeral(deps: EncryptDeps): { ecdh: ReturnType<typeof createECDH>; publicKey: Buffer } {
  const ecdh = createECDH("prime256v1");
  if (deps.ephemeral === undefined) {
    ecdh.generateKeys();
    return { ecdh, publicKey: ecdh.getPublicKey() };
  }
  const { privateKey, publicKey } = deps.ephemeral;
  if (privateKey.length !== PRIVATE_KEY_BYTES || publicKey.length !== PUBLIC_KEY_BYTES)
    throw new PushKeyError("ephemeral");
  try {
    ecdh.setPrivateKey(Buffer.from(privateKey));
  } catch {
    throw new PushKeyError("ephemeral");
  }
  const derived = ecdh.getPublicKey();
  if (!derived.equals(publicKey)) throw new PushKeyError("ephemeral");
  return { ecdh, publicKey: derived };
}

/** The `aes128gcm` body of one push message for one subscription (`p256dh` = the browser key, `auth` = the auth secret, both base64url). */
export function encryptPushPayload(
  sub: { p256dh: string; auth: string },
  plain: Uint8Array,
  deps: EncryptDeps = {}
): Uint8Array {
  if (plain.length > MAX_PLAINTEXT_BYTES) throw new PushPayloadTooLarge();
  const uaPublic = decodeBase64Url(sub.p256dh);
  if (uaPublic === null || uaPublic.length !== PUBLIC_KEY_BYTES || uaPublic[0] !== 0x04)
    throw new PushKeyError("p256dh");
  const authSecret = decodeBase64Url(sub.auth);
  if (authSecret === null || authSecret.length !== AUTH_BYTES) throw new PushKeyError("auth");
  if (deps.salt !== undefined && deps.salt.length !== SALT_BYTES) throw new PushKeyError("salt");
  const salt = deps.salt === undefined ? randomBytes(SALT_BYTES) : Buffer.from(deps.salt);

  const { ecdh, publicKey: asPublic } = newEphemeral(deps);
  let ecdhSecret: Buffer;
  try {
    // Throws for a point that is not on the curve.
    ecdhSecret = ecdh.computeSecret(uaPublic);
  } catch {
    throw new PushKeyError("p256dh");
  }

  // RFC 8291 §3.4: combine the ECDH secret with the auth secret, bound to both public keys.
  const keyInfo = Buffer.concat([textBytes("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hkdf(ecdhSecret, authSecret, keyInfo, 32);
  // RFC 8188 §2.2 and §2.3: the content encryption key and the nonce of the one record (sequence number 0).
  const cek = hkdf(ikm, salt, textBytes("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(ikm, salt, textBytes("Content-Encoding: nonce\0"), 12);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce, { authTagLength: TAG_BYTES });
  const record = Buffer.concat([
    cipher.update(Buffer.concat([Buffer.from(plain), Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const header = Buffer.alloc(SALT_BYTES + 5);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, SALT_BYTES);
  header[SALT_BYTES + 4] = PUBLIC_KEY_BYTES;
  return Buffer.concat([header, asPublic, record]);
}
