import { createPrivateKey, sign } from "node:crypto";

import {
  decodeBase64Url,
  encodeBase64Url,
  PRIVATE_KEY_BYTES,
  PUBLIC_KEY_BYTES,
  vapidPublicKeyOf,
} from "../../../platform/vapid-keys";

// VAPID (RFC 8292): the application server proves its identity to the push service with an ES256 JWT.
// `Authorization: vapid t=<jwt>, k=<public key>`. Claims: `aud` = origin of the endpoint, `exp` = now + 12 h, `sub` = contact URI.
// The private key is read from the config object only. No error and no result holds key text.

/** How long a JWT lives. RFC 8292 allows at most 24 hours; 12 hours leaves room for clock skew. */
export const VAPID_EXP_SECONDS = 12 * 60 * 60;

export interface VapidKeys {
  /** Base64url of the 65-byte uncompressed P-256 public key. */
  publicKey: string;
  /** Base64url of the 32-byte private scalar. */
  privateKey: string;
  /** `mailto:` or `https:` contact URI. */
  subject: string;
}

export class VapidError extends Error {
  constructor(readonly code: "bad_key" | "bad_endpoint") {
    super(code === "bad_key" ? "VAPID key is not valid" : "VAPID endpoint is not a URL");
    this.name = "VapidError";
  }
}

const jsonPart = (value: object): string => encodeBase64Url(Buffer.from(JSON.stringify(value), "utf8"));

/** The `Authorization` header for a push request to `endpoint`. */
export function vapidHeaders(endpoint: string, keys: VapidKeys, now: Date): { Authorization: string } {
  let origin: string;
  try {
    origin = new URL(endpoint).origin;
  } catch {
    throw new VapidError("bad_endpoint");
  }
  const privateRaw = decodeBase64Url(keys.privateKey);
  const publicRaw = decodeBase64Url(keys.publicKey);
  if (
    privateRaw === null ||
    privateRaw.length !== PRIVATE_KEY_BYTES ||
    publicRaw === null ||
    publicRaw.length !== PUBLIC_KEY_BYTES ||
    vapidPublicKeyOf(keys.privateKey) !== keys.publicKey
  ) {
    throw new VapidError("bad_key");
  }

  const signingInput = [
    jsonPart({ typ: "JWT", alg: "ES256" }),
    jsonPart({ aud: origin, exp: Math.floor(now.getTime() / 1000) + VAPID_EXP_SECONDS, sub: keys.subject }),
  ].join(".");
  const key = createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      d: keys.privateKey,
      x: encodeBase64Url(publicRaw.subarray(1, 33)),
      y: encodeBase64Url(publicRaw.subarray(33, 65)),
    },
  });
  // ES256 signs SHA-256 and writes r || s (64 bytes), not DER.
  const signature = sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
  return { Authorization: `vapid t=${signingInput}.${encodeBase64Url(signature)}, k=${keys.publicKey}` };
}
