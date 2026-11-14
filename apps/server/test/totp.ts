import { createHmac } from "node:crypto";

// RFC 6238 for the tests: HMAC-SHA1, 6 digits, 30 s. `node:crypto` only.
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// RFC 4648 alphabet; padding and case are ignored.
export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error("not base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

export function totpCode(secretBase32: string, atMs: number = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000)));
  const hmac = createHmac("sha1", base32Decode(secretBase32)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    ((hmac[offset + 1] ?? 0) << 16) |
    ((hmac[offset + 2] ?? 0) << 8) |
    (hmac[offset + 3] ?? 0);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function secretOfUri(uri: string): string {
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) throw new Error("no secret in the URI");
  return secret;
}

// A 6-digit code matches only as a whole token; any other value as a substring.
export function holdsToken(line: string, token: string): boolean {
  if (/^\d{6}$/.test(token)) return new RegExp(`(^|\\D)${token}(\\D|$)`).test(line);
  return line.includes(token);
}
