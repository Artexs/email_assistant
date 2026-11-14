import type { LlmRole } from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";

type DbOrTrx = Db | Transaction<DB>;

// Ids, codes and numbers only, never mail text (modules §3.6): no nested objects.
export type AuditData = Record<string, string | number | boolean | null>;

export const auditEvents = {
  emailTriaged: "email.triaged",
  emailSkipped: "email.skipped",
  actionPlanned: "action.planned",
  llmCall: "llm.call",
  emailRequeued: "email.requeued",
  chatLinked: "chat.linked",
  chatUnlinked: "chat.unlinked",
  mailboxConnected: "mailbox.connected",
  mailboxPaused: "mailbox.paused",
  mailboxResumed: "mailbox.resumed",
  mailboxPasswordChanged: "mailbox.password_changed",
  mailboxRemoved: "mailbox.removed", // data: mailbox_id
  mailboxHostAllowed: "mailbox.host_allowed", // data: mailbox_id
  onboardingModeKept: "onboarding.mode_kept", // data: via
  actionApplied: "action.applied",
  actionFailed: "action.failed",
  actionUndone: "action.undone",
  actionUndoRequested: "action.undo_requested",
  actionExpired: "action.expired",
  actionApplying: "action.applying",
  actionSendLimited: "action.send_limited", // data: limit, until, mailbox_id; reason_code send_limit
  actionApproved: "action.approved",
  actionRejected: "action.rejected",
  actionSendAgain: "action.send_again",
  actionWentOut: "action.went_out", // data: delegation_id, outgoing_message_id
  actionRejectReason: "action.reject_reason", // reason_code: the reason; data: via
  actionMistake: "action.mistake", // data: via
  actionSentCopyFailed: "action.sent_copy_failed",
  emailReturned: "email.returned",
  mailboxFolderCreated: "mailbox.folder_created",
  mailboxModeChanged: "mailbox.mode_changed",
  mailboxPolicyChanged: "mailbox.policy_changed",
  mailboxSwitchChanged: "mailbox.switch_changed",
  mailboxSyncFolderAdded: "mailbox.sync_folder_added", // data: mailbox_id, folder_key, role
  mailboxSyncFolderChanged: "mailbox.sync_folder_changed", // data: mailbox_id, folder_key, enabled
  ruleAdded: "rule.added", // data: rule_id, kind, scope, mailbox_id when scope is "mailbox"
  ruleRemoved: "rule.removed", // data: the same
  orgTimezoneChanged: "org.timezone_changed", // data: from, to
  orgStyleChanged: "org.style_changed", // data: set
  orgPlanChanged: "org.plan_changed", // data: from, to, max_from, max_to, trial_ends_at
  orgFlagChanged: "org.flag_changed", // data: flag, enabled
  orgBreakGlassSet: "org.break_glass_set", // data: user_id
  orgBreakGlassCleared: "org.break_glass_cleared", // data: user_id, reason ("cli" | "replaced" | "two_factor_reset")
  delegateAdded: "delegate.added",
  delegateChanged: "delegate.changed",
  delegationCreated: "delegation.created",
  delegationSent: "delegation.sent",
  delegationAnswered: "delegation.answered",
  delegationOverdue: "delegation.overdue",
  delegationCancelled: "delegation.cancelled",
  delegationDone: "delegation.done",
  delegationChaserRun: "delegation.chaser_run",
  webLogin: "web.login",
  webPasswordSet: "web.password_set",
  webPasswordChanged: "web.password_changed",
  webLoginLocked: "web.login_locked", // data: via, locked_until
  webTermsAccepted: "web.terms_accepted", // data: via, version
  webTelegramConsent: "web.telegram_consent", // data: via, version
  webSessionsRevoked: "web.sessions_revoked", // data: via
  webOtherSessionsRevoked: "web.other_sessions_revoked", // data: via
  webTwoFactorEnabled: "web.two_factor_enabled", // data: via
  webTwoFactorDisabled: "web.two_factor_disabled", // data: via
  webBackupCodesGenerated: "web.backup_codes_generated", // data: via
  webBackupCodeUsed: "web.backup_code_used", // data: via
  webTwoFactorLocked: "web.two_factor_locked", // data: via, locked_until
  operatorNotice: "operator.notice", // data: kind, key
} as const;

