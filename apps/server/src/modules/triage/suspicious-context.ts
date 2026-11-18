import {
  assessSuspicious,
  freeMailDomains,
  registrableDomain,
  type SenderRule,
  type SuspiciousInput,
  type SuspiciousReason,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { Db, DB, TenantContext } from "../../platform/db";
import { getEmailHeaders, listMailboxes, type ClaimedEmail } from "../mail";
import { listMemberships } from "../tenancy";

import { FREQUENT_WINDOW_DAYS, listFrequentSenders, listNewestFromNames } from "./suspicious-repo";

// The context of `assessSuspicious` for one mailbox, read once per batch.
export interface SuspiciousContext {
  // Known senders get only `auth_fail` and `risky_attachment`. Case does not matter.
  isKnown(address: string | null): boolean;
  // The registrable domains of known addresses and domain rules. Frequent senders are not here: they never silence `lookalike_domain`.
  knownDomains: string[];
  protectedNames: string[];
  trustedAuthservIds: string[];
}

// Accepted limit: mail that forges an own address or a domain of the organization counts as known.
// Only `auth_fail` catches it, and only when the mail host adds a trusted `Authentication-Results` header.

export interface SuspiciousContextInput {
  // The mailbox of this batch. `rules` are its rules and the organization rules; `delegates` the active delegates.
  mailbox: {
    id: string;
    rules: readonly SenderRule[];
    delegates: readonly { name: string; email: string }[];
  };
  // The IMAP host of the mailbox: its registrable domain is a trusted authserv-id.
  imapHost: string;
  // The sender addresses of the claimed batch: the frequency query runs once for all of them.
  senders: readonly (string | null)[];
  // `MAIL_TRUSTED_AUTHSERV_IDS`, lower case.
  trustedAuthservIds: readonly string[];
  now: Date;
}

function lower(address: string): string {
  return address.trim().toLowerCase();
}

function domainOf(address: string): string {
  return registrableDomain(address.slice(address.lastIndexOf("@") + 1));
}

function isFreeMail(domain: string): boolean {
  return freeMailDomains.includes(domain);
}

export async function loadSuspiciousContext(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: SuspiciousContextInput
): Promise<SuspiciousContext> {
  const { mailbox } = input;
  const addresses = new Set<string>();
  const knownDomains = new Set<string>();
  // Domains that make every sender on them known: never a free-mail domain.
  const senderDomains = new Set<string>();
  const addAddress = (address: string, byDomain: boolean): void => {
    const folded = lower(address);
    if (!folded.includes("@")) return;
    addresses.add(folded);
    const domain = domainOf(folded);
    knownDomains.add(domain);
    if (byDomain && !isFreeMail(domain)) senderDomains.add(domain);
  };

  for (const row of await listMailboxes(db, ctx)) addAddress(row.address, true);
  for (const delegate of mailbox.delegates) addAddress(delegate.email, true);

  const vipAddresses: string[] = [];
  for (const rule of mailbox.rules) {
    if (rule.kind === "blocklist") continue;
    const pattern = lower(rule.pattern);
    if (pattern.startsWith("@")) {
      const domain = registrableDomain(pattern.slice(1));
      knownDomains.add(domain);
      if (!isFreeMail(domain)) senderDomains.add(domain);
    } else {
      addAddress(pattern, false);
      if (rule.kind === "vip") vipAddresses.push(pattern);
    }
  }

  const since = new Date(input.now.getTime() - FREQUENT_WINDOW_DAYS * 24 * 3_600_000);
  const candidates = [...new Set(input.senders.flatMap((sender) => (sender === null ? [] : [lower(sender)])))];
  const frequent = new Set(await listFrequentSenders(db, ctx, mailbox.id, candidates, since));

  const memberNames = (await listMemberships(db, ctx)).map((member) => member.display_name);
  const vipNames = await listNewestFromNames(db, ctx, mailbox.id, vipAddresses, since);

  const trusted = new Set(input.trustedAuthservIds.map(lower));
  if (input.imapHost.trim() !== "") trusted.add(registrableDomain(input.imapHost));

  return {
    isKnown(address) {
      if (address === null) return false;
      const folded = lower(address);
      if (!folded.includes("@")) return false;
      return addresses.has(folded) || frequent.has(folded) || senderDomains.has(domainOf(folded));
    },
    knownDomains: [...knownDomains].sort(),
    protectedNames: [...new Set([...mailbox.delegates.map((delegate) => delegate.name), ...memberNames, ...vipNames])],
    trustedAuthservIds: [...trusted].sort(),
  };
}

// The reasons of one claimed mail. No `email_headers` row (old mail, failed capture) or a row with cleared texts: no name, no
// lists, no header; only the rules that need the address can fire. The log may carry the count, never a host, name or address.
export async function assessEmail(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  context: SuspiciousContext,
  email: Pick<ClaimedEmail, "id" | "from_address">
): Promise<SuspiciousReason[]> {
  const headers = await getEmailHeaders(db, ctx, email.id);
  const input: SuspiciousInput = {
    fromAddress: email.from_address ?? "",
    fromName: headers?.fromName ?? null,
    replyTo: headers?.replyTo ?? [],
    authResults: headers?.authResults ?? null,
    trustedAuthservIds: context.trustedAuthservIds,
    links: headers?.links ?? [],
    attachments: (headers?.attachments ?? []).map((item) => ({ name: item.name, type: item.type })),
    isList: headers !== undefined && (headers.listId !== null || headers.listUnsubscribe !== null),
    senderKnown: context.isKnown(email.from_address),
    knownDomains: context.knownDomains,
    protectedNames: context.protectedNames,
  };
  return assessSuspicious(input);
}
