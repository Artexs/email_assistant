import {
  actionTypes,
  moveTargets,
  MAILBOX_ACTION_TYPES,
  type ActionType,
  type ActionView,
  type MailboxActionType,
} from "@ea/core";
import { sql, type Expression, type ExpressionBuilder, type SqlBool, type Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { mailKindFilter } from "../mail";

import { APPROVAL_TTL_MS, UNNOTIFIED_TTL_MS } from "./constants";

type DbOrTrx = Db | Transaction<DB>;

const actionTypeSchema = z.enum(actionTypes);

// The `X-EA-Action-Id` of a mail is the id of a draft of this mailbox: the mail is the system's own (D15).
// Any sender can write the header, so a value that is not a uuid never reaches the query.
export async function isOwnActionId(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  actionId: string
): Promise<boolean> {
  if (!z.uuid().safeParse(actionId).success) return false;
  const row = await db
    .selectFrom("actions as a")
    .innerJoin("emails as e", (join) => join.onRef("e.id", "=", "a.email_id").onRef("e.org_id", "=", "a.org_id"))
    .select("a.id")
    .where("a.org_id", "=", ctx.orgId)
    .where("a.id", "=", actionId)
    .where("a.type", "in", ["create_draft", "send"])
    .where("e.mailbox_id", "=", mailboxId)
    .executeTakeFirst();
  return row !== undefined;
}

export interface PlannedActionInput {
  type: ActionType;
  payload: Record<string, unknown>;
  status: "ready" | "awaiting_approval" | "logged";
  idempotencyKey: string;
  // The create_draft item of the same call.
  dependsOn?: "create_draft";
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

// The draft key of a send key: the `:send` segment right after the email id becomes `:create_draft`
// (`<email>:send` -> `<email>:create_draft`, `<email>:send:reminder:<day>` -> `<email>:create_draft:reminder:<day>`).
function draftKeyOf(emailId: string, sendKey: string): string {
  const prefix = `${emailId}:send`;
  if (sendKey !== prefix && !sendKey.startsWith(`${prefix}:`)) {
    throw new HardError("send needs its draft");
  }
  return `${emailId}:create_draft${sendKey.slice(prefix.length)}`;
}

// The status change of the email and these rows go in one transaction: the caller passes `trx`.
// One insert per item in the given order: a send needs the id of its draft (`dependsOn`: the draft of the call, else
// the draft of this org whose key is the send key with `:send` -> `:create_draft`; none throws). A key that exists in
// this org inserts nothing; the result holds only the inserted rows.
export async function createPlanned(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string,
  items: PlannedActionInput[]
): Promise<CreatedAction[]> {
  const created: CreatedAction[] = [];
  let draftId: string | undefined;
  for (const item of items) {
    let dependsOnId: string | null = null;
    if (item.dependsOn === "create_draft") {
      // A call with the send alone (its draft exists from an earlier call) finds the draft by its key.
      const existing =
        draftId ??
        (
          await db
            .selectFrom("actions")
            .select("id")
            .where("org_id", "=", ctx.orgId)
            .where("idempotency_key", "=", draftKeyOf(emailId, item.idempotencyKey))
            .where("type", "=", "create_draft")
            .executeTakeFirst()
        )?.id;
      if (existing === undefined) {
        throw new HardError("send needs its draft");
      }
      dependsOnId = existing;
    }
    const row = await db
      .insertInto("actions")
      .values({
        org_id: ctx.orgId,
        email_id: emailId,
        type: item.type,
        payload: JSON.stringify(item.payload),
        status: item.status,
        idempotency_key: item.idempotencyKey,
        depends_on_action_id: dependsOnId,
      })
      .onConflict((oc) => oc.columns(["org_id", "idempotency_key"]).doNothing())
      .returning(["id", "type", "status"])
      .executeTakeFirst();
    if (row !== undefined) {
      created.push({ id: row.id, type: actionTypeSchema.parse(row.type), status: row.status });
    }
    if (item.type === "create_draft") {
      draftId =
        row?.id ??
        (
          await db
            .selectFrom("actions")
            .select("id")
            .where("org_id", "=", ctx.orgId)
            .where("idempotency_key", "=", item.idempotencyKey)
            .executeTakeFirstOrThrow()
        ).id;
    }
  }
  return created;
}

// Writes only the `delegation_id` key of the payload (D2), on `create_draft` and `send` rows of the context org.
// Returns the row count.
export async function setDelegationId(
  db: DbOrTrx,
  ctx: TenantContext,
  actionIds: readonly string[],
  delegationId: string
): Promise<number> {
  if (actionIds.length === 0) {
    return 0;
  }
  const result = await db
    .updateTable("actions")
    .set({ payload: sql`payload || ${JSON.stringify({ delegation_id: delegationId })}::jsonb` })
    .where("org_id", "=", ctx.orgId)
    .where("type", "in", ["create_draft", "send"])
    .where("id", "in", [...actionIds])
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
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

const moveTargetSchema = z.enum(moveTargets);
const sendKindSchema = z.enum(["delegation", "clarification", "reminder"]);

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
      sql<string | null>`payload->>'kind'`.as("kind"),
      sql<string | null>`payload->>'delegate_id'`.as("delegate_id"),
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
    const folder = moveTargetSchema.safeParse(row.folder);
    const kind = sendKindSchema.safeParse(row.kind);
    const view: ActionView = {
      id: row.id,
      type: type.data,
      status: row.status,
      folder: folder.success ? folder.data : null,
      reverse: row.reverses_action_id !== null,
      reversesActionId: row.reverses_action_id,
      appliedAt: row.applied_at,
      kind: kind.success ? kind.data : null,
      delegateId: row.delegate_id,
    };
    result.set(row.email_id, [...(result.get(row.email_id) ?? []), view]);
  }
  return result;
}

// The task of the original `create_draft` row per mail (a delegation or reminder draft); reverse rows are left out.
export async function listDraftTasks(
  db: DbOrTrx,
  ctx: TenantContext,
  emailIds: readonly string[]
): Promise<Map<string, string>> {
  if (emailIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .selectFrom("actions")
    .select(["email_id", sql<string | null>`payload->>'task'`.as("task")])
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "in", [...emailIds])
    .where("type", "=", "create_draft")
    .where("reverses_action_id", "is", null)
    .where(sql<boolean>`payload->>'task' is not null`)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  const tasks = new Map<string, string>();
  for (const row of rows) {
    if (row.task !== null && !tasks.has(row.email_id)) {
      tasks.set(row.email_id, row.task);
    }
  }
  return tasks;
}

// `mailbox` gates the mailbox changes and the drafts: none = save_summary only; synthetic = save_summary and synthetic mail;
// all = everything. `send` gates the sends (D16): none = no send; self = only to the listed (lower-case) addresses; all = every send.
export type MailboxClaimFilter = { kind: "none" } | { kind: "synthetic" } | { kind: "all" };
export type SendClaimFilter = { kind: "none" } | { kind: "self"; addresses: string[] } | { kind: "all" };
export interface ClaimFilter {
  mailbox: MailboxClaimFilter;
  send: SendClaimFilter;
}

export interface ClaimedAction {
  id: string;
  email_id: string;
  type: ActionType;
  status: "ready" | "approved" | "applying";
  payload: Record<string, unknown>;
  attempts: number;
  locked_at: Date;
  created_at: Date;
  reverses_action_id: string | null;
  // The `created_at` of the reversed row (reverse rows only): the locate window of a reverse draft.
  original_created_at: Date | null;
  depends_on_action_id: string | null;
  outgoing_message_id: string | null;
  approved_at: Date | null;
  provider_result: Record<string, unknown> | null;
  email: {
    id: string;
    mailbox_id: string;
    folder: string;
    uid: number;
    inbox_uid: number | null;
    /** emails.source_folder (D6). `inbox_uid` keeps its name: the last known UID in this folder (D3). */
    source_folder: string;
    message_id_header: string | null;
    content_hash: string;
    from_address: string | null;
    to_addresses: string[];
    subject: string | null;
    received_at: Date;
    body_text: string | null;
    in_reply_to: string | null;
    references_header: string | null;
    thread_key: string;
  };
}

// D21: age of the action row and of the mail.
export const CLAIM_MAX_AGE_MS = 24 * 3_600_000;
export const CLAIM_MAX_MAIL_AGE_MS = 7 * 24 * 3_600_000;

// D6: save_summary first, the move last (a move can change the UID); a draft before its send.
const TYPE_RANK: Record<ActionType, number> = {
  save_summary: 0,
  flag: 1,
  mark_read: 2,
  move: 3,
  create_draft: 4,
  send: 5,
};

type ClaimEb = ExpressionBuilder<DB, "actions" | "emails">;

interface ClaimWindow {
  now: Date;
  staleBefore: Date;
  filter: ClaimFilter;
}

const sqlTrue = sql<SqlBool>`true`;
const sqlFalse = sql<SqlBool>`false`;

function mailboxFilterExpr(filter: MailboxClaimFilter): Expression<SqlBool> {
  if (filter.kind === "none") return sqlFalse;
  if (filter.kind === "synthetic") return mailKindFilter("synthetic");
  return sqlTrue;
}

// `payload.to` is a JSON array (D2). The CASE keeps a malformed payload from raising: it is simply not admitted.
function sendFilterExpr(filter: SendClaimFilter): Expression<SqlBool> {
  if (filter.kind === "none") return sqlFalse;
  if (filter.kind === "all") return sqlTrue;
  const addresses = filter.addresses.map((address) => address.toLowerCase());
  return sql<SqlBool>`(CASE WHEN jsonb_typeof(actions.payload->'to') = 'array' THEN
      jsonb_array_length(actions.payload->'to') > 0 AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(actions.payload->'to') r WHERE lower(r) <> ALL(${addresses}::text[])
      )
    ELSE false END)`;
}

// The draft of the send (`depends_on_action_id`) is `applied` (same org).
const draftApplied = sql<SqlBool>`EXISTS (
  SELECT 1 FROM actions d
  WHERE d.id = actions.depends_on_action_id AND d.org_id = actions.org_id AND d.status = 'applied'
)`;

// A send of the draft waits for approval (same org).
const sendWaits = sql<SqlBool>`EXISTS (
  SELECT 1 FROM actions s
  WHERE s.depends_on_action_id = actions.id AND s.org_id = actions.org_id AND s.status = 'awaiting_approval'
)`;

// D17. The lock and retry rules apply to every branch; the branches are the S3 mailbox actions, the drafts and the sends.
function claimableWhere(eb: ClaimEb, ctx: TenantContext, mailboxId: string, opts: ClaimWindow): Expression<SqlBool> {
  const { mailbox, send } = opts.filter;
  const mailboxChanges = eb.and([
    eb("actions.status", "=", "ready"),
    eb("actions.type", "in", [...MAILBOX_ACTION_TYPES, "save_summary"]),
    eb.or([
      eb("actions.type", "=", "save_summary"),
      eb("actions.reverses_action_id", "is not", null),
      eb.and([
        eb("actions.created_at", ">=", new Date(opts.now.getTime() - CLAIM_MAX_AGE_MS)),
        eb("emails.received_at", ">=", new Date(opts.now.getTime() - CLAIM_MAX_MAIL_AGE_MS)),
      ]),
    ]),
    mailbox.kind === "none"
      ? eb("actions.type", "=", "save_summary")
      : mailbox.kind === "synthetic"
        ? eb.or([eb("actions.type", "=", "save_summary"), mailKindFilter("synthetic")])
        : sqlTrue,
  ]);
  // A draft is made only while its send waits; an `applying` one is the recovery (D12) and stays behind the mailbox filter.
  const drafts = eb.and([
    eb("actions.type", "=", "create_draft"),
    mailboxFilterExpr(mailbox),
    eb.or([
      eb.and([eb("actions.status", "=", "ready"), eb("actions.reverses_action_id", "is not", null)]),
      eb.and([eb("actions.status", "=", "ready"), eb("actions.reverses_action_id", "is", null), sendWaits]),
      eb.and([eb("actions.status", "=", "applying"), eb("actions.reverses_action_id", "is", null)]),
    ]),
  ]);
  // The `applying` recovery sends nothing: the send filter does not apply (D16).
  const sends = eb.and([
    eb("actions.type", "=", "send"),
    draftApplied,
    eb.or([
      eb.and([
        eb("actions.status", "=", "approved"),
        eb("actions.approved_at", ">=", new Date(opts.now.getTime() - APPROVAL_TTL_MS)),
        sendFilterExpr(send),
      ]),
      eb("actions.status", "=", "applying"),
    ]),
  ]);
  return eb.and([
    eb("actions.org_id", "=", ctx.orgId),
    eb("emails.org_id", "=", ctx.orgId),
    eb("emails.mailbox_id", "=", mailboxId),
    eb.or([eb("actions.next_attempt_at", "is", null), eb("actions.next_attempt_at", "<=", opts.now)]),
    eb.or([eb("actions.locked_at", "is", null), eb("actions.locked_at", "<", opts.staleBefore)]),
    eb.or([mailboxChanges, drafts, sends]),
  ]);
}

export async function countClaimable(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { now: Date; staleBefore: Date; filter: ClaimFilter }
): Promise<{ total: number; mailboxChanging: number; sending: number }> {
  const row = await db
    .selectFrom("actions")
    .innerJoin("emails", (join) =>
      join.onRef("emails.id", "=", "actions.email_id").onRef("emails.org_id", "=", "actions.org_id")
    )
    .select([
      sql<string>`count(*)`.as("total"),
      sql<string>`count(*) FILTER (WHERE actions.type IN (${sql.join([...MAILBOX_ACTION_TYPES, "create_draft"])}))`.as(
        "mailbox_changing"
      ),
      sql<string>`count(*) FILTER (WHERE actions.type = 'send')`.as("sending"),
    ])
    .where((eb) => claimableWhere(eb, ctx, mailboxId, opts))
    .executeTakeFirstOrThrow();
  return { total: Number(row.total), mailboxChanging: Number(row.mailbox_changing), sending: Number(row.sending) };
}

// D16: `approved` sends of the mailbox with an applied draft that the send filter does not admit (no lock rule).
export async function countHeldSends(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { send: SendClaimFilter }
): Promise<number> {
  const row = await db
    .selectFrom("actions")
    .innerJoin("emails", (join) =>
      join.onRef("emails.id", "=", "actions.email_id").onRef("emails.org_id", "=", "actions.org_id")
    )
    .select(sql<string>`count(*)`.as("count"))
    .where("actions.org_id", "=", ctx.orgId)
    .where("emails.org_id", "=", ctx.orgId)
    .where("emails.mailbox_id", "=", mailboxId)
    .where("actions.type", "=", "send")
    .where("actions.status", "=", "approved")
    .where(draftApplied)
    .where((eb) => eb.not(sendFilterExpr(opts.send)))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

// `locked_at` = `now` is the token for markApplying, finishAction and releaseAction (also on an `approved` row).
// The claim does not change `attempts` or the status (D7).
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
          sql`CASE actions.type WHEN 'save_summary' THEN 0 WHEN 'flag' THEN 1 WHEN 'mark_read' THEN 2 WHEN 'move' THEN 3 WHEN 'create_draft' THEN 4 WHEN 'send' THEN 5 END`
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
      "actions.status",
      "actions.payload",
      "actions.attempts",
      "actions.created_at",
      "actions.reverses_action_id",
      "actions.depends_on_action_id",
      "actions.outgoing_message_id",
      "actions.approved_at",
      "actions.provider_result",
      sql<Date | null>`(SELECT o.created_at FROM actions o WHERE o.id = actions.reverses_action_id AND o.org_id = actions.org_id)`.as(
        "original_created_at"
      ),
      "emails.mailbox_id",
      "emails.folder",
      "emails.uid",
      "emails.inbox_uid",
      "emails.source_folder",
      "emails.message_id_header",
      "emails.content_hash",
      "emails.from_address",
      "emails.to_addresses",
      "emails.received_at",
      "emails.subject",
      "emails.body_text",
      "emails.in_reply_to",
      "emails.references_header",
      "emails.thread_key",
    ])
    .execute();
  return rows
    .map(
      (row): ClaimedAction => ({
        id: row.id,
        email_id: row.email_id,
        type: actionTypeSchema.parse(row.type),
        status: row.status as ClaimedAction["status"],
        payload: row.payload as Record<string, unknown>,
        attempts: row.attempts,
        locked_at: opts.now,
        created_at: row.created_at,
        reverses_action_id: row.reverses_action_id,
        original_created_at: row.original_created_at,
        depends_on_action_id: row.depends_on_action_id,
        outgoing_message_id: row.outgoing_message_id,
        approved_at: row.approved_at,
        provider_result: row.provider_result as Record<string, unknown> | null,
        email: {
          id: row.email_id,
          mailbox_id: row.mailbox_id,
          folder: row.folder,
          uid: Number(row.uid),
          inbox_uid: row.inbox_uid === null ? null : Number(row.inbox_uid),
          source_folder: row.source_folder,
          message_id_header: row.message_id_header,
          content_hash: row.content_hash,
          from_address: row.from_address,
          to_addresses: row.to_addresses,
          subject: row.subject,
          received_at: row.received_at,
          body_text: row.body_text,
          in_reply_to: row.in_reply_to,
          references_header: row.references_header,
          thread_key: row.thread_key,
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

// The first step of the apply step for a draft or a send: it commits before any APPEND or SMTP call (D17).
// `locked_at` stays: the claim token is valid through the step.
// A send starts only from `approved` with `approved_at` set; a draft from `ready` or `approved`.
export async function markApplying(
  db: DbOrTrx,
  ctx: TenantContext,
  id: string,
  lockedAt: Date,
  opts?: { outgoingMessageId?: string }
): Promise<boolean> {
  const result = await db
    .updateTable("actions")
    .set((eb) => ({
      status: "applying",
      outgoing_message_id: opts?.outgoingMessageId ?? eb.ref("outgoing_message_id"),
      updated_at: sql<Date>`now()`,
    }))
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where((eb) =>
      eb.or([
        eb.and([eb("type", "=", "send"), eb("status", "=", "approved"), eb("approved_at", "is not", null)]),
        eb.and([eb("type", "<>", "send"), eb("status", "in", ["ready", "approved"])]),
      ])
    )
    .where("locked_at", "=", lockedAt)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

type ProviderResult = Record<string, string | number | boolean | null>;

export type FinishNext =
  | { status: "applied"; at: Date; providerResult?: ProviderResult }
  | {
      status: "failed";
      at: Date;
      reason: string;
      lastError?: string;
      countAttempt?: true;
      // S4: a send failure stores { stage, response_code, code } for the result notice (D20).
      providerResult?: ProviderResult;
    }
  // S4: an `applying` draft whose send ended before the APPEND (N12).
  | { status: "expired"; at: Date; reason: "send_closed" };

// `lockedAt` is the claim token: a stale run that lost its claim changes nothing.
// `next.at` is the run clock: it sets `updated_at` (and `applied_at`). `from` lists the statuses that may finish.
// `countAttempt` on a failure counts the try that failed (the third hard error leaves `attempts` = 3).
export async function finishAction(
  trx: DbOrTrx,
  ctx: TenantContext,
  id: string,
  lockedAt: Date,
  next: FinishNext,
  opts?: { from?: readonly ("ready" | "approved" | "applying")[] }
): Promise<boolean> {
  const common = { locked_at: null, next_attempt_at: null, updated_at: next.at };
  let values: Record<string, unknown>;
  if (next.status === "applied") {
    values = {
      ...common,
      status: "applied",
      applied_at: next.at,
      last_error: null,
      provider_result: next.providerResult === undefined ? null : JSON.stringify(next.providerResult),
    };
  } else if (next.status === "failed") {
    values = {
      ...common,
      status: "failed",
      status_reason: next.reason,
      ...(next.providerResult === undefined ? {} : { provider_result: JSON.stringify(next.providerResult) }),
    };
  } else {
    values = { ...common, status: "expired", status_reason: next.reason };
  }
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
    .where("status", "in", [...(opts?.from ?? ["ready", "applying"])])
    .where("locked_at", "=", lockedAt)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

// Puts the row back in `toStatus` with the lock cleared: an `applying` send whose SMTP call never started goes back to
// `approved`; a draft that could not start goes back to `ready`.
export async function releaseAction(
  db: DbOrTrx,
  ctx: TenantContext,
  id: string,
  lockedAt: Date,
  opts: {
    toStatus: "ready" | "approved" | "applying";
    nextAttemptAt: Date | null;
    countAttempt: boolean;
    now: Date;
    lastError?: string;
  }
): Promise<boolean> {
  const result = await db
    .updateTable("actions")
    .set((eb) => ({
      status: opts.toStatus,
      locked_at: null,
      next_attempt_at: opts.nextAttemptAt,
      attempts: opts.countAttempt ? eb("attempts", "+", 1) : eb.ref("attempts"),
      last_error: opts.lastError ?? eb.ref("last_error"),
      updated_at: opts.now,
    }))
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where("status", "in", ["ready", "approved", "applying"])
    .where("locked_at", "=", lockedAt)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

// No attempt count, `next_attempt_at` and status unchanged: the rows of a batch that did not run stay in their pre-claim
// status (`markApplying` is the first thing the apply step does for a row).
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
    .where("status", "in", ["ready", "approved", "applying"])
    .where("locked_at", "=", lockedAt)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

// jsonb merge (`provider_result || patch`), e.g. the Sent copy outcome after `applied`.
export async function updateProviderResult(
  db: DbOrTrx,
  ctx: TenantContext,
  id: string,
  patch: Record<string, unknown>
): Promise<boolean> {
  const result = await db
    .updateTable("actions")
    .set({ provider_result: sql`coalesce(provider_result, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb` })
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
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
  opts: { at: Date; reason: "undo" | "user_moved_back" | "sent" | "rejected" | "expired" }
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
  original: { id: string; emailId: string; type: ActionType; payload: Record<string, string | number | null> }
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
  payload: Record<string, unknown>;
  attempts: number;
  updated_at: Date;
  subject: string | null;
  mailbox_id: string;
  from_address: string | null;
  message_id_header: string | null;
  folder: string;
  source_folder: string;
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
      "emails.folder",
      "emails.source_folder",
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
    // One notice per failure (D20): a send and an original draft end in a `send_result` notice.
    .where("actions.type", "<>", "send")
    .where((eb) => eb.or([eb("actions.type", "<>", "create_draft"), eb("actions.reverses_action_id", "is not", null)]))
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
    payload: row.payload as Record<string, unknown>,
    attempts: row.attempts,
    updated_at: row.updated_at,
    subject: row.subject,
    mailbox_id: row.mailbox_id,
    from_address: row.from_address,
    message_id_header: row.message_id_header,
    folder: row.folder,
    source_folder: row.source_folder,
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

// `ready` originals of the mailbox-changing types. Above 0 after an expire only while a committer run holds a row.
export async function countReadyOriginals(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<number> {
  const row = await db
    .selectFrom("actions")
    .select(sql<string>`count(*)`.as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("status", "=", "ready")
    .where("reverses_action_id", "is", null)
    .where("type", "in", [...MAILBOX_ACTION_TYPES])
    .where("email_id", "in", (eb) =>
      eb.selectFrom("emails").select("id").where("org_id", "=", ctx.orgId).where("mailbox_id", "=", mailboxId)
    )
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

export interface ExpireFilter {
  mailboxId: string;
  emailId?: string;
  types: readonly MailboxActionType[];
  // The category of the newest triage_results row of the mail.
  category?: { is: string } | { not: string };
  // Also close the `awaiting_approval` sends of the mailbox (and their drafts): `expireReady` does it (S4 D13, D33).
  sends?: true;
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

export interface SendRow {
  id: string;
  email_id: string;
  status: string;
  status_reason: string | null;
  payload: Record<string, unknown>;
  depends_on_action_id: string | null;
  notified_at: Date | null;
  approved_by: string | null;
  approved_at: Date | null;
  approved_via: string | null;
  outgoing_message_id: string | null;
  provider_result: Record<string, unknown> | null;
  applied_at: Date | null;
  created_at: Date;
  updated_at: Date;
  attempts: number;
  last_error: string | null;
  locked_at: Date | null;
  email: {
    mailbox_id: string;
    subject: string | null;
    from_address: string | null;
    message_id_header: string | null;
    received_at: Date;
    references_header: string | null;
    in_reply_to: string | null;
    body_text: string | null;
  };
}

function sendBase(db: DbOrTrx, ctx: TenantContext) {
  return db
    .selectFrom("actions")
    .innerJoin("emails", (join) =>
      join.onRef("emails.id", "=", "actions.email_id").onRef("emails.org_id", "=", "actions.org_id")
    )
    .select([
      "actions.id",
      "actions.email_id",
      "actions.status",
      "actions.status_reason",
      "actions.payload",
      "actions.depends_on_action_id",
      "actions.notified_at",
      "actions.approved_by",
      "actions.approved_at",
      "actions.approved_via",
      "actions.outgoing_message_id",
      "actions.provider_result",
      "actions.applied_at",
      "actions.created_at",
      "actions.updated_at",
      "actions.attempts",
      "actions.last_error",
      "actions.locked_at",
      "emails.mailbox_id",
      "emails.subject",
      "emails.from_address",
      "emails.message_id_header",
      "emails.received_at",
      "emails.references_header",
      "emails.in_reply_to",
      "emails.body_text",
    ])
    .where("actions.org_id", "=", ctx.orgId)
    .where("emails.org_id", "=", ctx.orgId)
    .where("actions.type", "=", "send");
}

function sendQuery(db: DbOrTrx, ctx: TenantContext, id: string) {
  return sendBase(db, ctx).where("actions.id", "=", id);
}

type SendQueryRow = NonNullable<Awaited<ReturnType<ReturnType<typeof sendQuery>["executeTakeFirst"]>>>;

function toSendRow(row: SendQueryRow): SendRow {
  const {
    mailbox_id,
    subject,
    from_address,
    message_id_header,
    received_at,
    references_header,
    in_reply_to,
    body_text,
  } = row;
  return {
    id: row.id,
    email_id: row.email_id,
    status: row.status,
    status_reason: row.status_reason,
    payload: row.payload as Record<string, unknown>,
    depends_on_action_id: row.depends_on_action_id,
    notified_at: row.notified_at,
    approved_by: row.approved_by,
    approved_at: row.approved_at,
    approved_via: row.approved_via,
    outgoing_message_id: row.outgoing_message_id,
    provider_result: row.provider_result as Record<string, unknown> | null,
    applied_at: row.applied_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    attempts: row.attempts,
    last_error: row.last_error,
    locked_at: row.locked_at,
    email: {
      mailbox_id,
      subject,
      from_address,
      message_id_header,
      received_at,
      references_header,
      in_reply_to,
      body_text,
    },
  };
}

// FOR UPDATE of the action row only (the mail row stays unlocked: the lock order of S3, D6).
export async function lockSend(trx: Transaction<DB>, ctx: TenantContext, id: string): Promise<SendRow | undefined> {
  const row = await sendQuery(trx, ctx, id).forUpdate("actions").executeTakeFirst();
  return row && toSendRow(row);
}

export async function getSend(db: DbOrTrx, ctx: TenantContext, id: string): Promise<SendRow | undefined> {
  const row = await sendQuery(db, ctx, id).executeTakeFirst();
  return row && toSendRow(row);
}

export interface DraftRow {
  id: string;
  email_id: string;
  status: string;
  payload: Record<string, unknown>;
  provider_result: Record<string, unknown> | null;
  created_at: Date;
  locked_at: Date | null;
}

function draftQuery(db: DbOrTrx, ctx: TenantContext, id: string) {
  return db
    .selectFrom("actions")
    .select(["id", "email_id", "status", "payload", "provider_result", "created_at", "locked_at"])
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "create_draft")
    .where("reverses_action_id", "is", null)
    .where("id", "=", id);
}

function toDraftRow(row: Awaited<ReturnType<ReturnType<typeof draftQuery>["executeTakeFirstOrThrow"]>>): DraftRow {
  return {
    ...row,
    payload: row.payload as Record<string, unknown>,
    provider_result: row.provider_result as Record<string, unknown> | null,
  };
}

export async function lockDraft(trx: Transaction<DB>, ctx: TenantContext, id: string): Promise<DraftRow | undefined> {
  const row = await draftQuery(trx, ctx, id).forUpdate().executeTakeFirst();
  return row && toDraftRow(row);
}

export async function getDraft(db: DbOrTrx, ctx: TenantContext, id: string): Promise<DraftRow | undefined> {
  const row = await draftQuery(db, ctx, id).executeTakeFirst();
  return row && toDraftRow(row);
}

// D20: a reverse row of the draft exists = the draft was removed (or its removal is queued).
export async function draftHasReverse(db: DbOrTrx, ctx: TenantContext, draftId: string): Promise<boolean> {
  const row = await db
    .selectFrom("actions")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "create_draft")
    .where("reverses_action_id", "=", draftId)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

// A resend shares the draft of the failed send (D18).
export async function listSendsOfDraft(
  db: DbOrTrx,
  ctx: TenantContext,
  draftId: string
): Promise<{ id: string; status: string }[]> {
  return db
    .selectFrom("actions")
    .select(["id", "status"])
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "send")
    .where("depends_on_action_id", "=", draftId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

// `from` guards the change. An `approved` send closes only when no run holds it (`locked_at` null or before `staleBefore`).
// `result_notified_at` stays null: the notifier sends the result (D20). The caller writes the audit row.
export async function setExpired(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string,
  opts: { reason: string; at: Date; from: "awaiting_approval" | "approved"; staleBefore: Date }
): Promise<boolean> {
  const result = await trx
    .updateTable("actions")
    .set({ status: "expired", status_reason: opts.reason, locked_at: null, next_attempt_at: null, updated_at: opts.at })
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "send")
    .where("status", "=", opts.from)
    .$if(opts.from === "approved", (qb) =>
      qb.where((eb) => eb.or([eb("locked_at", "is", null), eb("locked_at", "<", opts.staleBefore)]))
    )
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

// A `ready` original draft whose send is dead: no draft is created for it (D13). The caller writes the audit row.
export async function expireReadyDraft(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string,
  at: Date
): Promise<boolean> {
  const result = await trx
    .updateTable("actions")
    .set({ status: "expired", status_reason: "send_closed", locked_at: null, updated_at: at })
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "create_draft")
    .where("reverses_action_id", "is", null)
    .where("status", "=", "ready")
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

// Ids of the reminder sends of a delegation that can still be closed, locked FOR UPDATE.
// Lock order (D6): the caller holds the delegation lock. Only `awaiting_approval` and `approved` rows are selected on purpose:
// a reminder in flight is `applying`, and the committer holds that row while it waits for the delegation lock.
// Selecting `applying` rows here would close the cycle and deadlock.
export async function listOpenReminderSends(
  trx: Transaction<DB>,
  ctx: TenantContext,
  delegationId: string
): Promise<string[]> {
  const rows = await trx
    .selectFrom("actions")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "send")
    .where("status", "in", ["awaiting_approval", "approved"])
    .where(sql<string>`payload->>'delegation_id'`, "=", delegationId)
    .where(sql<boolean>`jsonb_exists(payload, 'reminder')`)
    .orderBy("created_at")
    .orderBy("id")
    .forUpdate()
    .execute();
  return rows.map((row) => row.id);
}

export async function setApproved(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string,
  input: { userId: string; via: string; at: Date }
): Promise<boolean> {
  const result = await trx
    .updateTable("actions")
    .set({
      status: "approved",
      approved_by: input.userId,
      approved_at: input.at,
      approved_via: input.via,
      updated_at: input.at,
    })
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "send")
    .where("status", "=", "awaiting_approval")
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

// An `approved` row that a run holds (`locked_at` at or after `staleBefore`) finishes: it is not rejected.
// The caller writes the audit row. `result_notified_at` stays null (D20).
export async function setRejected(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string,
  opts: { at: Date; staleBefore: Date }
): Promise<boolean> {
  const result = await trx
    .updateTable("actions")
    .set({ status: "rejected", status_reason: "rejected", locked_at: null, next_attempt_at: null, updated_at: opts.at })
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "send")
    .where((eb) =>
      eb.or([
        eb("status", "=", "awaiting_approval"),
        eb.and([
          eb("status", "=", "approved"),
          eb.or([eb("locked_at", "is", null), eb("locked_at", "<", opts.staleBefore)]),
        ]),
      ])
    )
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

// The sends of one reminder set, locked FOR UPDATE (the action rows only).
export async function listSetSends(trx: Transaction<DB>, ctx: TenantContext, setId: string): Promise<SendRow[]> {
  const rows = await sendBase(trx, ctx)
    .where(sql<string>`actions.payload->>'set_id'`, "=", setId)
    .orderBy("actions.created_at")
    .orderBy("actions.id")
    .forUpdate("actions")
    .execute();
  return rows.map(toSendRow);
}

// "Send again" (D18): one new `approved` send per failed row, same draft. Null when the key exists.
export async function insertSendAgain(
  trx: Transaction<DB>,
  ctx: TenantContext,
  previous: SendRow,
  input: { userId: string; via: string; at: Date }
): Promise<string | null> {
  const row = await trx
    .insertInto("actions")
    .values({
      org_id: ctx.orgId,
      email_id: previous.email_id,
      type: "send",
      status: "approved",
      payload: JSON.stringify(previous.payload),
      idempotency_key: `${previous.id}:again`,
      depends_on_action_id: previous.depends_on_action_id,
      approved_by: input.userId,
      approved_at: input.at,
      approved_via: input.via,
    })
    .onConflict((oc) => oc.columns(["org_id", "idempotency_key"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  return row?.id ?? null;
}

// Sends the notifier can show: the draft is `applied` and the mailbox is `active`.
function notifiableSends(db: DbOrTrx, ctx: TenantContext) {
  return sendBase(db, ctx)
    .innerJoin("actions as draft", (join) =>
      join.onRef("draft.id", "=", "actions.depends_on_action_id").onRef("draft.org_id", "=", "actions.org_id")
    )
    .innerJoin("mailboxes", (join) =>
      join.onRef("mailboxes.id", "=", "emails.mailbox_id").onRef("mailboxes.org_id", "=", "actions.org_id")
    )
    .where("draft.org_id", "=", ctx.orgId)
    .where("mailboxes.org_id", "=", ctx.orgId)
    .where("draft.status", "=", "applied")
    .where("mailboxes.status", "=", "active")
    .where("actions.status", "=", "awaiting_approval")
    .where("actions.notified_at", "is", null);
}

export async function listSendsToNotify(db: DbOrTrx, ctx: TenantContext, opts: { limit: number }): Promise<SendRow[]> {
  const rows = await notifiableSends(db, ctx)
    .where(sql<boolean>`actions.payload->>'set_id' is null`)
    .orderBy("actions.created_at")
    .orderBy("actions.id")
    .limit(opts.limit)
    .execute();
  return rows.map(toSendRow);
}

// A set is listed whole, and only when none of its sends waits for a draft (D21).
export async function listSetsToNotify(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { limit: number }
): Promise<Map<string, SendRow[]>> {
  const setIdOf = sql<string>`actions.payload->>'set_id'`;
  const candidates = () =>
    notifiableSends(db, ctx).where(sql<boolean>`actions.payload->>'set_id' is not null`).where(sql<boolean>`not exists (
        select 1 from actions s2
        join actions d2 on d2.id = s2.depends_on_action_id and d2.org_id = s2.org_id
        where s2.org_id = actions.org_id and s2.type = 'send'
          and s2.payload->>'set_id' = actions.payload->>'set_id'
          and d2.status in ('ready', 'applying')
      )`);
  const setIds = await candidates()
    .clearSelect()
    .select(setIdOf.as("set_id"))
    .groupBy(setIdOf)
    .orderBy(sql`min(actions.created_at)`)
    .orderBy(setIdOf)
    .limit(opts.limit)
    .execute();
  const grouped = new Map<string, SendRow[]>();
  if (setIds.length === 0) return grouped;
  const rows = await candidates()
    .where(
      setIdOf,
      "in",
      setIds.map((r) => r.set_id)
    )
    .orderBy("actions.created_at")
    .orderBy("actions.id")
    .execute();
  for (const { set_id } of setIds) grouped.set(set_id, []);
  for (const row of rows) {
    const setId = (row.payload as Record<string, unknown>).set_id as string;
    grouped.get(setId)?.push(toSendRow(row));
  }
  return grouped;
}

// D20: an `applied` send waits for its Sent copy outcome; a copy still `pending` after `pendingCopyMaxAgeMs` counts as lost.
export async function listSendResultsToNotify(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { limit: number; now: Date; pendingCopyMaxAgeMs: number }
): Promise<SendRow[]> {
  const pendingBefore = new Date(opts.now.getTime() - opts.pendingCopyMaxAgeMs);
  const rows = await sendBase(db, ctx)
    .where("actions.result_notified_at", "is", null)
    .where((eb) =>
      eb.or([
        eb("actions.status", "in", ["failed", "expired", "rejected"]),
        eb.and([
          eb("actions.status", "=", "applied"),
          eb.or([
            eb(sql<string | null>`actions.provider_result->>'sent_copy'`, "is distinct from", "pending"),
            eb("actions.applied_at", "<", pendingBefore),
          ]),
        ]),
      ])
    )
    .orderBy("actions.updated_at")
    .orderBy("actions.id")
    .limit(opts.limit)
    .execute();
  return rows.map(toSendRow);
}

export async function markResultNotified(db: DbOrTrx, ctx: TenantContext, id: string, at: Date): Promise<boolean> {
  const result = await db
    .updateTable("actions")
    .set({ result_notified_at: at })
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "send")
    .where("result_notified_at", "is", null)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

type ExpiredReason = "timeout" | "draft_missing" | "not_notified" | "held_timeout";

// D22: the sends of one mailbox that the expiry job closes, each with the first reason that applies.
export async function listExpiredApprovals(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { now: Date; limit: number; staleBefore: Date }
): Promise<{ id: string; reason: ExpiredReason }[]> {
  const ttlBefore = new Date(opts.now.getTime() - APPROVAL_TTL_MS);
  const createdBefore = new Date(opts.now.getTime() - UNNOTIFIED_TTL_MS);
  const result = await sql<{ id: string; reason: ExpiredReason }>`
    select id, reason from (
      select a.id, a.created_at,
        case
          when a.status = 'awaiting_approval' and a.notified_at < ${ttlBefore} then 'timeout'
          when a.status = 'awaiting_approval' and d.status in ('failed', 'undone') then 'draft_missing'
          when a.status = 'awaiting_approval' and a.notified_at is null and a.created_at < ${createdBefore}
            then 'not_notified'
          when a.status = 'approved' and a.approved_at < ${ttlBefore}
            and (a.locked_at is null or a.locked_at < ${opts.staleBefore}) then 'held_timeout'
        end as reason
      from actions a
      join emails e on e.id = a.email_id and e.org_id = a.org_id
      left join actions d on d.id = a.depends_on_action_id and d.org_id = a.org_id
      where a.org_id = ${ctx.orgId} and e.org_id = ${ctx.orgId} and e.mailbox_id = ${mailboxId}
        and a.type = 'send' and a.status in ('awaiting_approval', 'approved')
    ) x
    where reason is not null
    order by created_at, id
    limit ${opts.limit}
  `.execute(db);
  return result.rows;
}

// The `awaiting_approval` sends of one mailbox, oldest first. The caller locks each one (`expireSend`).
export async function listAwaitingSendIds(
  trx: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { emailId?: string } = {}
): Promise<{ id: string; emailId: string }[]> {
  const { emailId } = opts;
  const rows = await trx
    .selectFrom("actions")
    .select(["id", "email_id"])
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "send")
    .where("status", "=", "awaiting_approval")
    .where("email_id", "in", (eb) =>
      eb.selectFrom("emails").select("id").where("org_id", "=", ctx.orgId).where("mailbox_id", "=", mailboxId)
    )
    .$if(emailId !== undefined, (qb) => qb.where("email_id", "=", emailId as string))
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return rows.map((row) => ({ id: row.id, emailId: row.email_id }));
}

// For /status (D16): the whole organization, or one mailbox. `approvedHeld` is the approved sends that `send` does
// not admit; `approvedSending` is the approved sends that it admits.
export async function countApprovals(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { send: SendClaimFilter; mailboxId?: string }
): Promise<{ waiting: number; oldestNotifiedAt: Date | null; approvedHeld: number; approvedSending: number }> {
  const admitted = sendFilterExpr(opts.send);
  let query = db
    .selectFrom("actions")
    .select([
      sql<string>`count(*) filter (where actions.status = 'awaiting_approval')`.as("waiting"),
      sql<Date | null>`min(actions.notified_at) filter (where actions.status = 'awaiting_approval')`.as("oldest"),
      sql<string>`count(*) filter (where actions.status = 'approved' and not ${admitted})`.as("held"),
      sql<string>`count(*) filter (where actions.status = 'approved' and ${admitted})`.as("sending"),
    ])
    .where("actions.org_id", "=", ctx.orgId)
    .where("actions.type", "=", "send");
  if (opts.mailboxId !== undefined) {
    const mailboxId = opts.mailboxId;
    query = query
      .innerJoin("emails", (join) =>
        join.onRef("emails.id", "=", "actions.email_id").onRef("emails.org_id", "=", "actions.org_id")
      )
      .where("emails.mailbox_id", "=", mailboxId);
  }
  const row = await query.executeTakeFirstOrThrow();
  return {
    waiting: Number(row.waiting),
    oldestNotifiedAt: row.oldest,
    approvedHeld: Number(row.held),
    approvedSending: Number(row.sending),
  };
}
