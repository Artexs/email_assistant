import { createECDH } from "node:crypto";

// Raw P-256 key helpers for Web Push (RFC 8292 VAPID, RFC 8291). Keys are base64url without padding: the private key is the
// 32-byte scalar, the public key the 65-byte uncompressed point. Nothing here logs, and no error holds key text.

const BASE64URL = /^[A-Za-z0-9_-]+$/;
export const PRIVATE_KEY_BYTES = 32;
export const PUBLIC_KEY_BYTES = 65;

/** Bytes of an unpadded base64url string, or null for anything else (padding, `+`, `/`, spaces, empty). */
export function decodeBase64Url(value: string): Buffer | null {
  return BASE64URL.test(value) ? Buffer.from(value, "base64url") : null;
}

export function encodeBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export interface VapidKeyPair {
  publicKey: string;
  privateKey: string;
}

/** The part of `ECDH` that key generation uses. A test gives a stand-in that returns a short scalar. */
export interface KeyMaker {
  generateKeys(): unknown;
  getPrivateKey(): Buffer;
  getPublicKey(): Buffer;
}

/** A new random P-256 pair for `bun run push:keys`. `makeEcdh` is a test seam; production never passes it. */
export function generateVapidKeyPair(makeEcdh: () => KeyMaker = () => createECDH("prime256v1")): VapidKeyPair {
  const ecdh = makeEcdh();
  ecdh.generateKeys();
  // The scalar can lose leading zero bytes in some runtimes: pad it back to 32 bytes.
  const scalar = ecdh.getPrivateKey();
  const padded = Buffer.concat([Buffer.alloc(Math.max(0, PRIVATE_KEY_BYTES - scalar.length)), scalar]);
  return { publicKey: encodeBase64Url(ecdh.getPublicKey()), privateKey: encodeBase64Url(padded) };
}

/** The public key (base64url) that belongs to a raw private key, or null when the private key is not a valid P-256 scalar. */
export function vapidPublicKeyOf(privateKey: string): string | null {
  const raw = decodeBase64Url(privateKey);
  if (raw === null || raw.length !== PRIVATE_KEY_BYTES) return null;
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(raw);
    return encodeBase64Url(ecdh.getPublicKey());
  } catch {
    return null;
  }
}
