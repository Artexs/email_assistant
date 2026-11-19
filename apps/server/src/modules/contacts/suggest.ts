import {
  addressSuggestionBlocked,
  DAY_MS,
  domainSuggestionBlocked,
  freeMailDomains,
  isNoreplyAddress,
  isSharedHostingDomain,
  isValidSenderPattern,
  matchSender,
  normalizeSenderAddress,
  registrableDomain,
  suggestionsFor,
  type SenderRule,
  type SuggestionInput,
  type SuggestionKind,
  type SuggestionScope,
} from "@ea/core";
import { sql, type Transaction } from "kysely";

import { senderKeyHash } from "../../platform/crypto";
import type { DB, Db, TenantContext } from "../../platform/db";
import { listSenderRules } from "../config";
import { listDelegateAddresses } from "../delegation";
import { listMailboxes } from "../mail";

import type { SenderActivity } from "./activity";
import { sentCoverage } from "./flags";

type DbOrTrx = Db | Transaction<DB>;

// The life of a suggestion: an open one ends as `expired` after 30 days; a dismissed key stays hidden for 90
// days; at most 3 rows are created for a mailbox in 7 days (the cap itself is in `suggestionsFor`).
export const SUGGESTION_OPEN_DAYS = 30;
export const SUGGESTION_DISMISS_DAYS = 90;
const CAP_WINDOW_DAYS = 7;

// The sender rule that an accepted suggestion becomes: an address stays as it is, a domain loses the `@` (a sender rule for a
// domain has no `@`; with it the rule would never match).
export function rulePatternOf(pattern: string): string {
  return pattern.startsWith("@") ? pattern.slice(1) : pattern;
}

// A pattern is eligible when it can become a valid sender rule: ASCII letters, digits and hyphens in the domain. An address or
// domain with other letters (an internationalized domain) is never suggested, so it cannot take one of the three weekly slots.
export function suggestionPatternEligible(pattern: string): boolean {
  return isValidSenderPattern(rulePatternOf(pattern));
}

function hostOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1);
}

interface OpenRow {
  id: string;
  kind: SuggestionKind;
  scope: SuggestionScope;
  key_hash: string;
  pattern: string | null;
  created_at: Date;
}

export interface SuggestionPassInput {
  // The activity that the same pass read for the profiles: one entry per address of the window.
  activity: readonly SenderActivity[];
  credentialsKey: string;
  now: Date;
}

