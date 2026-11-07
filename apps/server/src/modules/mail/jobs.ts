import type { Transaction } from "kysely";

import type { SecretBox } from "../../platform/crypto";
import type { DB, Db, TenantContext } from "../../platform/db";
import { SoftError } from "../../platform/errors";
import { createLog } from "../../platform/log";

import type { ImapConnectOptions } from "./imap/client";
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
async function syncOne(deps: MailSyncJobDeps, ctx: TenantContext, mailboxId: string): Promise<void> {
  const { provider } = await openMailboxProvider(deps, ctx, mailboxId);
  try {
    const result = await syncMailbox(
      { db: deps.db, provider, isOwnActionId: deps.isOwnActionId, now: deps.now },
      ctx,
      mailboxId
    );
    await markSynced(deps.db, ctx, mailboxId, deps.now());
    log.info(
      `synced ${mailboxId}: ${result.mode}, fetched ${result.fetched}, stored ${result.stored}, uid updated ${result.uidUpdated}, returned ${result.returned}`
    );
  } finally {
    await provider.close().catch((error: unknown) => {
      log.warn(`close ${mailboxId} failed:`, error instanceof Error ? error.message : String(error));
    });
  }
}

export function createMailSyncJob(deps: MailSyncJobDeps): { run(): Promise<void> } {
  return {
    async run() {
      const targets = await listSyncTargets(deps.db);
      for (const { orgId, mailboxId } of targets) {
        const ctx = { orgId };
        try {
          await syncOne(deps, ctx, mailboxId);
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
