import {
  assessSuspicious,
  freeMailDomains,
  isLookalike,
  registrableDomain,
  type SenderRule,
  type SuspiciousInput,
  type SuspiciousReason,
  DAY_MS,
  MINUTE_MS,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { Db, DB, TenantContext } from "../../platform/db";
import { getEmailHeaders, listMailboxes, userSentKey, sentRecipientDomains, type ClaimedEmail } from "../mail";
import { isFeatureOn, listMemberships } from "../tenancy";

import {
  FREQUENT_WINDOW_DAYS,
  listFrequentSenders,
  listNewestFromNames,
  suspiciousSenderDomains,
} from "./suspicious-repo";

// Domains the user writes to (flags `sender_context` and `suspicious_mail` both on): at least this many user mails in the window.
export const SENT_DOMAIN_MIN_MAILS = 2;
export const SENT_DOMAIN_WINDOW_DAYS = 90;
export const SENT_DOMAIN_LIMIT = 500;
// The reader may return more than the limit: the free-mail and suspicious filters cut the list before the limit applies.
const SENT_DOMAIN_READ_LIMIT = 5000;

// The context of `assessSuspicious` for one mailbox, read once per batch.
export interface SuspiciousContext {
  // Known senders get only `auth_fail` and `risky_attachment`. Case does not matter.
  isKnown(address: string | null): boolean;
  // The registrable domains of known addresses and domain rules. Frequent senders are not here: they never silence `lookalike_domain`.
  knownDomains: string[];
  // The registrable domains that the user wrote to (see `sentDomainsToKnow`): look-alike TARGETS only. A sender on one gets no
  // exemption from `lookalike_domain` and is not known by it, so the first mails of such a sender run every rule. Empty unless
  // both flags `sender_context` and `suspicious_mail` are on.
  sentDomains: string[];
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

interface SentCandidates {
  mails: number;
  newestSentId: string | null;
  at: number;
  domains: string[];
}

// A per-mailbox cache of the Sent candidates. The key is the count and the newest id of the user Sent mail (a new Sent mail ends the entry) and the age
// of 10 minutes (the 90-day window and the newest results of incoming mail move on). Staleness only ever keeps a target on the
// list a little longer, or leaves one off for 10 minutes; a target never exempts a sender. One entry per mailbox, at most 1000.
const SENT_CACHE_MAX_AGE_MS = 10 * MINUTE_MS;
const SENT_CACHE_MAX_ENTRIES = 1000;
const sentCache = new Map<string, SentCandidates>();

// For tests: forget every cached entry.
export function resetSentDomainCache(): void {
  sentCache.clear();
}

// The registrable domains of Sent mail that may become look-alike targets, most mailed first: at least `SENT_DOMAIN_MIN_MAILS` user
// mails in the window (the newest 5000 Sent mails are read), not a free-mail domain, not a tenant of a shared hosting suffix
// (it is not a registrable domain of its own), and no incoming mail of the window from the domain has a newest result with reasons.
async function sentCandidates(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  now: Date
): Promise<string[]> {
  const key = `${ctx.orgId}:${mailboxId}`;
  const { count: mails, newestId: newestSentId } = await userSentKey(db, ctx, mailboxId);
  const cached = sentCache.get(key);
  const age = cached === undefined ? -1 : now.getTime() - cached.at;
  if (
    cached !== undefined &&
    cached.mails === mails &&
    cached.newestSentId === newestSentId &&
    age >= 0 &&
    age < SENT_CACHE_MAX_AGE_MS
  ) {
    return cached.domains;
  }

  const since = new Date(now.getTime() - SENT_DOMAIN_WINDOW_DAYS * DAY_MS);
  let domains: string[] = [];
  const written =
    mails === 0
      ? []
      : await sentRecipientDomains(db, ctx, mailboxId, {
          since,
          minMails: SENT_DOMAIN_MIN_MAILS,
          limit: SENT_DOMAIN_READ_LIMIT,
        });
  const candidates = written.filter((row) => !isFreeMail(row.domain) && row.domain === registrableDomain(row.domain));
  if (candidates.length > 0) {
    const flagged = await suspiciousSenderDomains(db, ctx, mailboxId, since);
    domains = candidates.filter((row) => !flagged.has(row.domain)).map((row) => row.domain);
  }
  if (!sentCache.has(key) && sentCache.size >= SENT_CACHE_MAX_ENTRIES) {
    const oldest = sentCache.keys().next();
    if (oldest.done !== true) sentCache.delete(oldest.value);
  }
  sentCache.set(key, { mails, newestSentId, at: now.getTime(), domains });
  return domains;
}

// The look-alike targets from Sent mail, at most `SENT_DOMAIN_LIMIT`, in count order. A candidate is SKIPPED when it is already in
// the base list or looks like a domain already on the list (the base list or a more mailed candidate): the user may have mistyped
// an address, and a typo-squat must stay a look-alike of the real domain. A target never exempts itself and never makes its
// sender known: the exemption of `isLookalike` and the known-sender rule read the base list only.
async function sentDomainsToKnow(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  now: Date,
  base: readonly string[]
): Promise<string[]> {
  const list = [...base];
  const sent: string[] = [];
  for (const domain of await sentCandidates(db, ctx, mailboxId, now)) {
    if (sent.length >= SENT_DOMAIN_LIMIT) break;
    if (list.includes(domain) || isLookalike(domain, [], list)) continue;
    list.push(domain);
    sent.push(domain);
  }
  return sent;
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

  // The domains that the user writes to add look-alike targets (`sentDomains`). Both flags must be on: the reasons block drafts and
  // follow-ups whatever the flag `suspicious_mail` says, so with either flag off the context stays as it was. The module `contacts`
  // is a layer above this one: the plain flag `sender_context` is read here, not `senderFlags`.
  let sentDomains: string[] = [];
  if ((await isFeatureOn(db, ctx, "sender_context")) && (await isFeatureOn(db, ctx, "suspicious_mail"))) {
    sentDomains = await sentDomainsToKnow(db, ctx, mailbox.id, input.now, [...knownDomains]);
  }

  const since = new Date(input.now.getTime() - FREQUENT_WINDOW_DAYS * DAY_MS);
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
    sentDomains,
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
    sentDomains: context.sentDomains,
    protectedNames: context.protectedNames,
  };
  return assessSuspicious(input);
}
