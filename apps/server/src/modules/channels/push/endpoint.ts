// The push endpoint comes from a browser (`PushSubscription.endpoint`), so it is untrusted. The server sends a
// request to it, so it must name one of the push services of the browser vendors and nothing else (SSRF guard). This check
// runs before any network step: at subscribe time and again in `sendWebPush`. It reads parsed URL parts only.

/** A host is allowed when it is one of these names or a sub-domain of one (a dot before the suffix, never a substring). */
export const PUSH_HOST_SUFFIXES: readonly string[] = [
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
];

/** The longest endpoint URL that the server accepts. Real endpoints are 100 to 500 characters. */
export const MAX_ENDPOINT_LENGTH = 2048;

export type PushEndpointCheck = { ok: true } | { ok: false; code: "push_host_not_allowed" | "bad_endpoint" };

export function hostAllowed(hostname: string): boolean {
  return PUSH_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

/** `https`, port 443 (or none), no user info, a host under the allowed push services. The result never holds the URL. */
export function checkPushEndpoint(endpoint: string): PushEndpointCheck {
  if (endpoint.length > MAX_ENDPOINT_LENGTH) return { ok: false, code: "bad_endpoint" };
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, code: "bad_endpoint" };
  }
  if (url.protocol !== "https:") return { ok: false, code: "bad_endpoint" };
  if (url.username !== "" || url.password !== "") return { ok: false, code: "bad_endpoint" };
  if (url.port !== "" && url.port !== "443") return { ok: false, code: "bad_endpoint" };
  // The WHATWG parser has made the host lower case, ASCII and (for an IP literal) canonical.
  if (!hostAllowed(url.hostname)) return { ok: false, code: "push_host_not_allowed" };
  return { ok: true };
}

/**
 * The one form of an endpoint that the server stores and hashes: the WHATWG serialization (no leading or trailing space, lower case host,
 * no `:443`). Without it one browser could register as several devices. Call it only after `checkPushEndpoint` returned ok.
 */
export function canonicalEndpoint(endpoint: string): string {
  return new URL(endpoint).href;
}
