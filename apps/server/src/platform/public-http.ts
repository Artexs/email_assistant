import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

import { isLocalAddress, type LookupAll } from "./net-address";

// The one place where the server sends a request to a URL that mail text names (RFC 8058 one-click
// unsubscribe). The URL is untrusted. This module can send ONE request: a POST with the fixed body
// `List-Unsubscribe=One-Click` to a public `https` host on port 443. What it does, in order:
//   1. It reads the URL and refuses a scheme, a user name, a port or a host form that is not a plain public name (an IP literal in
//      any spelling is refused: the URL parser has already turned `2130706433`, `0x7f.1` and `[::ffff:7f00:1]` into one form).
//   2. It resolves the host ONCE, through the injected `lookup`, and refuses the whole request when ANY answer is not a global
//      address (`isLocalAddress` plus the extra ranges below).
//   3. It connects to the first checked address (a literal, so the connection makes no second lookup and DNS rebinding has no
//      room); TLS checks the certificate against the host name (SNI), and `Host` is the host name.
//   4. It never follows a redirect, stops after `timeoutMs` for everything (lookup, connect, TLS, answer), reads at most
//      `MAX_RESPONSE_BYTES` of the answer and drops it. It never stores or returns the answer text.
// A result holds a short code only. No URL, host, address or answer text is in a result, an error or a log line.
//
// The seam for tests: `deps.dial` replaces step 3 only. The guard of steps 1 and 2 always runs, so a test cannot make it accept a
// loopback host (a test gives a lookup that answers a public address and a dial that reaches a local server). Production code
// calls `postOneClick(url, { lookup })` and never passes `dial` (a source scan in `public-http.test.ts` checks this).

export const ONE_CLICK_BODY = "List-Unsubscribe=One-Click";
export const ONE_CLICK_USER_AGENT = "email-assistant-unsubscribe/1";
export const ONE_CLICK_TIMEOUT_MS = 10_000;
/** The most bytes of the answer that the client reads before it drops the connection. */
export const MAX_RESPONSE_BYTES = 4096;
const MAX_HEADER_BYTES = 8192;

export interface OneClickResult {
  kind: "ok" | "refused" | "failed";
  /** `ok`: `http_<status>`. `refused` (nothing was sent): `scheme`, `userinfo`, `port`, `host`, `private_host`. `failed`: `dns`, `redirect`, `http_<status>`, `timeout`, `tls`, `connect`, `network`. */
  code: string;
}

/** What a dialer gets: a checked address and the exact request. It makes no lookup. */
export interface DialRequest {
  address: string;
  hostname: string;
  path: string;
  body: string;
  timeoutMs: number;
}

export type Dial = (request: DialRequest) => Promise<{ status: number }>;

export interface OneClickDeps {
  lookup: LookupAll;
  /** Test seam: replaces the connection. Production never sets it. */
  dial?: Dial;
  timeoutMs?: number;
}

// Ranges that `isLocalAddress` (mail hosts) leaves open and that no unsubscribe link may reach: documentation and relay
// ranges and the Azure wire server. IPv6 is also limited to global unicast (`2000::/3`), without the protocol block 2001::/23.
const extraV4 = new BlockList();
for (const [net, prefix] of [
  ["168.63.129.16", 32], // Azure wire server and metadata helper
  ["192.0.2.0", 24],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["192.88.99.0", 24],
] as const)
  extraV4.addSubnet(net, prefix, "ipv4");
const extraV6 = new BlockList();
for (const [net, prefix] of [
  ["2001:db8::", 32], // documentation
  ["3fff::", 20], // documentation (RFC 9637)
] as const)
  extraV6.addSubnet(net, prefix, "ipv6");
