import { encode } from "uqr";

// otpauth://totp/<label>?secret=<base32>&… → the secret, or null when the URI is not a TOTP URI with a base32 secret.
export function totpSecretOf(uri: string): string | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== "otpauth:" || url.hostname !== "totp") return null;
  const secret = url.searchParams.get("secret");
  return secret !== null && /^[A-Z2-7]+=*$/.test(secret) ? secret : null;
}

// "ABCDEFGH…" → "ABCD EFGH …" (groups of 4, one space between).
export function groupSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? "";
}

// One SVG path of the dark modules; each run of dark modules in a row is one rectangle "M<x> <y>h<n>v1h-<n>z".
export function qrPath(text: string): { size: number; d: string } {
  const { size, data } = encode(text, { ecc: "M", border: 2 });
  const parts: string[] = [];
  for (let y = 0; y < size; y += 1) {
    const row = data[y] ?? [];
    let x = 0;
    while (x < size) {
      if (row[x] !== true) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < size && row[x] === true) x += 1;
      const run = x - start;
      parts.push(`M${start} ${y}h${run}v1h-${run}z`);
    }
  }
  return { size, d: parts.join("") };
}
