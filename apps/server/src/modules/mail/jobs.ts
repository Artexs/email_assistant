import type { Transaction } from "kysely";

import type { SecretBox } from "../../platform/crypto";
import type { DB, Db, TenantContext } from "../../platform/db";
import { errorFields, SoftError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { isOrgSuspended } from "../tenancy";

import { FLAGS_REFRESH_EVERY_MS, refreshFlags } from "./flags";
import type { ImapConnectOptions } from "./imap/client";
import { findUserMoves } from "./moves";
import { openMailboxProvider } from "./open";
import { MailAuthError, type MailProvider } from "./port";
import { listSyncTargets, markSynced, setMailboxStatus } from "./repo";
import { CursorMovedError, syncMailbox, type SyncDeps } from "./sync";

const log = createLog("mail");

export interface MailSyncJobDeps {
  db: Db | Transaction<DB>;
  secrets: SecretBox;
  openProvider(opts: ImapConnectOptions): Promise<MailProvider>;
  isOwnActionId: SyncDeps["isOwnActionId"];
  now(): Date;
}

// The log lines carry the mailbox id only: never the address, a password or a subject.
async function syncOne(
  deps: MailSyncJobDeps,
  ctx: TenantContext,
  mailboxId: string,
  failures: Map<string, number>,
  lastFlagsAt: Map<string, number>
): Promise<void> {
  const { provider } = await openMailboxProvider(deps, ctx, mailboxId);
  try {
    const result = await syncMailbox(
      { db: deps.db, provider, isOwnActionId: deps.isOwnActionId, now: deps.now },
      ctx,
      mailboxId
    );
    await markSynced(deps.db, ctx, mailboxId, deps.now());
    const sum = (field: "fetched" | "stored" | "uidUpdated" | "returned") =>
      result.folders.reduce((total, folder) => total + folder[field], 0);
    log.info(
      `synced ${mailboxId}: folders ${result.folders.length}, fetched ${sum("fetched")}, stored ${sum("stored")}, uid updated ${sum("uidUpdated")}, returned ${sum("returned")}`
    );
    // D5: a folder that fails 3 runs in a row gets one error line, until it syncs again.
    for (const folder of result.folders) failures.set(`${mailboxId}:${folder.folder}`, 0);
    for (const key of result.failed) {
      const count = (failures.get(`${mailboxId}:${key}`) ?? 0) + 1;
      failures.set(`${mailboxId}:${key}`, count);
      if (count === 3) log.error(`sync ${mailboxId} folder ${key}: failed 3 runs in a row`);
    }
    // D6: the flag refresh reads FLAGS only, on this connection, at most every 10 min per mailbox. An error here never fails the sync.
    const flagsNow = deps.now().getTime();
    if (flagsNow - (lastFlagsAt.get(mailboxId) ?? 0) >= FLAGS_REFRESH_EVERY_MS) {
      lastFlagsAt.set(mailboxId, flagsNow);
      try {
        const refreshed = await refreshFlags({ db: deps.db, provider, now: deps.now }, ctx, mailboxId);
        log.info("flags_refreshed", { mailbox_id: mailboxId, count: refreshed.written });
        // Mail that the refresh did not find in its folder may sit at the same UID in a synced folder below its cursor (a webmail move keeps the UID).
        if (refreshed.gone.length > 0) {
          try {
            // `deps.db`, never a transaction: the finder takes the folder lock per folder and must not hold it across IMAP calls.
            await findUserMoves({ db: deps.db, provider, now: deps.now }, ctx, mailboxId, refreshed.gone, {
              skipFolders: [...result.failed, ...result.skipped],
            });
          } catch (error) {
            log.warn("user_moves_failed", { mailbox_id: mailboxId, ...errorFields(error) });
          }
        }
      } catch (error) {
        log.warn("flags_refresh_failed", { mailbox_id: mailboxId, ...errorFields(error) });
      }
    }
  } finally {
    await provider.close().catch((error: unknown) => {
      log.warn(`close ${mailboxId} failed:`, error instanceof Error ? error.message : String(error));
    });
  }
}

export function createMailSyncJob(deps: MailSyncJobDeps): { run(): Promise<void> } {
  const failures = new Map<string, number>();
  const lastFlagsAt = new Map<string, number>();
  return {
    async run() {
      const targets = await listSyncTargets(deps.db);
      for (const { orgId, mailboxId } of targets) {
        const ctx = { orgId };
        try {
          // D4: a suspend during the run stops the next mailbox, not only the next run.
          if (await isOrgSuspended(deps.db, ctx)) continue;
          await syncOne(deps, ctx, mailboxId, failures, lastFlagsAt);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (error instanceof MailAuthError) {
            try {
              await setMailboxStatus(deps.db, ctx, mailboxId, "auth_error", deps.now());
              log.warn(`sync ${mailboxId}: login failed, status is now auth_error`);
            } catch (statusError) {
              log.error(
                `sync ${mailboxId}: login failed, and setting auth_error failed:`,
                statusError instanceof Error ? statusError.message : String(statusError)
              );
            }
          } else if (error instanceof SoftError || error instanceof CursorMovedError) {
            log.warn(`sync ${mailboxId}: ${message}; the next tick tries again`);
          } else {
            log.error(`sync ${mailboxId} failed:`, message);
          }
        }
      }
    },
  };
}
