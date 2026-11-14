import type { ActionType } from "@ea/core";
import { sql } from "kysely";
import { z } from "zod";

import type { TenantContext } from "../../../platform/db";
import { HardError } from "../../../platform/errors";

import { actionTypeSchema, type DbOrTrx } from "./shared";

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
