import { randomUUID } from "node:crypto";

import type { ActionType } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../../src/platform/db";

import { insertTriaged } from "./mail";

// One `actions` row. `applied` and `undone` rows need `applied_at`: it defaults to the row's creation time.
export async function insertAction(
  trx: Transaction<DB>,
  ctx: TenantContext,
  emailId: string,
  opts: {
    type: ActionType;
    status: string;
    payload?: Record<string, unknown>;
    idempotencyKey?: string;
    appliedAt?: Date | null;
    reversesActionId?: string | null;
    attempts?: number;
    nextAttemptAt?: Date | null;
    lastError?: string | null;
    lockedAt?: Date | null;
    statusReason?: string | null;
    createdAt?: Date;
    dependsOnActionId?: string | null;
    providerResult?: Record<string, unknown> | null;
    approvedAt?: Date | null;
    approvedBy?: string | null;
    approvedVia?: string | null;
    notifiedAt?: Date | null;
    outgoingMessageId?: string | null;
  }
): Promise<string> {
  const createdAt = opts.createdAt ?? new Date();
  const needsAppliedAt = opts.status === "applied" || opts.status === "undone";
  const row = await trx
    .insertInto("actions")
    .values({
      org_id: ctx.orgId,
      email_id: emailId,
      type: opts.type,
      status: opts.status,
      payload: JSON.stringify(opts.payload ?? {}),
      idempotency_key: opts.idempotencyKey ?? `test:${randomUUID()}`,
      applied_at: opts.appliedAt === undefined ? (needsAppliedAt ? createdAt : null) : opts.appliedAt,
      reverses_action_id: opts.reversesActionId ?? null,
      attempts: opts.attempts ?? 0,
      next_attempt_at: opts.nextAttemptAt ?? null,
      last_error: opts.lastError ?? null,
      locked_at: opts.lockedAt ?? null,
      status_reason: opts.statusReason ?? null,
      created_at: createdAt,
      depends_on_action_id: opts.dependsOnActionId ?? null,
      provider_result: opts.providerResult ? JSON.stringify(opts.providerResult) : null,
      approved_at: opts.approvedAt ?? null,
      approved_by: opts.approvedBy ?? null,
      approved_via: opts.approvedVia ?? null,
      notified_at: opts.notifiedAt ?? null,
      outgoing_message_id: opts.outgoingMessageId ?? null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}
// A triaged mail (`insertTriaged`) with its location columns and action rows; the actions are created in the given order.
export async function insertTriagedWithActions(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  opts: Parameters<typeof insertTriaged>[3] & {
    folder?: string;
    sourceFolder?: string;
    uid?: number;
    sourceUid?: number | null;
    contentHash?: string;
    movedAt?: Date | null;
    actions: Omit<Parameters<typeof insertAction>[3], "createdAt">[];
  }
): Promise<{ emailId: string; actionIds: string[] }> {
  const { folder, sourceFolder, uid, sourceUid, contentHash, movedAt, actions, ...triaged } = opts;
  const emailId = await insertTriaged(trx, ctx, mailboxId, triaged);
  const mailUid = uid ?? 1;
  await trx
    .updateTable("emails")
    .set({
      folder: folder ?? "INBOX",
      source_folder: sourceFolder ?? "INBOX",
      uid: mailUid,
      source_uid: sourceUid === undefined ? mailUid : sourceUid,
      content_hash: contentHash ?? "h",
      moved_at: movedAt ?? null,
    })
    .where("id", "=", emailId)
    .where("org_id", "=", ctx.orgId)
    .execute();
  const actionIds: string[] = [];
  for (const action of actions) {
    actionIds.push(await insertAction(trx, ctx, emailId, { ...action, createdAt: triaged.createdAt }));
  }
  return { emailId, actionIds };
}
