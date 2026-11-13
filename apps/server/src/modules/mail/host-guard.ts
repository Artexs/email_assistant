import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { SoftError } from "../../platform/errors";

import { isLocalAddress, isLocalMailHost } from "./host-check";
import { HostNotAllowedError } from "./port";

export type LookupAll = (host: string) => Promise<{ address: string; family: number }[]>;

export interface MailHostPolicy {
  allowLocal: boolean;
  lookup: LookupAll;
}

/** `servername` is set only when `host` is a resolved address: TLS still checks the certificate against the name. */
export interface MailTarget {
  host: string;
  servername?: string;
}

export const dnsLookupAll: LookupAll = (host) => lookup(host, { all: true, verbatim: true });

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
    throw new SoftError(`mail host lookup failed (${typeof code === "string" ? code : "UNKNOWN"})`, { cause: error });
  }
  if (addresses.length === 0) throw new SoftError("mail host lookup failed (ENODATA)");
  if (addresses.some((entry) => isLocalAddress(entry.address))) throw new HostNotAllowedError();

  const chosen = addresses.find((entry) => isIP(entry.address) === 4) ?? addresses[0];
  // Unreachable at run time (the list is not empty); `noUncheckedIndexedAccess` needs the narrowing.
  if (chosen === undefined) throw new SoftError("mail host lookup failed (ENODATA)");
  return { host: chosen.address, servername: name };
}
