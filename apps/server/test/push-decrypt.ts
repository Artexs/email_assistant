import { createDecipheriv, createECDH, createHmac } from "node:crypto";

// Test-side decrypt of a Web Push body (RFC 8291 on RFC 8188 `aes128gcm`). It has its own ECDH call and its own HKDF
// (HMAC-SHA-256 as in RFC 5869), so a test does not trust the code it checks: `push/encrypt.ts` uses `hkdfSync`.
// Stage 08 reuses it to read the body that the sender posts to a fake push service.

function hmac(key: Uint8Array, data: Uint8Array): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** RFC 5869 HKDF with SHA-256 for outputs of at most 32 bytes (one block): Extract, then one Expand block. */
export function hkdfSha256(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Buffer {
  const prk = hmac(salt, ikm);
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

export interface PushReceiver {
  /** Raw 32-byte private key of the subscription (the browser side). */
  privateKey: Uint8Array;
  /** Uncompressed 65-byte public key (`p256dh`). */
  publicKey: Uint8Array;
  /** The 16-byte auth secret. */
  auth: Uint8Array;
}

export interface ParsedBody {
  salt: Buffer;
  recordSize: number;
  keyId: Buffer;
  record: Buffer;
}

export function parseBody(body: Uint8Array): ParsedBody {
  const bytes = Buffer.from(body);
  const idLen = bytes[20] ?? 0;
  return {
    salt: bytes.subarray(0, 16),
    recordSize: bytes.readUInt32BE(16),
    keyId: bytes.subarray(21, 21 + idLen),
    record: bytes.subarray(21 + idLen),
  };
}

/** The plaintext of a one-record body. Throws when the tag, the padding delimiter or the header is wrong. */
export function decryptPushBody(body: Uint8Array, receiver: PushReceiver): Buffer {
  const { salt, recordSize, keyId, record } = parseBody(body);
  if (recordSize !== 4096) throw new Error("record size");
  if (keyId.length !== 65) throw new Error("key id");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(receiver.privateKey));
  const shared = ecdh.computeSecret(keyId);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), Buffer.from(receiver.publicKey), keyId]);
  const ikm = hkdfSha256(Buffer.from(receiver.auth), shared, keyInfo, 32);
  const cek = hkdfSha256(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdfSha256(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const padded = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  // RFC 8188 §2: the last record ends with 0x02 after the data (zero bytes may sit between data and delimiter).
  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0) end -= 1;
  if (end === 0 || padded[end - 1] !== 0x02) throw new Error("padding delimiter");
  return padded.subarray(0, end - 1);
}

/** A new random subscription (what a browser makes): keys as raw bytes and the base64url form of the server input. */
export function newReceiver(): {
  privateKey: Buffer;
  publicKey: Buffer;
  auth: Buffer;
  sub: { p256dh: string; auth: string };
} {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16)));
  const privateKey = Buffer.concat([Buffer.alloc(32 - ecdh.getPrivateKey().length), ecdh.getPrivateKey()]);
  const publicKey = ecdh.getPublicKey();
  return {
    privateKey,
    publicKey,
    auth,
    sub: { p256dh: publicKey.toString("base64url"), auth: auth.toString("base64url") },
  };
}
