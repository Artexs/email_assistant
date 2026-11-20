import {
  addressSuggestionBlocked,
  DAY_MS,
  domainSuggestionBlocked,
  matchSender,
  normalizeAddress,
  registrableDomain,
  suggestionsFor,
  type SenderRule,
  type SuggestionCandidate,
  type SuggestionInput,
  type SuggestionKind,
  type SuggestionScope,
} from "@ea/core";
import { sql, type Transaction } from "kysely";

import { senderKeyHash } from "../../platform/crypto";
import type { DB, Db, TenantContext } from "../../platform/db";
import { createLog } from "../../platform/log";
import { listSenderRules } from "../config";
import { listDelegateAddresses } from "../delegation";
import { listMailboxes, type TestMailRule } from "../mail";

import { readSenderActivity, type ActivityScope, type SenderActivity } from "./activity";
import { sentCoverage } from "./flags";
import {
  bareInput,
  hostOf,
  inputOf,
  ruleAndDelegateMembers,
  rulePatternOf,
  suggestionPatternEligible,
} from "./suggest-input";

export { rulePatternOf, suggestionPatternEligible } from "./suggest-input";

type DbOrTrx = Db | Transaction<DB>;

const log = createLog("contacts");

// The life of a suggestion: an open one ends as `expired` after 30 days; a dismissed key stays hidden for 90
// days; at most 3 rows are created for a mailbox in 7 days (the cap itself is in `suggestionsFor`).
export const SUGGESTION_OPEN_DAYS = 30;
export const SUGGESTION_DISMISS_DAYS = 90;
const CAP_WINDOW_DAYS = 7;
const MAX_INSERT_ROUNDS = 3;
const CHECK_VIOLATION = "23514";

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
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  input: SuggestionPassInput
): Promise<void> {
  const { now } = input;
  const mailboxes = await listMailboxes(trx, ctx);
  const mailbox = mailboxes.find((candidate) => candidate.id === mailboxId);
  if (mailbox === undefined || mailbox.status !== "active") return;

  const coverage = await sentCoverage(trx, ctx, mailboxId, now);
  const standing = await standingOf(trx, ctx, mailboxId, mailboxes, input.activity);
  const { rules, inputs } = standing;

  await expire(trx, ctx, mailboxId, now);
  const open = await openRows(trx, ctx, mailboxId);
  const withdraw = open
    .filter((row) => row.pattern !== null && isWithdrawn(row, row.pattern, { ...standing, coverage }))
    .map((row) => row.id);
  await end(trx, ctx, mailboxId, withdraw, "withdrawn", now);

  const keyOf = (value: string): string => senderKeyHash(input.credentialsKey, ctx.orgId, value);
  // A candidate that the table still refuses (the validator is equal to the CHECK or stricter, so this is a safety net) is
  // skipped inside a savepoint and never reaches the pass transaction. Its pattern stays in memory only; the next round builds
  // the candidates again without it, so a bad one cannot hold a weekly slot. The log line holds a count, never an address.
  const rejected = new Set<string>();
  for (let round = 0; round < MAX_INSERT_ROUNDS; round += 1) {
    const open = await openRows(trx, ctx, mailboxId);
    const candidates = suggestionsFor(inputs, {
      dismissed: await dismissedKeys(trx, ctx, mailboxId, now),
      open: new Set(open.map((row) => `${row.kind}:${row.scope}:${row.key_hash}`)),
      createdLast7Days: await createdSince(trx, ctx, mailboxId, new Date(now.getTime() - CAP_WINDOW_DAYS * DAY_MS)),
      sentCoverage: coverage,
      keyOf,
      eligible: (pattern) => !rejected.has(pattern) && suggestionPatternEligible(pattern),
    });
    let refused = false;
    for (const candidate of candidates) {
      if (await insertCandidate(trx, ctx, mailboxId, candidate, now)) continue;
      rejected.add(candidate.pattern);
      refused = true;
    }
    if (!refused) break;
  }
  if (rejected.size > 0) {
    log
      .with({ org_id: ctx.orgId, mailbox_id: mailboxId })
      .warn("contacts_suggestion_refused", { count: rejected.size });
  }

  await end(trx, ctx, mailboxId, await coveredByDomainRow(trx, ctx, mailboxId), "withdrawn", now);
}

// One INSERT inside a savepoint. False when the table CHECK refuses the row (error code 23514): the savepoint is rolled back and
// the pass goes on. Any other error stops the pass.
async function insertCandidate(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  candidate: SuggestionCandidate,
  now: Date
): Promise<boolean> {
  await sql`SAVEPOINT sender_suggestion_insert`.execute(trx);
  try {
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
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== CHECK_VIOLATION) throw error;
    await sql`ROLLBACK TO SAVEPOINT sender_suggestion_insert`.execute(trx);
    return false;
  }
  await sql`RELEASE SAVEPOINT sender_suggestion_insert`.execute(trx);
  return true;
}

