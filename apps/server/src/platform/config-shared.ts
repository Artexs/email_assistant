import { isIP } from "node:net";

export const emptyAsUndefined = (v: unknown): unknown => (v === "" ? undefined : v);

// A browser origin: http(s) with host and optional port, no path, query, hash or trailing "/".
export function isOrigin(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
}

// An IP address, or a CIDR range "ip/n" with n in 0..32 (v4) or 0..128 (v6).
export function isIpOrCidr(value: string): boolean {
  const [ip = "", prefix, ...rest] = value.split("/");
  const family = isIP(ip);
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128);
}

// Comma-separated, trimmed, unique. An empty entry is dropped.
export function parseList(value: string | undefined): string[] {
  const items = (value ?? "").split(",").map((item) => item.trim());
  return [...new Set(items.filter((item) => item !== ""))];
}

export const addressPattern = /^[^\s@]+@[^\s@]+$/;

// Comma-separated, trimmed, lower-cased, unique. An empty entry is dropped.
export function parseAddressList(value: string | undefined): string[] {
  const items = (value ?? "").split(",").map((item) => item.trim().toLowerCase());
  return [...new Set(items.filter((item) => item !== ""))];
}

// `codes` are fixed reason codes of the config schema (`vapid_key_mismatch`), never a value.
export class ConfigError extends Error {
  constructor(
    readonly keys: string[],
    readonly codes: string[] = []
  ) {
    super(`Missing or bad config keys: ${keys.join(", ")}${codes.length === 0 ? "" : ` (${codes.join(", ")})`}`);
    this.name = "ConfigError";
  }
}
