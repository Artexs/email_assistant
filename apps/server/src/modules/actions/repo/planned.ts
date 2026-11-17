import {
  draftPayloadSchema,
  replyRecipientsProblem,
  sameAddresses,
  sendPayloadSchema,
  type ActionType,
} from "@ea/core";
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
    .leftJoin("emails as e", (join) => join.onRef("e.id", "=", "a.email_id").onRef("e.org_id", "=", "a.org_id"))
    .leftJoin("open_loops as l", (join) => join.onRef("l.id", "=", "a.loop_id").onRef("l.org_id", "=", "a.org_id"))
    .select("a.id")
    .where("a.org_id", "=", ctx.orgId)
    .where("a.id", "=", actionId)
    .where("a.type", "in", ["create_draft", "send"])
    // The mailbox of the action: of its mail, or of its loop (a follow-up has no mail). Both joins check `org_id`.
    .where((eb) =>
      eb.or([
        eb.and([eb("e.org_id", "=", ctx.orgId), eb("e.mailbox_id", "=", mailboxId)]),
        eb.and([eb("l.org_id", "=", ctx.orgId), eb("l.mailbox_id", "=", mailboxId)]),
      ])
    )
    .executeTakeFirst();
  return row !== undefined;
}
// Who made a mail of the Sent folder, by its `X-EA-Action-Id` (one query; any sender can write the header).
// `system`: a send of this mailbox that went out (applied or started), or a draft with such a send.
// `draft`: a draft of this mailbox that was not sent by the system: the user sent it by hand. null: not an own action.
export async function sentOriginOf(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  actionId: string
): Promise<"system" | "draft" | null> {
  if (!z.uuid().safeParse(actionId).success) return null;
  const row = await db
    .selectFrom("actions as a")
    .leftJoin("emails as e", (join) => join.onRef("e.id", "=", "a.email_id").onRef("e.org_id", "=", "a.org_id"))
    .leftJoin("open_loops as l", (join) => join.onRef("l.id", "=", "a.loop_id").onRef("l.org_id", "=", "a.org_id"))
    .select((eb) => [
      "a.type",
      "a.status",
      "a.send_started_at",
      eb
        .exists(
          eb
            .selectFrom("actions as s")
            .select("s.id")
            .whereRef("s.org_id", "=", "a.org_id")
            .whereRef("s.depends_on_action_id", "=", "a.id")
            .where("s.type", "=", "send")
            .where((w) => w.or([w("s.status", "=", "applied"), w("s.send_started_at", "is not", null)]))
        )
        .as("has_sent_send"),
    ])
    .where("a.org_id", "=", ctx.orgId)
    .where("a.id", "=", actionId)
    .where("a.type", "in", ["create_draft", "send"])
    // The mailbox of the action: of its mail, or of its loop (a follow-up has no mail). Both joins check `org_id`.
    .where((eb) =>
      eb.or([
        eb.and([eb("e.org_id", "=", ctx.orgId), eb("e.mailbox_id", "=", mailboxId)]),
        eb.and([eb("l.org_id", "=", ctx.orgId), eb("l.mailbox_id", "=", mailboxId)]),
      ])
    )
    .executeTakeFirst();
  if (row === undefined) return null;
  const sent = row.type === "send" ? row.status === "applied" || row.send_started_at !== null : row.has_sent_send;
  return sent ? "system" : "draft";
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
  return insertPlanned(db, ctx, { emailId }, items);
}
// The same for a follow-up: the items hang on an open loop (`loop_id`), not on a mail. Keys: `<loop id>:create_draft:…` and
// `<loop id>:send:…` (the rule of `createPlanned` with the loop id in place of the email id).
export async function createPlannedForLoop(
  db: DbOrTrx,
  ctx: TenantContext,
  loopId: string,
  items: PlannedActionInput[]
): Promise<CreatedAction[]> {
  return insertPlanned(db, ctx, { loopId }, items);
}
// The rules of a reply that no schema checks (reply drafts). The recipients are never LLM text: the writer gets them from the stored
// headers of the mail, and this check refuses a payload whose To or Cc breaks the rules before it is stored. A reply hangs on a
// mail, never on a loop. The error text holds no address. `drafted` is the To and Cc of the draft of the same call.
async function checkReplyItem(
  db: DbOrTrx,
  ctx: TenantContext,
  anchor: { emailId: string } | { loopId: string },
  item: PlannedActionInput,
  drafted: { to: readonly string[]; cc: readonly string[] } | undefined
): Promise<{ to: readonly string[]; cc: readonly string[] } | undefined> {
  if (item.payload.kind !== "reply") return undefined;
  if (item.type !== "create_draft" && item.type !== "send")
    throw new HardError("a reply payload is for a draft or a send");
  if ("loopId" in anchor) throw new HardError("a reply hangs on a mail");
  const parsed =
    item.type === "create_draft"
      ? draftPayloadSchema.safeParse(item.payload)
      : sendPayloadSchema.safeParse(item.payload);
  if (!parsed.success || parsed.data.kind !== "reply") throw new HardError("reply payload is invalid");
  const recipients = { to: parsed.data.to, cc: parsed.data.cc ?? [] };
  const own = await db.selectFrom("mailboxes").select("address").where("org_id", "=", ctx.orgId).execute();
  const problem = replyRecipientsProblem(
    recipients,
    own.map((row) => row.address)
  );
  if (problem !== null) throw new HardError(`reply recipients: ${problem}`);
  if (
    drafted !== undefined &&
    !(sameAddresses(drafted.to, recipients.to) && sameAddresses(drafted.cc, recipients.cc))
  ) {
    throw new HardError("reply send and draft name different recipients");
  }
  return item.type === "create_draft" ? recipients : drafted;
}
async function insertPlanned(
  db: DbOrTrx,
  ctx: TenantContext,
  anchor: { emailId: string } | { loopId: string },
  items: PlannedActionInput[]
): Promise<CreatedAction[]> {
  const anchorId = "emailId" in anchor ? anchor.emailId : anchor.loopId;
  const created: CreatedAction[] = [];
  let draftId: string | undefined;
  let drafted: { to: readonly string[]; cc: readonly string[] } | undefined;
  for (const item of items) {
    drafted = (await checkReplyItem(db, ctx, anchor, item, drafted)) ?? drafted;
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
            .where("idempotency_key", "=", draftKeyOf(anchorId, item.idempotencyKey))
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
        email_id: "emailId" in anchor ? anchor.emailId : null,
        loop_id: "loopId" in anchor ? anchor.loopId : null,
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
