import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";

import { changeMailboxStatus, getMailboxSummary, type MailboxSummary } from "./repo";

const log = createLog("mail");

export type SwitchResult =
  | { kind: "changed"; mailbox: MailboxSummary }
  | { kind: "already"; mailbox: MailboxSummary }
  | { kind: "auth_error" }
  | { kind: "not_found" };

// The conditional update and its audit row share one transaction (the caller's, when `db` is one).
export async function switchMailboxStatus(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  input: { to: "paused" | "active"; actor: string; via: "web" | "telegram"; now: Date }
): Promise<SwitchResult> {
  const { to, actor, via, now } = input;
  const run = async (trx: Transaction<DB>): Promise<SwitchResult> => {
    const done = await changeMailboxStatus(trx, ctx, mailboxId, {
      from: to === "paused" ? "active" : "paused",
      to,
      at: now,
    });
    if (done) {
      await recordAudit(trx, ctx, {
        actor,
        event: to === "paused" ? auditEvents.mailboxPaused : auditEvents.mailboxResumed,
        data: { mailbox_id: mailboxId, via },
        at: now,
      });
    }
    const mailbox = await getMailboxSummary(trx, ctx, mailboxId);
    if (!mailbox) return { kind: "not_found" };
    if (done) return { kind: "changed", mailbox };
    return mailbox.status === "auth_error" ? { kind: "auth_error" } : { kind: "already", mailbox };
  };
  const result = await (db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run));
  if (result.kind === "changed") {
    log.info(`mailbox ${mailboxId} ${to === "paused" ? "paused" : "resumed"} by user ${actor}`);
  }
  return result;
}
