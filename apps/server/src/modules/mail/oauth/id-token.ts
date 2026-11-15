// The ID token of a mailbox OAuth code redeem (F117 stage 08, D12, Q8). The token comes straight from the token endpoint over TLS:
// OpenID Connect Core 1.0 §3.1.3.7 rule 6 lets the client trust that channel in place of the signature. So this parser reads the
// payload only. It reads no header field and checks no signature. D18: the token and its claims never reach a log line or an error;
// a parse fault returns null and no text.

/** The claims the callback uses. Everything else in the payload is dropped. */
export interface IdTokenClaims {
  iss: string | null;
  /** One audience, or the list of them. */
  aud: string[];
  /** Seconds since the epoch. */
  exp: number | null;
  email: string | null;
  emailVerified: boolean | null;
  preferredUsername: string | null;
  /** Microsoft tenant id. */
  tid: string | null;
}

/** A real ID token is under 4 KiB; a longer value is not read. */
const MAX_TOKEN_CHARS = 16 * 1024;
const SEGMENT = /^[A-Za-z0-9_-]*$/;

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** The payload claims of `idToken`, or null when it is not three dot-separated segments with a JSON object payload. No signature check. */
export function parseIdTokenClaims(idToken: string): IdTokenClaims | null {
  if (idToken.length > MAX_TOKEN_CHARS) return null;
  const parts = idToken.split(".");
  const payload = parts[1];
  if (parts.length !== 3 || payload === undefined || payload === "" || !SEGMENT.test(payload)) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims !== "object" || claims === null || Array.isArray(claims)) return null;
  const raw = claims as Record<string, unknown>;
  const aud = Array.isArray(raw.aud)
    ? raw.aud.filter((item): item is string => typeof item === "string")
    : typeof raw.aud === "string"
      ? [raw.aud]
      : [];
  return {
    iss: text(raw.iss),
    aud,
    exp: typeof raw.exp === "number" && Number.isFinite(raw.exp) ? raw.exp : null,
    email: text(raw.email),
    emailVerified: typeof raw.email_verified === "boolean" ? raw.email_verified : null,
    preferredUsername: text(raw.preferred_username),
    tid: text(raw.tid),
  };
}
