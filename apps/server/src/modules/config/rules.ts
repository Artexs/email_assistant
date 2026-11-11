import { isValidSenderPattern, normalizeSenderPattern, SENDER_RULE_LIMIT, type SenderRuleKind } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { auditEvents, recordAudit, type AuditData } from "../audit";

import { countSenderRules, deleteSenderRule, insertSenderRule, mailboxInOrg, type SenderRuleRow } from "./repo";

export type AddRuleResult =
  | { kind: "added"; rule: SenderRuleRow }
  | { kind: "exists" }
  | { kind: "limit" }
  | { kind: "mailbox_not_found" };

async function inTransaction<T>(db: Db | Transaction<DB>, run: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

// The audit data names the rule by id, never by pattern: the pattern is an e-mail address.
function ruleAuditData(rule: Pick<SenderRuleRow, "id" | "kind" | "mailbox_id">): AuditData {
  return {
    rule_id: rule.id,
    kind: rule.kind,
    scope: rule.mailbox_id ? "mailbox" : "org",
    ...(rule.mailbox_id ? { mailbox_id: rule.mailbox_id } : {}),
  };
}

export async function addSenderRule(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: { mailboxId: string | null; pattern: string; kind: SenderRuleKind; actor: string; now: Date }
): Promise<AddRuleResult> {
  const normalized = normalizeSenderPattern(input.pattern);
  if (!isValidSenderPattern(normalized)) throw new HardError("invalid sender pattern");

  const run = async (trx: Transaction<DB>): Promise<AddRuleResult> => {
    if (input.mailboxId !== null && !(await mailboxInOrg(trx, ctx, input.mailboxId))) {
      return { kind: "mailbox_not_found" };
    }
    if ((await countSenderRules(trx, ctx)) >= SENDER_RULE_LIMIT) return { kind: "limit" };
    const rule = await insertSenderRule(trx, ctx, {
      mailboxId: input.mailboxId,
      pattern: normalized,
      kind: input.kind,
    });
    if (!rule) return { kind: "exists" };
    await recordAudit(trx, ctx, {
      actor: input.actor,
      event: auditEvents.ruleAdded,
      data: ruleAuditData(rule),
      at: input.now,
    });
    return { kind: "added", rule };
  };

  const ownsTransaction = !db.isTransaction;
  try {
    return await inTransaction(db, run);
  } catch (error) {
    // The mailbox was removed between the check and the insert (foreign key). Inside a caller's
    // transaction the error aborted it, so only a transaction of this service maps it.
    if (ownsTransaction && (error as { code?: string } | null)?.code === "23503") {
      return { kind: "mailbox_not_found" };
    }
    throw error;
  }
}

export async function removeSenderRule(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  ruleId: string,
  input: { actor: string; now: Date }
): Promise<{ kind: "removed" } | { kind: "not_found" }> {
  return inTransaction(db, async (trx) => {
    const rule = await deleteSenderRule(trx, ctx, ruleId);
    if (!rule) return { kind: "not_found" };
    await recordAudit(trx, ctx, {
      actor: input.actor,
      event: auditEvents.ruleRemoved,
      data: ruleAuditData(rule),
      at: input.now,
    });
    return { kind: "removed" };
  });
}
