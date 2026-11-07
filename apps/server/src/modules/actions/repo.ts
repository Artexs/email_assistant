import {
  actionTypes,
  folderKeys,
  MAILBOX_ACTION_TYPES,
  type ActionType,
  type ActionView,
  type FolderKey,
  type MailboxActionType,
} from "@ea/core";
import { sql, type Expression, type ExpressionBuilder, type SqlBool, type Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";
import { mailKindFilter } from "../mail";

type DbOrTrx = Db | Transaction<DB>;

const actionTypeSchema = z.enum(actionTypes);

export interface PlannedActionInput {
  type: ActionType;
  payload: Record<string, string>;
  status: "ready" | "awaiting_approval" | "logged";
  idempotencyKey: string;
}

export interface CreatedAction {
  id: string;
  type: ActionType;
  status: string;
}

export interface ActionRow {
  id: string;
  type: string;
  status: string;
  payload: unknown;
}

// The status change of the email and these rows go in one transaction: the caller passes `trx`.
// A key that exists in this org inserts nothing; the result holds only the inserted rows.
export async function createPlanned(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string,
  items: PlannedActionInput[]
): Promise<CreatedAction[]> {
  if (items.length === 0) {
    return [];
  }
  const rows = await db
    .insertInto("actions")
    .values(
      items.map((item) => ({
        org_id: ctx.orgId,
        email_id: emailId,
        type: item.type,
        payload: JSON.stringify(item.payload),
        status: item.status,
        idempotency_key: item.idempotencyKey,
      }))
    )
    .onConflict((oc) => oc.columns(["org_id", "idempotency_key"]).doNothing())
    .returning(["id", "type", "status"])
    .execute();
  return rows.map((row) => ({ id: row.id, type: actionTypeSchema.parse(row.type), status: row.status }));
}

// Oldest first.
export async function listActionsForEmail(db: DbOrTrx, ctx: TenantContext, emailId: string): Promise<ActionRow[]> {
  return db
    .selectFrom("actions")
    .select(["id", "type", "status", "payload"])
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "=", emailId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

// Other modules read summaries only through this function: the actions module owns the payload.
export async function listSummaries(db: DbOrTrx, ctx: TenantContext, emailIds: string[]): Promise<Map<string, string>> {
  if (emailIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .selectFrom("actions")
    .select(["email_id", sql<string>`payload->>'summary'`.as("summary")])
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "save_summary")
    .where("email_id", "in", emailIds)
    .where(sql<string>`payload->>'summary'`, "is not", null)
    .execute();
  return new Map(rows.map((row) => [row.email_id, row.summary]));
}

const folderKeySchema = z.enum(folderKeys);

// Oldest first per email. A row with an unknown type is left out; an unknown folder gives `null`.
export async function listActionsForEmails(
  db: DbOrTrx,
  ctx: TenantContext,
  emailIds: readonly string[]
): Promise<Map<string, ActionView[]>> {
  const result = new Map<string, ActionView[]>();
  if (emailIds.length === 0) {
    return result;
  }
  const rows = await db
    .selectFrom("actions")
    .select([
      "id",
      "email_id",
      "type",
      "status",
      "reverses_action_id",
      "applied_at",
      sql<string | null>`payload->>'folder'`.as("folder"),
    ])
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "in", [...emailIds])
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  for (const row of rows) {
    const type = actionTypeSchema.safeParse(row.type);
    if (!type.success) {
      continue;
    }
    const folder = folderKeySchema.safeParse(row.folder);
    const view: ActionView = {
      id: row.id,
      type: type.data,
      status: row.status,
      folder: folder.success ? (folder.data as FolderKey) : null,
      reverse: row.reverses_action_id !== null,
      reversesActionId: row.reverses_action_id,
      appliedAt: row.applied_at,
    };
    result.set(row.email_id, [...(result.get(row.email_id) ?? []), view]);
  }
  return result;
}

// none = save_summary only; synthetic = save_summary and synthetic mail; all = everything.
export type ClaimFilter = { kind: "none" } | { kind: "synthetic" } | { kind: "all" };

export interface ClaimedAction {
  id: string;
  email_id: string;
  type: ActionType;
  payload: Record<string, string>;
  attempts: number;
  locked_at: Date;
  reverses_action_id: string | null;
  email: {
    id: string;
    mailbox_id: string;
    folder: string;
    uid: number;
    inbox_uid: number | null;
    message_id_header: string | null;
    content_hash: string;
    from_address: string | null;
    received_at: Date;
    subject: string | null;
  };
}

// D21: age of the action row and of the mail.
export const CLAIM_MAX_AGE_MS = 24 * 3_600_000;
export const CLAIM_MAX_MAIL_AGE_MS = 7 * 24 * 3_600_000;

// D6: save_summary first, the move last (a move can change the UID).
const TYPE_RANK: Record<ActionType, number> = { save_summary: 0, flag: 1, mark_read: 2, move: 3 };

type ClaimEb = ExpressionBuilder<DB, "actions" | "emails">;

interface ClaimWindow {
  now: Date;
  staleBefore: Date;
  filter: ClaimFilter;
}

function claimableWhere(eb: ClaimEb, ctx: TenantContext, mailboxId: string, opts: ClaimWindow): Expression<SqlBool> {
  const parts: Expression<SqlBool>[] = [
    eb("actions.org_id", "=", ctx.orgId),
    eb("emails.org_id", "=", ctx.orgId),
    eb("emails.mailbox_id", "=", mailboxId),
    eb("actions.status", "=", "ready"),
    eb.or([eb("actions.next_attempt_at", "is", null), eb("actions.next_attempt_at", "<=", opts.now)]),
    eb.or([eb("actions.locked_at", "is", null), eb("actions.locked_at", "<", opts.staleBefore)]),
    eb.or([
      eb("actions.type", "=", "save_summary"),
      eb("actions.reverses_action_id", "is not", null),
      eb.and([
        eb("actions.created_at", ">=", new Date(opts.now.getTime() - CLAIM_MAX_AGE_MS)),
        eb("emails.received_at", ">=", new Date(opts.now.getTime() - CLAIM_MAX_MAIL_AGE_MS)),
      ]),
    ]),
  ];
  if (opts.filter.kind === "none") parts.push(eb("actions.type", "=", "save_summary"));
  if (opts.filter.kind === "synthetic") {
    parts.push(eb.or([eb("actions.type", "=", "save_summary"), mailKindFilter("synthetic")]));
  }
  return eb.and(parts);
}

export async function countClaimable(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { now: Date; staleBefore: Date; filter: ClaimFilter }
): Promise<{ total: number; mailboxChanging: number }> {
  const row = await db
    .selectFrom("actions")
    .innerJoin("emails", (join) =>
      join.onRef("emails.id", "=", "actions.email_id").onRef("emails.org_id", "=", "actions.org_id")
    )
    .select([
      sql<string>`count(*)`.as("total"),
      sql<string>`count(*) FILTER (WHERE actions.type IN (${sql.join([...MAILBOX_ACTION_TYPES])}))`.as(
        "mailbox_changing"
      ),
    ])
    .where((eb) => claimableWhere(eb, ctx, mailboxId, opts))
    .executeTakeFirstOrThrow();
  return { total: Number(row.total), mailboxChanging: Number(row.mailbox_changing) };
}

// `locked_at` = `now` is the token for finishAction and releaseAction. The claim does not change `attempts` (D7).
export async function claimActions(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { now: Date; limit: number; staleBefore: Date; filter: ClaimFilter }
): Promise<ClaimedAction[]> {
  const rows = await db
    .with("picked", (qb) =>
      qb
        .selectFrom("actions")
        .innerJoin("emails", (join) =>
          join.onRef("emails.id", "=", "actions.email_id").onRef("emails.org_id", "=", "actions.org_id")
        )
        .select(["actions.id", "actions.email_id"])
        .where((eb) => claimableWhere(eb, ctx, mailboxId, opts))
        .orderBy("emails.received_at")
        .orderBy("emails.id")
        .orderBy(
          sql`CASE actions.type WHEN 'save_summary' THEN 0 WHEN 'flag' THEN 1 WHEN 'mark_read' THEN 2 WHEN 'move' THEN 3 END`
        )
        .limit(opts.limit)
        .forUpdate("actions")
        .skipLocked()
    )
    .updateTable("actions")
    .set({ locked_at: opts.now, updated_at: opts.now })
    .from("picked")
    .innerJoin("emails", "emails.id", "picked.email_id")
    .whereRef("actions.id", "=", "picked.id")
    .where("actions.org_id", "=", ctx.orgId)
    .where("emails.org_id", "=", ctx.orgId)
    .returning([
      "actions.id",
      "actions.email_id",
      "actions.type",
      "actions.payload",
      "actions.attempts",
      "actions.reverses_action_id",
      "emails.mailbox_id",
      "emails.folder",
      "emails.uid",
      "emails.inbox_uid",
      "emails.message_id_header",
      "emails.content_hash",
      "emails.from_address",
      "emails.received_at",
      "emails.subject",
    ])
    .execute();
  return rows
    .map(
      (row): ClaimedAction => ({
        id: row.id,
        email_id: row.email_id,
        type: actionTypeSchema.parse(row.type),
        payload: row.payload as Record<string, string>,
        attempts: row.attempts,
        locked_at: opts.now,
        reverses_action_id: row.reverses_action_id,
        email: {
          id: row.email_id,
          mailbox_id: row.mailbox_id,
          folder: row.folder,
          uid: Number(row.uid),
          inbox_uid: row.inbox_uid === null ? null : Number(row.inbox_uid),
          message_id_header: row.message_id_header,
          content_hash: row.content_hash,
          from_address: row.from_address,
          received_at: row.received_at,
          subject: row.subject,
        },
      })
    )
    .sort(
      (x, y) =>
        x.email.received_at.getTime() - y.email.received_at.getTime() ||
        (x.email_id < y.email_id ? -1 : x.email_id > y.email_id ? 1 : 0) ||
        TYPE_RANK[x.type] - TYPE_RANK[y.type]
    );
}

export type FinishNext =
  | { status: "applied"; at: Date; providerResult?: Record<string, string | number | null> }
  | { status: "failed"; at: Date; reason: string; lastError?: string; countAttempt?: true };

// `lockedAt` is the claim token: a stale run that lost its claim changes nothing.
// `next.at` is the run clock: it sets `updated_at` (and `applied_at`).
// `countAttempt` on a failure counts the try that failed (the third hard error leaves `attempts` = 3).
export async function finishAction(
  trx: DbOrTrx,
  ctx: TenantContext,
  id: string,
  lockedAt: Date,
  next: FinishNext
): Promise<boolean> {
  const common = { locked_at: null, next_attempt_at: null, updated_at: next.at };
  const values =
    next.status === "applied"
      ? {
          ...common,
          status: "applied",
          applied_at: next.at,
          provider_result: next.providerResult === undefined ? null : JSON.stringify(next.providerResult),
        }
      : { ...common, status: "failed", status_reason: next.reason };
  const result = await trx
    .updateTable("actions")
    .set((eb) => ({
      ...values,
      ...(next.status === "failed"
        ? {
            last_error: next.lastError ?? eb.ref("last_error"),
            ...(next.countAttempt ? { attempts: eb("attempts", "+", 1) } : {}),
          }
        : {}),
    }))
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where("status", "=", "ready")
    .where("locked_at", "=", lockedAt)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

export async function releaseAction(
  db: DbOrTrx,
  ctx: TenantContext,
  id: string,
  lockedAt: Date,
  opts: { nextAttemptAt: Date | null; countAttempt: boolean; now: Date; lastError?: string }
): Promise<boolean> {
  const result = await db
    .updateTable("actions")
    .set((eb) => ({
      locked_at: null,
      next_attempt_at: opts.nextAttemptAt,
      attempts: opts.countAttempt ? eb("attempts", "+", 1) : eb.ref("attempts"),
      last_error: opts.lastError ?? eb.ref("last_error"),
      updated_at: opts.now,
    }))
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where("status", "=", "ready")
    .where("locked_at", "=", lockedAt)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

// No attempt count, `next_attempt_at` unchanged: the rows of a batch that did not run.
export async function releaseActions(
  db: DbOrTrx,
  ctx: TenantContext,
  ids: readonly string[],
  lockedAt: Date,
  now: Date
): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db
    .updateTable("actions")
    .set({ locked_at: null, updated_at: now })
    .where("id", "in", [...ids])
    .where("org_id", "=", ctx.orgId)
    .where("status", "=", "ready")
    .where("locked_at", "=", lockedAt)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

// D21. The caller writes the `action.expired` audit rows.
export async function expireStaleReady(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { now: Date; staleBefore: Date }
): Promise<{ id: string; emailId: string; type: ActionType }[]> {
  const rows = await db
    .updateTable("actions")
    .set({ status: "expired", status_reason: "stale", updated_at: opts.now })
    .where("org_id", "=", ctx.orgId)
    .where("status", "=", "ready")
    .where("reverses_action_id", "is", null)
    .where("type", "in", [...MAILBOX_ACTION_TYPES])
    .where("created_at", "<", new Date(opts.now.getTime() - CLAIM_MAX_AGE_MS))
    .where((eb) => eb.or([eb("locked_at", "is", null), eb("locked_at", "<", opts.staleBefore)]))
    .where("email_id", "in", (eb) =>
      eb.selectFrom("emails").select("id").where("org_id", "=", ctx.orgId).where("mailbox_id", "=", mailboxId)
    )
    .returning(["id", "email_id", "type"])
    .execute();
  return rows.map((row) => ({ id: row.id, emailId: row.email_id, type: actionTypeSchema.parse(row.type) }));
}

// The conditional update guards a double tap: only an `applied` original becomes `undone`. The caller writes the audit row.
export async function markUndone(
  trx: DbOrTrx,
  ctx: TenantContext,
  originalId: string,
  opts: { at: Date; reason: "undo" | "user_moved_back" }
): Promise<boolean> {
  const result = await trx
    .updateTable("actions")
    .set({ status: "undone", status_reason: opts.reason, updated_at: opts.at })
    .where("id", "=", originalId)
    .where("org_id", "=", ctx.orgId)
    .where("status", "=", "applied")
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

export interface UndoCandidate {
  id: string;
  type: ActionType;
  payload: Record<string, string>;
  status: string;
  appliedAt: Date | null;
  reverse: { id: string; status: string } | null;
}

// Locks the original rows of the mail (the same lock as lockLatestOriginalMove): Undo and the returned job run in turn.
export async function lockActionsForUndo(trx: DbOrTrx, ctx: TenantContext, emailId: string): Promise<UndoCandidate[]> {
  const originals = await trx
    .selectFrom("actions")
    .select(["id", "type", "payload", "status", "applied_at"])
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "=", emailId)
    .where("reverses_action_id", "is", null)
    .where("type", "in", [...MAILBOX_ACTION_TYPES])
    .orderBy("created_at")
    .orderBy("id")
    .forUpdate()
    .execute();
  if (originals.length === 0) {
    return [];
  }
  const reverses = await trx
    .selectFrom("actions")
    .select(["id", "status", "reverses_action_id"])
    .where("org_id", "=", ctx.orgId)
    .where(
      "reverses_action_id",
      "in",
      originals.map((row) => row.id)
    )
    .execute();
  const reverseOf = new Map(reverses.map((row) => [row.reverses_action_id, { id: row.id, status: row.status }]));
  return originals.map((row) => ({
    id: row.id,
    type: actionTypeSchema.parse(row.type),
    payload: row.payload as Record<string, string>,
    status: row.status,
    appliedAt: row.applied_at,
    reverse: reverseOf.get(row.id) ?? null,
  }));
}

// The reverse row repeats the payload of the original, so readers know the folder. Null when a reverse exists.
export async function insertReverse(
  trx: DbOrTrx,
  ctx: TenantContext,
  original: { id: string; emailId: string; type: ActionType; payload: Record<string, string> }
): Promise<string | null> {
  const row = await trx
    .insertInto("actions")
    .values({
      org_id: ctx.orgId,
      email_id: original.emailId,
      type: original.type,
      payload: JSON.stringify(original.payload),
      status: "ready",
      idempotency_key: `${original.id}:undo`,
      reverses_action_id: original.id,
    })
    .onConflict((oc) => oc.columns(["org_id", "idempotency_key"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  return row?.id ?? null;
}

// Newest original `move`, locked FOR UPDATE (M8); the reverse row comes from a second query.
export async function lockLatestOriginalMove(
  trx: DbOrTrx,
  ctx: TenantContext,
  emailId: string
): Promise<{ id: string; status: string; reverseStatus: string | null } | undefined> {
  const move = await trx
    .selectFrom("actions")
    .select(["id", "status"])
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "=", emailId)
    .where("type", "=", "move")
    .where("reverses_action_id", "is", null)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .forUpdate()
    .executeTakeFirst();
  if (!move) {
    return undefined;
  }
  const reverse = await trx
    .selectFrom("actions")
    .select("status")
    .where("org_id", "=", ctx.orgId)
    .where("reverses_action_id", "=", move.id)
    .executeTakeFirst();
  return { id: move.id, status: move.status, reverseStatus: reverse?.status ?? null };
}

export interface FailedAction {
  id: string;
  email_id: string;
  type: ActionType;
  reverse: boolean;
  status_reason: string | null;
  payload: Record<string, string>;
  attempts: number;
  updated_at: Date;
  subject: string | null;
  mailbox_id: string;
  from_address: string | null;
  message_id_header: string | null;
}

// No time filter (M11): the notice job marks every row it lists. An original `mail_not_found` row stays quiet;
// a reverse one is listed, because the user tapped Undo and must learn that nothing moved.
export async function listFailedUnnotified(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { limit: number }
): Promise<FailedAction[]> {
  const rows = await db
    .selectFrom("actions")
    .innerJoin("emails", (join) =>
      join.onRef("emails.id", "=", "actions.email_id").onRef("emails.org_id", "=", "actions.org_id")
    )
    .select([
      "actions.id",
      "actions.email_id",
      "actions.type",
      "actions.reverses_action_id",
      "actions.status_reason",
      "actions.payload",
      "actions.attempts",
      "actions.updated_at",
      "emails.subject",
      "emails.mailbox_id",
      "emails.from_address",
      "emails.message_id_header",
    ])
    .where("actions.org_id", "=", ctx.orgId)
    .where("emails.org_id", "=", ctx.orgId)
    .where("actions.status", "=", "failed")
    .where("actions.notified_at", "is", null)
    .where((eb) =>
      eb.or([
        eb("actions.status_reason", "is distinct from", "mail_not_found"),
        eb("actions.reverses_action_id", "is not", null),
      ])
    )
    .orderBy("actions.updated_at")
    .orderBy("actions.id")
    .limit(opts.limit)
    .execute();
  return rows.map((row) => ({
    id: row.id,
    email_id: row.email_id,
    type: actionTypeSchema.parse(row.type),
    reverse: row.reverses_action_id !== null,
    status_reason: row.status_reason,
    payload: row.payload as Record<string, string>,
    attempts: row.attempts,
    updated_at: row.updated_at,
    subject: row.subject,
    mailbox_id: row.mailbox_id,
    from_address: row.from_address,
    message_id_header: row.message_id_header,
  }));
}

export async function markNotified(db: DbOrTrx, ctx: TenantContext, id: string, at: Date): Promise<boolean> {
  const result = await db
    .updateTable("actions")
    .set({ notified_at: at })
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where("notified_at", "is", null)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

// For /status: originals of mailbox types only. `applied` counts by `applied_at`, `failed` and `undone` by `updated_at`.
export async function countActionsSince(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { since: Date }
): Promise<{ applied: number; failed: number; undone: number }> {
  const rows = await db
    .selectFrom("actions")
    .select(["status", sql<string>`count(*)`.as("count")])
    .where("org_id", "=", ctx.orgId)
    .where("reverses_action_id", "is", null)
    .where("type", "in", [...MAILBOX_ACTION_TYPES])
    .where((eb) =>
      eb.or([
        eb.and([eb("status", "=", "applied"), eb("applied_at", ">=", opts.since)]),
        eb.and([eb("status", "in", ["failed", "undone"]), eb("updated_at", ">=", opts.since)]),
      ])
    )
    .groupBy("status")
    .execute();
  const count = (status: string) => Number(rows.find((row) => row.status === status)?.count ?? 0);
  return { applied: count("applied"), failed: count("failed"), undone: count("undone") };
}

export interface ExpireFilter {
  mailboxId: string;
  emailId?: string;
  types: readonly MailboxActionType[];
  // The category of the newest triage_results row of the mail.
  category?: { is: string } | { not: string };
}

// A row that a committer run holds now (`locked_at` >= `staleBefore`) stays: it ends as `applied` and keeps its Undo.
// The caller writes the `action.expired` audit rows.
export async function expireReadyOriginals(
  trx: DbOrTrx,
  ctx: TenantContext,
  filter: ExpireFilter,
  opts: { now: Date; staleBefore: Date; reason: "policy_changed" | "undo" | "manual" }
): Promise<{ id: string; emailId: string; type: ActionType }[]> {
  if (filter.types.length === 0) {
    return [];
  }
  const latestCategory = sql<string>`(
    SELECT t.category FROM triage_results t
    WHERE t.org_id = actions.org_id AND t.email_id = actions.email_id
    ORDER BY t.created_at DESC, t.id DESC LIMIT 1
  )`;
  const { category, emailId } = filter;
  const rows = await trx
    .updateTable("actions")
    .set({ status: "expired", status_reason: opts.reason, updated_at: opts.now })
    .where("org_id", "=", ctx.orgId)
    .where("status", "=", "ready")
    .where("reverses_action_id", "is", null)
    .where("type", "in", [...filter.types])
    .where((eb) => eb.or([eb("locked_at", "is", null), eb("locked_at", "<", opts.staleBefore)]))
    .where("email_id", "in", (eb) =>
      eb.selectFrom("emails").select("id").where("org_id", "=", ctx.orgId).where("mailbox_id", "=", filter.mailboxId)
    )
    .$if(emailId !== undefined, (qb) => qb.where("email_id", "=", emailId as string))
    .$if(category !== undefined && "is" in category, (qb) =>
      qb.where(latestCategory, "=", (category as { is: string }).is)
    )
    .$if(category !== undefined && "not" in category, (qb) =>
      qb.where(latestCategory, "<>", (category as { not: string }).not)
    )
    .returning(["id", "email_id", "type"])
    .execute();
  return rows.map((row) => ({ id: row.id, emailId: row.email_id, type: actionTypeSchema.parse(row.type) }));
}
