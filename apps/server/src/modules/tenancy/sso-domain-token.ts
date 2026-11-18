import { createHmac, hkdfSync } from "node:crypto";

// The keyed token of the domain proof. Pure: `node:crypto` only.
// The token is not a secret that the operator must hide: it goes into a public DNS record. The key stays secret, so a
// stranger cannot make the token of another organization.

const KEY_BYTES = 32;
const TOKEN_LENGTH = 32;
const KEY_INFO = "ea/sso-domain/v1";

// HKDF-SHA256 of the decoded credentials key (empty salt, info `ea/sso-domain/v1`, 32 bytes): the pattern of the DSR address
// hash (`dsrAddressHash`). A key that is not base64 of 32 bytes throws.
export function ssoDomainKey(credentialsKey: string): Buffer {
  const decoded = Buffer.from(credentialsKey, "base64");
  if (decoded.length !== KEY_BYTES || decoded.toString("base64") !== credentialsKey) {
    throw new TypeError(`Credentials key must be base64 of exactly ${KEY_BYTES} bytes`);
  }
  return Buffer.from(hkdfSync("sha256", decoded, Buffer.alloc(0), KEY_INFO, KEY_BYTES));
}

// Lower-case hex, the first 32 characters of HMAC-SHA256(key, `<org id>:<domain>`).
export function ssoDomainToken(key: Buffer, orgId: string, domain: string): string {
  return createHmac("sha256", key).update(`${orgId}:${domain}`, "utf8").digest("hex").slice(0, TOKEN_LENGTH);
}

// The TXT record the operator adds: name and value.
export function ssoDomainRecord(key: Buffer, orgId: string, domain: string): { name: string; value: string } {
  return { name: `_ea-sso.${domain}`, value: `ea-sso=${ssoDomainToken(key, orgId, domain)}` };
}