export interface AuditEvent {
  emailId?: string;
  actionId?: string;
  actor: "system" | string;
  event: string;
  reasonCode?: string;
  data?: AuditData;
  // Sets created_at; without it the DB default now().
  at?: Date;
}

// A status change and its audit row go in one transaction: the caller passes `trx`.
export async function recordAudit(db: DbOrTrx, ctx: TenantContext, event: AuditEvent): Promise<void> {
  await db
    .insertInto("audit_log")
    .values({
      org_id: ctx.orgId,
      email_id: event.emailId ?? null,
      action_id: event.actionId ?? null,
      actor: event.actor,
      event: event.event,
      reason_code: event.reasonCode ?? null,
      data: JSON.stringify(event.data ?? {}),
      ...(event.at ? { created_at: event.at } : {}),
    })
    .execute();
}

// True when the organization has a row of any of these events.
export async function hasAuditEvent(db: DbOrTrx, ctx: TenantContext, events: readonly string[]): Promise<boolean> {
  const row = await db
    .selectFrom("audit_log")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("event", "in", [...events])
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

// True when the organization has a row of this event with `data.key = key` (the dedup of the operator notices).
export async function hasAuditKey(db: DbOrTrx, ctx: TenantContext, event: string, key: string): Promise<boolean> {
  const row = await db
    .selectFrom("audit_log")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("event", "=", event)
    .where(sql<string>`data->>'key'`, "=", key)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

// One row per organization and event: true when this call wrote it.
export async function recordAuditOnce(db: DbOrTrx, ctx: TenantContext, event: AuditEvent): Promise<boolean> {
  const result = await sql`
    INSERT INTO audit_log (org_id, email_id, action_id, actor, event, reason_code, data, created_at)
    SELECT ${ctx.orgId}, ${event.emailId ?? null}, ${event.actionId ?? null}, ${event.actor}, ${event.event},
      ${event.reasonCode ?? null}, ${JSON.stringify(event.data ?? {})}::jsonb, ${event.at ?? sql`now()`}
    WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE org_id = ${ctx.orgId} AND event = ${event.event})
  `.execute(db);
  return (result.numAffectedRows ?? 0n) > 0n;
}

/** One LLM call attempt. Ids, codes and numbers only: never the prompt or the answer. */
export interface LlmCallRecord {
  emailId?: string;
  mailboxId: string;
  role: LlmRole;
  promptVersion: string;
  model: string;
  /** `ok` or the LLM error code. */
  outcome: string;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
  at: Date;
}

// Every LLM call writes one `llm.call` row here: the daily cap and the cost per role read these rows.
export async function recordLlmCall(db: DbOrTrx, ctx: TenantContext, call: LlmCallRecord): Promise<void> {
  await recordAudit(db, ctx, {
    emailId: call.emailId,
    actor: "system",
    event: auditEvents.llmCall,
    reasonCode: call.outcome,
    data: {
      mailbox_id: call.mailboxId,
      role: call.role,
      model: call.model,
      prompt_version: call.promptVersion,
      tokens_in: call.tokensIn,
      tokens_out: call.tokensOut,
      latency_ms: call.latencyMs,
    },
    at: call.at,
  });
}

// F099 D18: `llm.call` rows of the organization at or after `since`, per model (no model: "unknown").
export async function sumLlmCallsByModelSince(
  db: DbOrTrx,
  ctx: TenantContext,
  since: Date
): Promise<{ model: string; calls: number; tokensIn: number; tokensOut: number }[]> {
  const model = sql<string>`coalesce(data->>'model', 'unknown')`;
  const rows = await db
    .selectFrom("audit_log")
    .select([
      model.as("model"),
      sql<string>`count(*)`.as("calls"),
      sql<string>`coalesce(sum((data->>'tokens_in')::bigint), 0)`.as("tokens_in"),
      sql<string>`coalesce(sum((data->>'tokens_out')::bigint), 0)`.as("tokens_out"),
    ])
    .where("org_id", "=", ctx.orgId)
    .where("event", "=", auditEvents.llmCall)
    .where("created_at", ">=", since)
    .groupBy(model)
    .orderBy(model)
    .execute();
  return rows.map((row) => ({
    model: row.model,
    calls: Number(row.calls),
    tokensIn: Number(row.tokens_in),
    tokensOut: Number(row.tokens_out),
  }));
}

// One `llm.call` row per LLM call attempt; the mailbox id is in `data`, so no join to `emails`.
// With a role: rows of that role; rows without a role count as classifier rows (written before roles existed).
export async function countLlmCallsSince(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  since: Date,
  opts: { role?: LlmRole } = {}
): Promise<number> {
  let query = db
    .selectFrom("audit_log")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("event", "=", auditEvents.llmCall)
    .where(sql<string>`data->>'mailbox_id'`, "=", mailboxId)
    .where("created_at", ">=", since);
  const { role } = opts;
  if (role === "classifier") {
    query = query.where((eb) =>
      eb.or([eb(sql<string>`data->>'role'`, "=", role), eb(sql<string>`data->>'role'`, "is", null)])
    );
  } else if (role !== undefined) {
    query = query.where(sql<string>`data->>'role'`, "=", role);
  }
  const row = await query.executeTakeFirstOrThrow();
  return Number(row.count);
}

// Rows of one event in the window `after < created_at <= until`, optionally of one `reason_code`.
export async function countEventsBetween(
  db: DbOrTrx,
  ctx: TenantContext,
  event: string,
  range: { after: Date; until: Date },
  opts?: { reasonCode?: string }
): Promise<number> {
  let query = db
    .selectFrom("audit_log")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("event", "=", event)
    .where("created_at", ">", range.after)
    .where("created_at", "<=", range.until);
  if (opts?.reasonCode !== undefined) query = query.where("reason_code", "=", opts.reasonCode);
  const row = await query.executeTakeFirstOrThrow();
  return Number(row.count);
}

// As `countEventsBetween`, for the rows of one mailbox (`data.mailbox_id`).
export async function countMailboxEventsBetween(
  db: DbOrTrx,
  ctx: TenantContext,
  event: string,
  mailboxId: string,
  range: { after: Date; until: Date }
): Promise<number> {
  const row = await db
    .selectFrom("audit_log")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("event", "=", event)
    .where(sql<string>`data->>'mailbox_id'`, "=", mailboxId)
    .where("created_at", ">", range.after)
    .where("created_at", "<=", range.until)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

// The actor of the newest row of one event on one action; undefined when there is none.
export async function findActionActor(
  db: DbOrTrx,
  ctx: TenantContext,
  actionId: string,
  event: string
): Promise<string | undefined> {
  const row = await db
    .selectFrom("audit_log")
    .select("actor")
    .where("org_id", "=", ctx.orgId)
    .where("action_id", "=", actionId)
    .where("event", "=", event)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  return row?.actor;
}

export interface AuditEventRow {
  id: string;
  at: Date;
  actor: string;
  event: string;
  reasonCode: string | null;
  data: unknown;
}

// The newest rows of the organization with an event in `events` and `created_at >= since`, newest first (created_at, then id).
// Index audit_log_org_event_created_idx (org_id, event, created_at) serves it. The security log and the operator notice list read through it.
export async function listAuditEvents(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { events: readonly string[]; since: Date; limit: number }
): Promise<AuditEventRow[]> {
  if (opts.events.length === 0) return [];
  const rows = await db
    .selectFrom("audit_log")
    .select(["id", "created_at", "actor", "event", "reason_code", "data"])
    .where("org_id", "=", ctx.orgId)
    .where("event", "in", [...opts.events])
    .where("created_at", ">=", opts.since)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(opts.limit)
    .execute();
  return rows.map((row) => ({
    id: String(row.id),
    at: row.created_at,
    actor: row.actor,
    event: row.event,
    reasonCode: row.reason_code,
    data: row.data,
  }));
}
