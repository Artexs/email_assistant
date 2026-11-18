import { sameAddress, type RemoveAccessPage, type RemoveMailboxResult } from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { SecretBox } from "../../platform/crypto";
import type { DB, Db, TenantContext } from "../../platform/db";
import { errorFields } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";

import type { MailOAuthClients } from "./oauth/client";
import { accessPageOf, readRemoveTarget, revokeGoogleToken } from "./oauth/revoke";
import type { OAuthTokens } from "./port";
import { changeMailboxStatus, getMailbox } from "./repo";

const log = createLog("mail");

/** What the owner is told about the access at the provider; set for an OAuth mailbox only. */
export interface RemovedAccess {
  page: RemoveAccessPage;
  /** Google: the revoke call went through (true) or not (false). Microsoft: null, no call exists. */
  revoked: boolean | null;
}

export interface RemoveDeps {
  db: Db;
  /**
   * Queues the owners' notice (fact 6: mail cannot import channels; web.ts wires channels here). It runs inside the delete transaction.
   * Exception: a Google mailbox. The text depends on the revoke, which runs after the commit, so the notice is queued then, in its own
   * transaction (a crash in between loses the notice, the same accepted loss as the revoke).
   */
  onRemoved(
    trx: Transaction<DB>,
    ctx: TenantContext,
    input: { mailboxId: string; now: Date; access?: RemovedAccess }
  ): Promise<void>;
  /** An OAuth mailbox needs these. Missing: Remove still works, the revoke is reported as failed. */
  oauth?: { secrets: SecretBox; clients: MailOAuthClients; tokens?: Pick<OAuthTokens, "drop"> };
}

export type RemoveResult =
  | { kind: "removed"; outcome: RemoveMailboxResult }
  | { kind: "not_found" }
  | { kind: "confirm_mismatch" };

const NOT_FOUND_CODE = "P0002";
const DEADLOCK_CODE = "40P01";

function codeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

// The typed address must match; the pause commits first so that no new claim starts, then one transaction deletes
// the rows, writes the audit row and queues the owners' notice.
export async function removeMailbox(
  deps: RemoveDeps,
  ctx: TenantContext,
  mailboxId: string,
  input: { userId: string; confirmAddress: string; now: Date }
): Promise<RemoveResult> {
  const { db } = deps;
  const { now } = input;
  const mailboxLog = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId });
  const mailbox = await getMailbox(db, ctx, mailboxId);
  if (!mailbox) return { kind: "not_found" };
  if (!sameAddress(input.confirmAddress, mailbox.address)) return { kind: "confirm_mismatch" };

  const paused = await changeMailboxStatus(db, ctx, mailboxId, { from: "active", to: "paused", at: now });

  // An OAuth mailbox: the secret is read before the delete (the row and its secret go with it); Microsoft needs the tenant, Google the token.
  const provider = mailbox.oauth_provider;
  const target =
    provider === null
      ? null
      : deps.oauth === undefined
        ? { provider, refreshToken: null, tenantId: null }
        : await readRemoveTarget({ db, secrets: deps.oauth.secrets }, ctx, mailboxId, provider);
  const page = target === null ? null : accessPageOf(target);
  const isGoogle = provider === "google";
  const remove = () =>
    db.transaction().execute(async (trx) => {
      await sql`SELECT delete_mailbox(${ctx.orgId}::uuid, ${mailboxId}::uuid)`.execute(trx);
      await recordAudit(trx, ctx, {
        actor: input.userId,
        event: auditEvents.mailboxRemoved,
        data: { mailbox_id: mailboxId },
        at: now,
      });
      // Google: the notice waits for the revoke (see `RemoveDeps.onRemoved`).
      if (!isGoogle) {
        await deps.onRemoved(trx, ctx, {
          mailboxId,
          now,
          ...(page === null ? {} : { access: { page, revoked: null } }),
        });
      }
    });

  try {
    try {
      await remove();
    } catch (error) {
      if (codeOf(error) !== DEADLOCK_CODE) throw error;
      await remove();
    }
  } catch (error) {
    if (codeOf(error) === NOT_FOUND_CODE) return { kind: "not_found" };
    if (paused) {
      try {
        await changeMailboxStatus(db, ctx, mailboxId, { from: "paused", to: "active", at: now });
      } catch (restoreError) {
        mailboxLog.error("mailbox_status_restore_failed", errorFields(restoreError));
      }
    }
    throw error;
  }
  mailboxLog.info("mailbox_removed", { user_id: input.userId });

  // After the commit: no cached access token of the mailbox may outlive it. A crash from here on leaves the token valid at the
  // provider until it expires or the owner revokes it; the notice text names the page (accepted limit).
  let revoked: boolean | null = null;
  if (provider !== null && target !== null && page !== null) {
    deps.oauth?.tokens?.drop(mailboxId);
    if (isGoogle) {
      revoked = await revokeGoogleToken(deps.oauth?.clients ?? {}, target, mailboxLog);
      try {
        await db
          .transaction()
          .execute((trx) => deps.onRemoved(trx, ctx, { mailboxId, now, access: { page, revoked } }));
      } catch (error) {
        mailboxLog.error("mailbox_removed_notice_failed", errorFields(error));
      }
    }
  }
  return {
    kind: "removed",
    outcome: {
      authMethod: provider === null ? "password" : "oauth",
      oauthProvider: provider,
      revoked,
      accessPage: page,
    },
  };
}
