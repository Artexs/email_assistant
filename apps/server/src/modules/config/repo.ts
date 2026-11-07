import {
  senderRuleKinds,
  type CategoryPolicy,
  type MailboxMode,
  type SenderRule,
  type SenderRuleKind,
  type ToolSwitches,
} from "@ea/core";
import { sql, type Selectable, type Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";

type DbOrTrx = Db | Transaction<DB>;

export type MailboxSettingsRow = Selectable<DB["mailbox_settings"]>;

const senderRuleKindSchema = z.enum(senderRuleKinds);

// Uses the column defaults: mode "shadow", all switches OFF, no automatic moves.
export async function insertDefaultSettings(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<void> {
  await db.insertInto("mailbox_settings").values({ mailbox_id: mailboxId, org_id: ctx.orgId }).execute();
}

// `version` is `updated_at` as text: it keeps the microseconds that a JS Date drops.
export async function getMailboxSettings(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string
): Promise<(MailboxSettingsRow & { version: string }) | undefined> {
  return db
    .selectFrom("mailbox_settings")
    .selectAll()
    .select(sql<string>`updated_at::text`.as("version"))
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirst();
}

// Locks the row until the end of the transaction: one setter at a time.
export async function lockMailboxSettings(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string
): Promise<MailboxSettingsRow | undefined> {
  return trx
    .selectFrom("mailbox_settings")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .forUpdate()
    .executeTakeFirst();
}

// Share lock until the end of the transaction: a setter (FOR UPDATE) waits for this writer, or the writer sees its commit.
// Returns the `version` of `getMailboxSettings`, or `undefined` when the row is missing.
export async function lockSettingsForShare(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string
): Promise<string | undefined> {
  const row = await trx
    .selectFrom("mailbox_settings")
    .select(sql<string>`updated_at::text`.as("version"))
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .forShare()
    .executeTakeFirst();
  return row?.version;
}

export async function updateMailboxSettings(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  patch: { mode?: MailboxMode; toolSwitches?: ToolSwitches; categoryPolicy?: CategoryPolicy }
): Promise<boolean> {
  const result = await trx
    .updateTable("mailbox_settings")
    .set({
      ...(patch.mode === undefined ? {} : { mode: patch.mode }),
      ...(patch.toolSwitches === undefined ? {} : { tool_switches: JSON.stringify(patch.toolSwitches) }),
      ...(patch.categoryPolicy === undefined ? {} : { category_policy: JSON.stringify(patch.categoryPolicy) }),
      updated_at: sql`now()`,
    })
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirst();
  return (result.numUpdatedRows ?? 0n) > 0n;
}

// Moves work with MOVE, or with COPY + EXPUNGE through UIDPLUS (D1). Read here, because `mail` imports `config`.
export async function getMovesSupported(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<boolean> {
  const row = await db
    .selectFrom("mailboxes")
    .select("capabilities")
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .executeTakeFirst();
  const capabilities = (row?.capabilities ?? {}) as { move?: unknown; uidplus?: unknown };
  return capabilities.move === true || capabilities.uidplus === true;
}

// Org-wide rules (mailbox_id NULL) and the rules of this mailbox.
export async function listSenderRules(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<SenderRule[]> {
  const rows = await db
    .selectFrom("sender_rules")
    .select(["pattern", "kind"])
    .where("org_id", "=", ctx.orgId)
    .where((eb) => eb.or([eb("mailbox_id", "is", null), eb("mailbox_id", "=", mailboxId)]))
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return rows.map((row) => ({ pattern: row.pattern, kind: senderRuleKindSchema.parse(row.kind) }));
}

// Returns false when the same rule exists (unique key with NULLS NOT DISTINCT).
export async function insertSenderRule(
  db: DbOrTrx,
  ctx: TenantContext,
  input: { mailboxId: string | null; pattern: string; kind: SenderRuleKind }
): Promise<boolean> {
  const result = await db
    .insertInto("sender_rules")
    .values({
      org_id: ctx.orgId,
      mailbox_id: input.mailboxId,
      pattern: input.pattern.trim().toLowerCase(),
      kind: input.kind,
    })
    .onConflict((oc) => oc.doNothing())
    .executeTakeFirst();
  return (result.numInsertedOrUpdatedRows ?? 0n) > 0n;
}