// 2001::/23 is the IANA "IETF protocol assignments" block (special-purpose registry, read from memory, checked 2026-11-18). It is
// not globally reachable (Teredo 2001::/32, benchmarking 2001:2::/48, ORCHID 2001:10::/28, and the rest), except for these entries
// that the registry marks "Globally Reachable: True": 2001:1::1/128 (PCP anycast), 2001:1::2/128 (TURN anycast), 2001:1::3/128
// (DNS-SD SRP anycast), 2001:3::/32 (AMT), 2001:4:112::/48 (AS112-v6), 2001:20::/28 (ORCHIDv2), 2001:30::/28 (Drone Remote ID).
const protocolV6 = new BlockList();
protocolV6.addSubnet("2001::", 23, "ipv6");
const protocolExceptionsV6 = new BlockList();
for (const [net, prefix] of [
  ["2001:1::1", 128],
  ["2001:1::2", 128],
  ["2001:1::3", 128],
  ["2001:3::", 32],
  ["2001:4:112::", 48],
  ["2001:20::", 28],
  ["2001:30::", 28],
] as const)
  protocolExceptionsV6.addSubnet(net, prefix, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

/** True when the connection to this address literal is allowed: a global unicast address that is in no refused range. */
export function isPublicAddress(address: string): boolean {
  // A zone id (`fe80::1%eth0`) names a local interface; a resolver never answers one for a public host.
  if (address.includes("%")) return false;
  if (isLocalAddress(address)) return false;
  const family = isIP(address);
  if (family === 4) return !extraV4.check(address, "ipv4");
  if (family === 6) {
    if (!globalV6.check(address, "ipv6") || extraV6.check(address, "ipv6")) return false;
    return !protocolV6.check(address, "ipv6") || protocolExceptionsV6.check(address, "ipv6");
  }
  return false;
}

// Name parts that never belong to a public host.
const LOCAL_TLDS: ReadonlySet<string> = new Set([
  "localhost",
  "local",
  "internal",
  "lan",
  "intranet",
  "corp",
  "home",
  "arpa",
  "onion",
]);
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

export type Target =
  | { ok: true; hostname: string; path: string }
  | { ok: false; code: "scheme" | "userinfo" | "port" | "host" | "private_host" };

/**
 * Reads the URL part of the guard. The WHATWG parser has made the host lower case, ASCII (punycode for an IDN) and, for an IPv4
 * literal, dotted decimal. Only the parsed parts are used, never the original text.
 */
export function readTarget(url: URL): Target {
  if (url.protocol !== "https:") return { ok: false, code: "scheme" };
  if (url.username !== "" || url.password !== "") return { ok: false, code: "userinfo" };
  if (url.port !== "" && url.port !== "443") return { ok: false, code: "port" };
  const hostname = url.hostname;
  if (hostname.startsWith("[") || isIP(hostname) !== 0) return { ok: false, code: "private_host" };
  const labels = hostname.split(".");
  const last = labels[labels.length - 1] ?? "";
  if (!HOSTNAME.test(hostname) || /^\d+$/.test(last) || LOCAL_TLDS.has(last)) return { ok: false, code: "host" };
  return { ok: true, hostname, path: `${url.pathname}${url.search}` };
}

class DeadlineError extends Error {}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineError("deadline")), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

const TLS_ERROR = /^(ERR_TLS_|ERR_SSL_|CERT_|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_|EPROTO|HANDSHAKE)/;
const CONNECT_ERROR = /^(ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN)$/;

function codeOfError(error: unknown): string {
  if (error instanceof DeadlineError) return "timeout";
  const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "";
  if (TLS_ERROR.test(code)) return "tls";
  if (CONNECT_ERROR.test(code)) return "connect";
  return "network";
}

/**
 * The real connection (step 3). `request.address` is a literal: the connection makes no lookup. `servername` makes TLS check the
 * certificate against the host name. `agent: false` gives every request its own socket (no pool, no cookie jar: Node has none).
 * `port` and `ca` exist for the test of this function with a local server and are fixed by `postOneClick`.
 */
export function sendPinned(
  request: DialRequest,
  transport: { port: number; ca?: string } = { port: 443 }
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const req = httpsRequest(
      {
        method: "POST",
        host: request.address,
        port: transport.port,
        servername: request.hostname,
        path: request.path,
        agent: false,
        maxHeaderSize: MAX_HEADER_BYTES,
        ...(transport.ca === undefined ? {} : { ca: transport.ca }),
        headers: {
          Host: request.hostname,
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(request.body),
          "User-Agent": ONE_CLICK_USER_AGENT,
          Accept: "*/*",
          Connection: "close",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        let read = 0;
        const finish = () => done(() => (req.destroy(), resolve({ status })));
        response.on("data", (chunk: Buffer) => {
          read += chunk.length;
          if (read >= MAX_RESPONSE_BYTES) finish();
        });
        response.on("end", finish);
        response.on("error", finish);
      }
    );
    const timer = setTimeout(() => {
      done(() => (req.destroy(), reject(new DeadlineError("deadline"))));
    }, request.timeoutMs);
    req.on("error", (error) => done(() => reject(error)));
    req.end(request.body);
  });
}

const defaultDial: Dial = (request) => sendPinned(request, { port: 443 });

/** Sends the one-click POST of RFC 8058 to `url` when the guard allows it. Never throws. */
export async function postOneClick(url: URL, deps: OneClickDeps): Promise<OneClickResult> {
  const target = readTarget(url);
  if (!target.ok) return { kind: "refused", code: target.code };
  const timeoutMs = deps.timeoutMs ?? ONE_CLICK_TIMEOUT_MS;
  const started = Date.now();

  let answers: Awaited<ReturnType<LookupAll>>;
  try {
    answers = await withDeadline(deps.lookup(target.hostname), timeoutMs);
  } catch (error) {
    return { kind: "failed", code: error instanceof DeadlineError ? "timeout" : "dns" };
  }
  const first = answers[0];
  if (first === undefined) return { kind: "failed", code: "dns" };
  // One private answer refuses the host: the next lookup of a rebinding name could return it.
  if (!answers.every((answer) => isPublicAddress(answer.address))) return { kind: "refused", code: "private_host" };

  try {
    const { status } = await (deps.dial ?? defaultDial)({
      address: first.address,
      hostname: target.hostname,
      path: target.path,
      body: ONE_CLICK_BODY,
      timeoutMs: Math.max(1, timeoutMs - (Date.now() - started)),
    });
    if (status >= 200 && status < 300) return { kind: "ok", code: `http_${status}` };
    if (status >= 300 && status < 400) return { kind: "failed", code: "redirect" };
    return { kind: "failed", code: `http_${status}` };
  } catch (error) {
    return { kind: "failed", code: codeOfError(error) };
  }
}
