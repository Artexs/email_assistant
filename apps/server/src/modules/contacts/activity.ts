import {
  DAY_MS,
  isNoreplyAddress,
  matchSender,
  normalizeAddress,
  registrableDomain,
  relationOf,
  type Category,
  type SenderHistory,
  type SenderRelation,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { listSenderRules } from "../config";
import { delegationCountsByDelegateAddress, listDelegateAddresses } from "../delegation";
import {
  incomingCountsBySender,
  ownAddressesOf,
  repliedBySentBySender,
  sentCountsByRecipient,
  theirReplyDelaysBySender,
  userReplyDelaysBySender,
  type SenderScope,
  type TestMailRule,
} from "../mail";
import { newestFeedbackBySender, newestResultsBySender } from "../triage";

type DbOrTrx = Db | Transaction<DB>;
type BulkSignal = SenderHistory["bulkSignals"][number];

// The window of the profile: mail received in the 90 days up to `now`.
export const PROFILE_DAYS = 90;
// A reply delay median needs this many samples.
const MIN_DELAY_SAMPLES = 5;
// A delay above this many hours is no sample: the column CHECK of `sender_profiles` allows up to 100000.
const MAX_DELAY_HOURS = 100_000;
// The Sent From addresses of one mailbox that the own-address set reads at most (as the loops reply rule).
const MAX_ALIASES = 100;

// What the pass knows about one sender address. It lives in memory only: the plain address never reaches a table or a log.
export interface SenderActivity {
  // Lower case.
  address: string;
  received: number;
  received30: number;
  answered: number;
  answered30: number;
  flagged: number;
  flagged30: number;
  unseen7d: number;
  movedBack: number;
  userMailsTo: number;
  delegationsTo: number;
  byCategory: Partial<Record<Category, number>>;
  corrections: Partial<Record<Category, number>>;
  // Mails whose newest feedback is a correction to `spam`, in the window.
  correctedToSpam90: number;
  // Distinct mails that the user moved back or corrected away from `spam` or `notification`.
  rescued90: number;
  // Mails whose newest triage result has suspicious reasons.
  suspicious90: number;
  // Incoming mails of the window that the user answered with a Sent mail (`parent_message_id` = the mail's Message-ID), to any
  // recipient: a reply to a Reply-To address counts too. In memory only (no profile column); the suggestion engine reads it.
  repliedBySent90: number;
  bulkSignals: BulkSignal[];
  // The mails whose captured headers are not cleared, plus the noreply mails; and how many of them are bulk.
  bulkBase: number;
  bulkMails: number;
  // Hours; null below 5 samples.
  medianUserReplyHours: number | null;
  medianTheirReplyHours: number | null;
  replySamplesTheirs: number;
  // Incoming mail only. Null for a contact that the user only wrote to.
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  lastUserMailAt: Date | null;
  relation: SenderRelation;
}

// One address, or one registrable domain with its subdomains.
export type ActivityScope = SenderScope;

export interface ReadActivityOptions {
  now: Date;
  // Test mail never counts.
  testMail: TestMailRule;
  // Read the activity of this address or domain only (the re-check of Accept). The reply delays and the delegation counts are
  // left out: the suggestion rules do not read them, and the Sent-wide delay read is the costly one.
  only?: ActivityScope;
}

const hostOf = (address: string): string => address.slice(address.lastIndexOf("@") + 1);

const emptyActivity = (address: string): SenderActivity => ({
  address,
  received: 0,
  received30: 0,
  answered: 0,
  answered30: 0,
  flagged: 0,
  flagged30: 0,
  unseen7d: 0,
  movedBack: 0,
  userMailsTo: 0,
  delegationsTo: 0,
  byCategory: {},
  corrections: {},
  correctedToSpam90: 0,
  rescued90: 0,
  suspicious90: 0,
  repliedBySent90: 0,
  bulkSignals: [],
  bulkBase: 0,
  bulkMails: 0,
  medianUserReplyHours: null,
  medianTheirReplyHours: null,
  replySamplesTheirs: 0,
  firstSeenAt: null,
  lastSeenAt: null,
  lastUserMailAt: null,
  relation: "new",
});

// The activity of every address that wrote to the mailbox or that the user wrote to, in the 90 days up to `now`.
// Set-based: a fixed number of statements for the mailbox, never one per sender. Every statement filters `org_id` and
// the mailbox. The plain addresses stay in memory: the caller hashes them before it writes (`senderKeyHash`). Own
// addresses and test mail never get a row. A mail counts once per address.
export async function readSenderActivity(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  options: ReadActivityOptions
): Promise<SenderActivity[]> {
  const { now, testMail, only } = options;
  const since = new Date(now.getTime() - PROFILE_DAYS * DAY_MS);
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const before7 = new Date(now.getTime() - 7 * DAY_MS);

  // The incoming mails of the window: the mail module owns the select; each reader below embeds it in its one statement.
  const windowOptions = { mailboxId, since, until: now, testMail, ...(only === undefined ? {} : { only }) };
  const own = await ownAddressesOf(db, ctx, mailboxId, { maxAliases: MAX_ALIASES });
  const rules = await listSenderRules(db, ctx, mailboxId);
  const delegateEmails = new Set((await listDelegateAddresses(db, ctx, { activeOnly: true })).map(normalizeAddress));

  const mails = await incomingCountsBySender(db, ctx, { ...windowOptions, since30, unseenBefore: before7 });

  const categories = await newestResultsBySender(db, ctx, windowOptions);
  // The newest feedback of each mail and the newest triage category: one correction per mail (a later mark replaces an earlier).
  const feedback = await newestFeedbackBySender(db, ctx, windowOptions);

  // The user's own mail (not system sends, not automatic replies) to each address in To or Cc, once per mail.
  const sent = await sentCountsByRecipient(db, ctx, {
    mailboxId,
    since,
    until: now,
    ...(only === undefined ? {} : { only }),
  });

  // The delays of the user's replies and of the replies to the user (the mail module owns both reads). A scope skips them.
  const userDelays =
    only !== undefined ? [] : await userReplyDelaysBySender(db, ctx, windowOptions, { maxHours: MAX_DELAY_HOURS });

  // The mails that the user answered with a Sent reply, whoever the reply went to (a reply goes to the Reply-To address, not
  // always to the sender). The profile counts `answered` from the IMAP flag only; this count is for the suggestion rules.
  const replied = await repliedBySentBySender(db, ctx, windowOptions);

  const theirDelays =
    only !== undefined ? [] : await theirReplyDelaysBySender(db, ctx, windowOptions, { maxHours: MAX_DELAY_HOURS });

  // The delegations of the mailbox per delegate address (the delegation module owns the read). A scope skips them.
  const delegations =
    only !== undefined ? [] : await delegationCountsByDelegateAddress(db, ctx, { mailboxId, since, until: now });

  const testSenders = new Set(testMail.senders.map(normalizeAddress));
  const byAddress = new Map<string, SenderActivity>();
  const entry = (address: string): SenderActivity | null => {
    if (own.has(address) || testSenders.has(address)) return null;
    let value = byAddress.get(address);
    if (value === undefined) {
      value = emptyActivity(address);
      byAddress.set(address, value);
    }
    return value;
  };

  for (const row of mails) {
    const item = entry(row.address);
    if (item === null) continue;
    const noreply = isNoreplyAddress(row.address);
    item.received = row.received;
    item.received30 = row.received30;
    item.answered = row.answered;
    item.answered30 = row.answered30;
    item.flagged = row.flagged;
    item.flagged30 = row.flagged30;
    item.unseen7d = row.unseen7d;
    item.firstSeenAt = row.firstAt;
    item.lastSeenAt = row.lastAt;
    // A noreply sender is bulk on every mail, whatever the age of its headers.
    item.bulkBase = noreply ? row.received : row.headersKept;
    item.bulkMails = noreply ? row.received : row.headersBulk;
    item.bulkSignals = [
      ...(row.listId ? (["list_id"] as const) : []),
      ...(row.listUnsubscribe ? (["list_unsubscribe"] as const) : []),
      ...(noreply ? (["noreply"] as const) : []),
      ...(row.autoSubmitted ? (["auto_submitted"] as const) : []),
    ];
  }
  for (const row of categories) {
    const item = byAddress.get(row.address);
    if (item === undefined) continue;
    item.byCategory[row.category] = row.mails;
    item.suspicious90 += row.suspicious;
  }
  for (const row of feedback) {
    const item = byAddress.get(row.address);
    if (item === undefined) continue;
    if (row.kind === "correction" && row.category !== null) {
      item.corrections[row.category] = row.mails;
      if (row.category === "spam") item.correctedToSpam90 = row.mails;
    } else if (row.kind === "moved_back") item.movedBack = row.mails;
    else if (row.kind === "rescued") item.rescued90 = row.mails;
  }
  for (const row of sent) {
    const item = entry(row.address);
    if (item === null) continue;
    item.userMailsTo = row.mails;
    item.lastUserMailAt = row.lastAt;
  }
  for (const row of replied) {
    const item = byAddress.get(row.address);
    if (item !== undefined) item.repliedBySent90 = row.mails;
  }
  for (const row of userDelays) {
    const item = byAddress.get(row.address);
    if (item !== undefined && row.samples >= MIN_DELAY_SAMPLES) item.medianUserReplyHours = row.medianHours;
  }
  for (const row of theirDelays) {
    const item = byAddress.get(row.address);
    if (item === undefined) continue;
    item.replySamplesTheirs = row.samples;
    if (row.samples >= MIN_DELAY_SAMPLES) item.medianTheirReplyHours = row.medianHours;
  }
  for (const row of delegations) {
    const item = byAddress.get(row.address);
    if (item !== undefined) item.delegationsTo = row.delegations;
  }

  for (const item of byAddress.values()) {
    item.relation = relationOf({
      isDelegate: delegateEmails.has(item.address),
      isVip: matchSender(item.address, rules).vip,
      received: item.bulkBase,
      bulkMails: item.bulkMails,
      answered: item.answered,
      userMailsTo: item.userMailsTo,
    });
  }
  const items = [...byAddress.values()].filter(
    (item) => only === undefined || "address" in only || registrableDomain(hostOf(item.address)) === only.domain
  );
  return items.sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
}
