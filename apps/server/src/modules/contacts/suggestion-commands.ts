import {
  isValidSenderPattern,
  suggestionReasonSchema,
  type SuggestionKind,
  type SuggestionReason,
  type SuggestionScope,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { auditEvents, recordAudit } from "../audit";
import { addSenderRule } from "../config";
import type { TestMailRule } from "../mail";

import { senderFlags } from "./flags";
import { rulePatternOf, suggestionBlockedNow } from "./suggest";

type DbOrTrx = Db | Transaction<DB>;

export interface SuggestionDeps {
  // A plain `Db` opens one transaction; a `Transaction` (a test) is the transaction.
  db: DbOrTrx;
  now(): Date;
  // The rule of test mail: Accept reads the sender activity again, and test mail never counts.
  testMail: TestMailRule;
}

export type SuggestionVia = "web" | "cli";

export interface SuggestionCommand {
  id: string;
  // The user id of the owner; the audit row names it, and a row of a user that exists records it as `ended_by`.
  actor: string;
  via: SuggestionVia;
}

export type AcceptResult = "accepted" | "already" | "rule_limit" | "not_available" | "not_found";
export type DismissResult = "dismissed" | "already" | "not_found";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function inTransaction<T>(db: DbOrTrx, run: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

interface LockedRow {
  id: string;
  mailbox_id: string;
  kind: SuggestionKind;
  scope: SuggestionScope;
  pattern: string | null;
  status: string;
}

// The row of this organization, locked until the end of the transaction: Accept and Dismiss on one row run one after the
// other, and the profile pass (which updates only a row that is still open) waits for it too.
async function lockRow(trx: DbOrTrx, ctx: TenantContext, id: string, lock = true): Promise<LockedRow | undefined> {
  if (!UUID.test(id)) return undefined;
  const query = trx
    .selectFrom("sender_suggestions")
    .select(["id", "mailbox_id", "kind", "scope", "pattern", "status"])
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId);
  const row = await (lock ? query.forUpdate() : query).executeTakeFirst();
  // The table CHECKs hold the values of `kind` and `scope`.
  return row === undefined
    ? undefined
    : { ...row, kind: row.kind as SuggestionKind, scope: row.scope as SuggestionScope };
}

async function endRow(
  trx: Transaction<DB>,
  ctx: TenantContext,
  row: LockedRow,
  status: "accepted" | "dismissed" | "withdrawn",
  command: { actor: string; now: Date }
): Promise<void> {
  await trx
    .updateTable("sender_suggestions")
    .set({
      status,
      pattern: null,
      ended_at: command.now,
      ended_by: status !== "withdrawn" && UUID.test(command.actor) ? command.actor : null,
    })
    .where("id", "=", row.id)
    .where("org_id", "=", ctx.orgId)
    .where("status", "=", "open")
    .execute();
}

async function isActiveMailbox(trx: Transaction<DB>, ctx: TenantContext, mailboxId: string): Promise<boolean> {
  const row = await trx
    .selectFrom("mailboxes")
    .select("status")
    .where("id", "=", mailboxId)
    .where("org_id", "=", ctx.orgId)
    .executeTakeFirst();
  return row?.status === "active";
}

// Is the sender of the open row protected now? Read before the row lock, so the lock is held only for the writes. The row is read
// without a lock first; a row that is not open, has no pattern, or sits in a mailbox that is not `active` is not checked (the
// locked part answers it). A sender that turns protected between this read and the lock is not caught: for example, a delegate
// that commits while Accept waits for the row lock is not seen, so the rule is made and stays. It is not withdrawn within the hour.
async function protectedNow(deps: SuggestionDeps, ctx: TenantContext, id: string, now: Date): Promise<boolean> {
  if (!(await senderFlags(deps.db, ctx)).suggestions) return false;
  const row = await lockRow(deps.db, ctx, id, false);
  if (row === undefined || row.status !== "open" || row.pattern === null) return false;
  const pattern = rulePatternOf(row.pattern);
  if (!isValidSenderPattern(pattern)) return false;
  const mailbox = await deps.db
    .selectFrom("mailboxes")
    .select("status")
    .where("id", "=", row.mailbox_id)
    .where("org_id", "=", ctx.orgId)
    .executeTakeFirst();
  if (mailbox?.status !== "active") return false;
  return suggestionBlockedNow(
    deps.db,
    ctx,
    { mailboxId: row.mailbox_id, kind: row.kind, scope: row.scope, pattern: row.pattern },
    { now, testMail: deps.testMail }
  );
}

// Accept: the owner makes the suggestion a sender rule of its mailbox. The route checks the role; the command trusts it. First
// `protectedNow` (no lock). Then one transaction: lock the row, then `addSenderRule` (`added` or `exists` both end the row as
// `accepted`), then the audit row. The audit data holds the mailbox, kind, scope and channel, never the pattern or the key.
// `not_found` also answers a flag that is off, another organization's id, and a mailbox that is not `active` (its profile is
// frozen, so the advice is not current; the row stays open and expires). At the rule limit the row stays open and nothing is
// written. `not_available`: the sender is protected now (a delegate, an answer, a rule or a suspicious mail that came after the
// row was made, or the Sent coverage is gone); the row ends as `withdrawn`, as the pass would end it, and no rule is made.
export async function acceptSuggestion(
  deps: SuggestionDeps,
  ctx: TenantContext,
  command: SuggestionCommand
): Promise<AcceptResult> {
  const now = deps.now();
  const blocked = await protectedNow(deps, ctx, command.id, now);
  return inTransaction(deps.db, async (trx) => {
    if (!(await senderFlags(trx, ctx)).suggestions) return "not_found";
    const row = await lockRow(trx, ctx, command.id);
    if (row === undefined) return "not_found";
    if (row.status !== "open") return "already";
    if (row.pattern === null || !(await isActiveMailbox(trx, ctx, row.mailbox_id))) return "not_found";
    const pattern = rulePatternOf(row.pattern);
    if (!isValidSenderPattern(pattern)) {
      // No rule can be made from it: the row ends and the owner never sees it again.
      await endRow(trx, ctx, row, "withdrawn", { actor: command.actor, now });
      return "not_found";
    }
    if (blocked) {
      await endRow(trx, ctx, row, "withdrawn", { actor: command.actor, now });
      return "not_available";
    }
    const added = await addSenderRule(trx, ctx, {
      mailboxId: row.mailbox_id,
      pattern,
      kind: row.kind,
      actor: command.actor,
      now,
    });
    if (added.kind === "limit") return "rule_limit";
    if (added.kind === "mailbox_not_found") return "not_found";
    await endRow(trx, ctx, row, "accepted", { actor: command.actor, now });
    await recordAudit(trx, ctx, {
      actor: command.actor,
      event: auditEvents.suggestionAccepted,
      data: { mailbox_id: row.mailbox_id, kind: row.kind, scope: row.scope, via: command.via },
      at: now,
    });
    return "accepted";
  });
}

// Dismiss: the key and kind stay hidden for 90 days (the generator reads the dismissed rows). The pattern is cleared.
export async function dismissSuggestion(
  deps: SuggestionDeps,
  ctx: TenantContext,
  command: SuggestionCommand
): Promise<DismissResult> {
  const now = deps.now();
  return inTransaction(deps.db, async (trx) => {
    if (!(await senderFlags(trx, ctx)).suggestions) return "not_found";
    const row = await lockRow(trx, ctx, command.id);
    if (row === undefined) return "not_found";
    if (row.status !== "open") return "already";
    // As Accept: a mailbox that is not `active` has no current suggestions, so the row is not the owner's to act on.
    if (!(await isActiveMailbox(trx, ctx, row.mailbox_id))) return "not_found";
    await endRow(trx, ctx, row, "dismissed", { actor: command.actor, now });
    await recordAudit(trx, ctx, {
      actor: command.actor,
      event: auditEvents.suggestionDismissed,
      data: { mailbox_id: row.mailbox_id, kind: row.kind, scope: row.scope, via: command.via },
      at: now,
    });
    return "dismissed";
  });
}

export interface OpenSuggestion {
  id: string;
  kind: SuggestionKind;
  scope: SuggestionScope;
  // The address or `@domain`: only an open row has one.
  pattern: string;
  reason: SuggestionReason;
  createdAt: Date;
}

// The open suggestions of one mailbox, newest first. Empty while the flag `sender_suggestions` is off, and for a mailbox that is
// not `active`: the profile behind the reasons is frozen there.
export async function listOpenSuggestions(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string
): Promise<OpenSuggestion[]> {
  if (!(await senderFlags(db, ctx)).suggestions) return [];
  const mailbox = await db
    .selectFrom("mailboxes")
    .select("status")
    .where("id", "=", mailboxId)
    .where("org_id", "=", ctx.orgId)
    .executeTakeFirst();
  if (mailbox?.status !== "active") return [];
  const rows = await db
    .selectFrom("sender_suggestions")
    .select(["id", "kind", "scope", "pattern", "reason", "created_at"])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("status", "=", "open")
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
  const items: OpenSuggestion[] = [];
  for (const row of rows) {
    if (row.pattern === null) continue;
    items.push({
      id: row.id,
      kind: row.kind as SuggestionKind,
      scope: row.scope as SuggestionScope,
      pattern: row.pattern,
      reason: suggestionReasonSchema.parse(row.reason),
      createdAt: row.created_at,
    });
  }
  return items;
}

export async function countOpenSuggestions(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<number> {
  return (await listOpenSuggestions(db, ctx, mailboxId)).length;
}

// The open suggestions of the organization, summed over its active mailboxes (the weekly report line). 0 while the flag
// `sender_suggestions` is off. The count only: no address leaves this function.
export async function countOpenSuggestionsOfOrg(db: DbOrTrx, ctx: TenantContext): Promise<number> {
  if (!(await senderFlags(db, ctx)).suggestions) return 0;
  const row = await db
    .selectFrom("sender_suggestions as s")
    .innerJoin("mailboxes as m", (join) => join.onRef("m.id", "=", "s.mailbox_id").onRef("m.org_id", "=", "s.org_id"))
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("s.org_id", "=", ctx.orgId)
    .where("s.status", "=", "open")
    .where("m.status", "=", "active")
    .executeTakeFirstOrThrow();
  return Number(row.n);
}
