import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { errorFields, SoftError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";

import { mailHostPolicy, resolveMailHost, type MailHostPolicy } from "./host-guard";
import { HostNotAllowedError } from "./port";
import { changeMailboxStatus, getMailbox, listMailboxTargets } from "./repo";

const log = createLog("mail");

export type HostCheck = "allowed" | "refused" | "lookup_failed";

async function checkHost(host: string, policy: MailHostPolicy): Promise<HostCheck> {
  try {
    await resolveMailHost(host, policy);
    return "allowed";
  } catch (error) {
    if (error instanceof HostNotAllowedError) return "refused";
    if (error instanceof SoftError) return "lookup_failed";
    throw error;
  }
}

/** The guard on both hosts of a mailbox. No connection, no password. Holds no host name in any result or error. */
export async function checkMailboxHosts(
  mailbox: { imap_host: string; smtp_host: string },
  policy: MailHostPolicy = mailHostPolicy()
): Promise<{ imap: HostCheck; smtp: HostCheck }> {
  const imap = await checkHost(mailbox.imap_host, policy);
  const smtp = await checkHost(mailbox.smtp_host, policy);
  return { imap, smtp };
}

export interface HostStatusDeps {
  db: Db | Transaction<DB>;
  now(): Date;
}

// The status change and its audit row share one transaction (the caller's, when `db` is one).
async function reopenHost(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  now: Date
): Promise<boolean> {
  const run = async (trx: Transaction<DB>): Promise<boolean> => {
    const changed = await changeMailboxStatus(trx, ctx, mailboxId, { from: "host_blocked", to: "active", at: now });
    if (changed) {
      await recordAudit(trx, ctx, {
        actor: "system",
        event: auditEvents.mailboxHostAllowed,
        data: { mailbox_id: mailboxId },
        at: now,
      });
    }
    return changed;
  };
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

/** The way out of host_blocked. Never throws: each failure is one log line, and the sync run goes on. */
export async function recheckBlockedHosts(deps: HostStatusDeps): Promise<{ checked: number; reopened: number }> {
  const now = deps.now();
  let targets: { orgId: string; mailboxId: string }[];
  try {
    targets = await listMailboxTargets(deps.db, { statuses: ["host_blocked"], includeSuspended: false });
  } catch (error) {
    log.error("mailbox_host_recheck_failed", { ...errorFields(error) });
    return { checked: 0, reopened: 0 };
  }
  let checked = 0;
  let reopened = 0;
  for (const { orgId, mailboxId } of targets) {
    try {
      const ctx = { orgId };
      const mailbox = await getMailbox(deps.db, ctx, mailboxId);
      if (!mailbox) continue;
      const hosts = await checkMailboxHosts(mailbox);
      checked += 1;
      if (hosts.imap === "allowed" && hosts.smtp === "allowed") {
        if (await reopenHost(deps.db, ctx, mailboxId, now)) {
          reopened += 1;
          log.info("mailbox_host_allowed", { mailbox_id: mailboxId });
        }
      } else if (hosts.imap !== "refused" && hosts.smtp !== "refused") {
        log.warn("mailbox_host_check_failed", { mailbox_id: mailboxId, reason: "lookup_failed" });
      }
    } catch (error) {
      log.warn("mailbox_host_check_failed", { mailbox_id: mailboxId, ...errorFields(error) });
    }
  }
  return { checked, reopened };
}