// The suggestion step of the profile pass. It runs inside the pass transaction, after the profile writes, so it holds the
// profile lock of the mailbox and reads the same activity. Order: (1) open rows older than 30 days end as `expired`; (2) an open
// row ends as `withdrawn` when a sender rule of its kind covers its pattern or a "never" condition is true now (never for a
// ratio below its rule); (3) candidates are built from the activity and the rules and inserted as `open`; (4) an open address row
// that an open domain row of the same kind covers ends as `withdrawn`. An ended row has no pattern. A mailbox that is not
// `active` (paused, `auth_error`, `host_blocked`) gets nothing: the job skips it, so its profile is frozen, and a suggestion made
// from a frozen profile is not current. The step writes no log line and no audit row (a withdrawn or expired row is not a user act).
export async function refreshSuggestions(
  trx: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  input: SuggestionPassInput
): Promise<void> {
  const { now } = input;
  const mailboxes = await listMailboxes(trx, ctx);
  const mailbox = mailboxes.find((candidate) => candidate.id === mailboxId);
  if (mailbox === undefined || mailbox.status !== "active") return;

  const coverage = await sentCoverage(trx, ctx, mailboxId, now);
  const rules = await listSenderRules(trx, ctx, mailboxId);
  const delegates = new Set((await listDelegateAddresses(trx, ctx, { activeOnly: true })).map(normalizeSenderAddress));
  const ownDomains = new Set(mailboxes.map((box) => registrableDomain(hostOf(box.address))));
  const inputs = input.activity.map((item) => inputOf(item, rules, delegates, ownDomains));
  const byAddress = new Map(inputs.map((item) => [item.address, item]));
  const byDomain = new Map<string, SuggestionInput[]>();
  for (const item of inputs) byDomain.set(item.domain, [...(byDomain.get(item.domain) ?? []), item]);

  await expire(trx, ctx, mailboxId, now);
  const open = await openRows(trx, ctx, mailboxId);
  const withdraw = open
    .filter((row) => row.pattern !== null && isWithdrawn(row, row.pattern, { rules, coverage, byAddress, byDomain }))
    .map((row) => row.id);
  await end(trx, ctx, mailboxId, withdraw, "withdrawn", now);
  const stillOpen = open.filter((row) => !withdraw.includes(row.id));

  const keyOf = (value: string): string => senderKeyHash(input.credentialsKey, ctx.orgId, value);
  const candidates = suggestionsFor(inputs, {
    dismissed: await dismissedKeys(trx, ctx, mailboxId, now),
    open: new Set(stillOpen.map((row) => `${row.kind}:${row.scope}:${row.key_hash}`)),
    createdLast7Days: await createdSince(trx, ctx, mailboxId, new Date(now.getTime() - CAP_WINDOW_DAYS * DAY_MS)),
    sentCoverage: coverage,
    keyOf,
    eligible: suggestionPatternEligible,
  });
  for (const candidate of candidates) {
    await trx
      .insertInto("sender_suggestions")
      .values({
        org_id: ctx.orgId,
        mailbox_id: mailboxId,
        key_hash: candidate.key,
        scope: candidate.scope,
        kind: candidate.kind,
        pattern: candidate.pattern,
        reason: JSON.stringify(candidate.reason),
        created_at: now,
      })
      .onConflict((conflict) =>
        conflict.columns(["mailbox_id", "scope", "key_hash", "kind"]).where("status", "=", "open").doNothing()
      )
      .execute();
  }

  await end(trx, ctx, mailboxId, await coveredByDomainRow(trx, ctx, mailboxId), "withdrawn", now);
}

function inputOf(
  item: SenderActivity,
  rules: readonly SenderRule[],
  delegates: ReadonlySet<string>,
  ownDomains: ReadonlySet<string>
): SuggestionInput {
  const domain = registrableDomain(hostOf(item.address));
  const match = matchSender(item.address, rules);
  return {
    address: item.address,
    domain,
    // A shared hosting domain (`github.io`) counts like free mail: a rule on it would cover every tenant.
    isFreeMailDomain: freeMailDomains.includes(domain) || isSharedHostingDomain(domain),
    isOwnDomain: ownDomains.has(domain),
    // The pass gives no row to an own address, so none reaches this point.
    isOwn: false,
    isNoreply: isNoreplyAddress(item.address),
    relation: item.relation,
    received30: item.received30,
    answered30: item.answered30,
    flagged30: item.flagged30,
    correctedToSpam90: item.correctedToSpam90,
    rescued90: item.rescued90,
    answered90: item.answered,
    userMailsTo90: item.userMailsTo,
    suspicious90: item.suspicious90,
    isVip: match.vip,
    isWhitelisted: match.whitelisted,
    isBlocklisted: match.blocklisted,
    isDelegate: delegates.has(item.address),
  };
}

interface WithdrawFacts {
  rules: readonly SenderRule[];
  coverage: boolean;
  byAddress: ReadonlyMap<string, SuggestionInput>;
  byDomain: ReadonlyMap<string, SuggestionInput[]>;
}

