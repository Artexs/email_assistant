import { senderRuleKinds, type SenderRule, type SenderRuleKind } from "@ea/core";
import type { Selectable, Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";

type DbOrTrx = Db | Transaction<DB>;

export type MailboxSettingsRow = Selectable<DB["mailbox_settings"]>;

const senderRuleKindSchema = z.enum(senderRuleKinds);

// Uses the column defaults: mode "shadow", all switches OFF, no automatic moves.
export async function insertDefaultSettings(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<void> {
  await db.insertInto("mailbox_settings").values({ mailbox_id: mailboxId, org_id: ctx.orgId }).execute();
}

export async function getMailboxSettings(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string
): Promise<MailboxSettingsRow | undefined> {
  return db
    .selectFrom("mailbox_settings")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirst();
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
