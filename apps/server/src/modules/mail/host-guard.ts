import { isIP } from "node:net";

import { SoftError } from "../../platform/errors";
import { dnsLookupAll, isLocalAddress, type LookupAll } from "../../platform/net-address";

import { isLocalMailHost } from "./host-check";
import { HostNotAllowedError } from "./port";

export { dnsLookupAll, type LookupAll };

export interface MailHostPolicy {
  allowLocal: boolean;
  lookup: LookupAll;
}

/** `servername` is set only when `host` is a resolved address: TLS still checks the certificate against the name. */
export interface MailTarget {
  host: string;
  servername?: string;
}

export const DEFAULT_MAIL_HOST_POLICY: Readonly<MailHostPolicy> = Object.freeze({
  allowLocal: false,
  lookup: dnsLookupAll,
});

let current: MailHostPolicy = DEFAULT_MAIL_HOST_POLICY;

/** Sets the process policy. Without a call, local and private hosts stay refused. */
export function configureMailHosts(input: { allowLocal: boolean; lookup?: LookupAll }): void {
  current = { allowLocal: input.allowLocal, lookup: input.lookup ?? dnsLookupAll };
}

export function mailHostPolicy(): MailHostPolicy {
  return current;
}

/** A DNS lookup of a mail host failed. `code` is the system code (`ENOTFOUND`, `ENODATA`) or `UNKNOWN`; the message holds no host name. */
export class MailHostLookupError extends SoftError {
  readonly code: string;
  constructor(code: string, options?: { cause?: unknown }) {
    super(`mail host lookup failed (${code})`, options);
    this.name = "MailHostLookupError";
    this.code = code;
  }
}

/**
 * Turns a mail host name into one checked address. A host that is, or resolves to, a local, private, Tailscale or
 * benchmark address throws `HostNotAllowedError`. The caller connects to the returned address, so a second
 * lookup cannot answer another address (DNS rebinding). Error texts hold no host name and no address.
 */
export async function resolveMailHost(host: string, policy: MailHostPolicy = mailHostPolicy()): Promise<MailTarget> {
  if (policy.allowLocal) return { host };
  if (isLocalMailHost(host)) throw new HostNotAllowedError();

  const name = host.trim().replace(/\.+$/, "");
  const literal = name.replace(/^\[/, "").replace(/\]$/, "");
  if (isIP(literal) !== 0) return { host: literal };

  let addresses: { address: string; family: number }[];
  try {
    addresses = await policy.lookup(name);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    throw new MailHostLookupError(typeof code === "string" ? code : "UNKNOWN", { cause: error });
  }
  if (addresses.length === 0) throw new MailHostLookupError("ENODATA");
  if (addresses.some((entry) => isLocalAddress(entry.address))) throw new HostNotAllowedError();

  const chosen = addresses.find((entry) => isIP(entry.address) === 4) ?? addresses[0];
  // Unreachable at run time (the list is not empty); `noUncheckedIndexedAccess` needs the narrowing.
  if (chosen === undefined) throw new MailHostLookupError("ENODATA");
  return { host: chosen.address, servername: name };
}