interface Standing {
  rules: SenderRule[];
  // The addresses of the activity.
  byAddress: ReadonlyMap<string, SuggestionInput>;
  byDomain: ReadonlyMap<string, SuggestionInput[]>;
  inputs: SuggestionInput[];
  // The facts of an address or domain that the activity does not show: no counts, but the rules, the delegates and the own domains apply.
  bare(address: string): SuggestionInput;
}

// What the engine knows about the senders of a mailbox now: the rules, the active delegates and the activity, as one
// `SuggestionInput` per address (plus the people that only a rule or a delegate names, so the domain protections see them).
async function standingOf(
  trx: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  mailboxes: readonly { address: string }[],
  activity: readonly SenderActivity[]
): Promise<Standing> {
  const rules = await listSenderRules(trx, ctx, mailboxId);
  const delegates = new Set((await listDelegateAddresses(trx, ctx, { activeOnly: true })).map(normalizeAddress));
  const ownDomains = new Set(mailboxes.map((box) => registrableDomain(hostOf(box.address))));
  const senders = activity.map((item) => inputOf(item, rules, delegates, ownDomains));
  const byAddress = new Map(senders.map((item) => [item.address, item]));
  // The domain protections also see the people that the user's rules and delegates name and that sent nothing in the window:
  // a domain whitelist must not override a block rule, a domain blocklist must not block a VIP, a whitelisted sender or an
  // active delegate. These entries have no counts, so they never become a candidate themselves.
  const inputs = [...senders, ...ruleAndDelegateMembers(byAddress, rules, delegates, ownDomains)];
  const byDomain = new Map<string, SuggestionInput[]>();
  for (const item of inputs) byDomain.set(item.domain, [...(byDomain.get(item.domain) ?? []), item]);
  return {
    rules,
    byAddress,
    byDomain,
    inputs,
    bare: (address) => bareInput(address, rules, delegates, ownDomains),
  };
}

// Accept asks this before it makes a rule: true when the row would end now (`isWithdrawn`, the check that the profile pass uses
// for an open row): a sender rule of its kind covers it, or a "never" condition holds (an active delegate, an answer or a Sent mail
// to the sender, a VIP or block rule, a suspicious mail, no Sent coverage for a blocklist). The read is bounded: only the mails
// of the row's address (or domain) of the 90 days, never the whole mailbox (`only` of `readSenderActivity`). A sender that the
// activity no longer shows is judged by the rules, the delegates and the coverage alone, so a row that outlives its counts
// (a row lives 30 days, its count needs 90) is checked too. A covering rule of the same kind blocks the row, with or without
// activity; that agrees with the pass, which withdraws such a row. The caller runs it outside the row lock.
export async function suggestionBlockedNow(
  db: DbOrTrx,
  ctx: TenantContext,
  row: { mailboxId: string; kind: SuggestionKind; scope: SuggestionScope; pattern: string },
  options: { now: Date; testMail: TestMailRule }
): Promise<boolean> {
  const mailboxes = await listMailboxes(db, ctx);
  const only: ActivityScope =
    row.scope === "domain" ? { domain: rulePatternOf(row.pattern) } : { address: row.pattern };
  const activity = await readSenderActivity(db, ctx, row.mailboxId, { ...options, only });
  const standing = await standingOf(db, ctx, row.mailboxId, mailboxes, activity);
  const coverage = await sentCoverage(db, ctx, row.mailboxId, options.now);
  return isWithdrawn(row, row.pattern, { ...standing, coverage });
}

interface WithdrawFacts {
  rules: readonly SenderRule[];
  coverage: boolean;
  byAddress: ReadonlyMap<string, SuggestionInput>;
  byDomain: ReadonlyMap<string, SuggestionInput[]>;
  bare(address: string): SuggestionInput;
}

// True when an open row must end now. A sender rule of the same kind covers the pattern (a VIP rule also covers a whitelist;
// `matchSender` has that rule), or a "never" condition holds. An address or domain that the activity does not show is judged by
// the rules, the delegates and the Sent coverage alone (`bare`): it ends when one of them protects it, else it stays open until
// it expires.
function isWithdrawn(row: Pick<OpenRow, "kind" | "scope">, pattern: string, facts: WithdrawFacts): boolean {
  const match = matchSender(pattern, facts.rules);
  if (row.kind === "vip" && match.vip) return true;
  if (row.kind === "whitelist" && match.whitelisted) return true;
  if (row.kind === "blocklist" && match.blocklisted) return true;
  // No Sent coverage ends a blocklist row too: `blocklistNever` and `domainSuggestionBlocked` hold that condition.
  if (row.scope === "address") {
    const item = facts.byAddress.get(pattern) ?? facts.bare(pattern);
    return addressSuggestionBlocked(row.kind, item, facts.coverage);
  }
  if (row.kind === "vip") return false;
  const domain = rulePatternOf(pattern);
  const members = facts.byDomain.get(domain) ?? [facts.bare(`domain-rule@${domain}`)];
  return domainSuggestionBlocked(row.kind, members, facts.coverage);
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