// True when an open row must end now. A sender rule of the same kind covers the pattern (a VIP rule also covers a whitelist;
// `matchSender` has that rule), or a "never" condition holds. A row whose address or domain the activity no longer shows
// can be judged by the rules and by the Sent coverage only: it stays open until it expires.
function isWithdrawn(row: OpenRow, pattern: string, facts: WithdrawFacts): boolean {
  const match = matchSender(pattern, facts.rules);
  if (row.kind === "vip" && match.vip) return true;
  if (row.kind === "whitelist" && match.whitelisted) return true;
  if (row.kind === "blocklist" && match.blocklisted) return true;
  if (row.kind === "blocklist" && !facts.coverage) return true;
  if (row.scope === "address") {
    const item = facts.byAddress.get(pattern);
    return item !== undefined && addressSuggestionBlocked(row.kind, item, facts.coverage);
  }
  if (row.kind === "vip") return false;
  const members = facts.byDomain.get(rulePatternOf(pattern)) ?? [];
  return members.length > 0 && domainSuggestionBlocked(row.kind, members, facts.coverage);
}

async function openRows(trx: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<OpenRow[]> {
  const rows = await trx
    .selectFrom("sender_suggestions")
    .select(["id", "kind", "scope", "key_hash", "pattern", "created_at"])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("status", "=", "open")
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  // The table CHECKs hold the values of `kind` and `scope`.
  return rows.map((row) => ({ ...row, kind: row.kind as SuggestionKind, scope: row.scope as SuggestionScope }));
}

// Ends open rows of this mailbox. Only a row that is still open changes: an Accept or a Dismiss that holds the row lock wins.
async function end(
  trx: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  ids: readonly string[],
  status: "withdrawn" | "expired",
  now: Date
): Promise<void> {
  if (ids.length === 0) return;
  await sql`
    UPDATE sender_suggestions
    SET status = ${status}, pattern = NULL, ended_at = ${now}
    WHERE org_id = ${ctx.orgId} AND mailbox_id = ${mailboxId} AND status = 'open' AND id = ANY(${ids}::uuid[])
  `.execute(trx);
}

async function expire(trx: DbOrTrx, ctx: TenantContext, mailboxId: string, now: Date): Promise<void> {
  await sql`
    UPDATE sender_suggestions
    SET status = 'expired', pattern = NULL, ended_at = ${now}
    WHERE org_id = ${ctx.orgId} AND mailbox_id = ${mailboxId} AND status = 'open'
      AND created_at < ${new Date(now.getTime() - SUGGESTION_OPEN_DAYS * DAY_MS)}
  `.execute(trx);
}

// The keys of the rows that the user dismissed in the last 90 days: `kind:scope:key`.
async function dismissedKeys(trx: DbOrTrx, ctx: TenantContext, mailboxId: string, now: Date): Promise<Set<string>> {
  const rows = await trx
    .selectFrom("sender_suggestions")
    .select(["kind", "scope", "key_hash"])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("status", "=", "dismissed")
    .where("ended_at", ">=", new Date(now.getTime() - SUGGESTION_DISMISS_DAYS * DAY_MS))
    .execute();
  return new Set(rows.map((row) => `${row.kind}:${row.scope}:${row.key_hash}`));
}

// Rows created since `since`, in any status: the weekly cap counts a row that ended too.
async function createdSince(trx: DbOrTrx, ctx: TenantContext, mailboxId: string, since: Date): Promise<number> {
  const row = await trx
    .selectFrom("sender_suggestions")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("created_at", ">=", since)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

// The open address rows that an open domain row of the same kind covers (a domain rule covers the subdomains too).
async function coveredByDomainRow(trx: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<string[]> {
  const open = await openRows(trx, ctx, mailboxId);
  const domainRules: SenderRule[] = [];
  for (const row of open) {
    if (row.scope === "domain" && row.pattern !== null && row.kind !== "vip") {
      domainRules.push({ pattern: rulePatternOf(row.pattern), kind: row.kind });
    }
  }
  if (domainRules.length === 0) return [];
  const covered: string[] = [];
  for (const row of open) {
    if (row.scope !== "address" || row.pattern === null) continue;
    const match = matchSender(
      row.pattern,
      domainRules.filter((rule) => rule.kind === row.kind)
    );
    if ((row.kind === "whitelist" && match.whitelisted) || (row.kind === "blocklist" && match.blocklisted)) {
      covered.push(row.id);
    }
  }
  return covered;
}
