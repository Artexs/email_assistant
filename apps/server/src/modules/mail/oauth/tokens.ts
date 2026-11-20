import { MINUTE_MS } from "@ea/core";

import type { SecretBox } from "../../../platform/crypto";
import type { Db, TenantContext } from "../../../platform/db";
import { SoftError } from "../../../platform/errors";
import { createLog } from "../../../platform/log";
import { MailAuthError, type OAuthTokens, type TokenResource } from "../port";
import { lockMailbox } from "../repo";

import { OAuthGrantError, OAuthSoftError, type MailOAuthClients } from "./client";
import type { MailOAuthProvider } from "./providers";
import { readOAuthSecret, saveOAuthSecret, withMailboxOAuthLock } from "./secret-store";

// The token store of OAuth mailboxes (ADR 0031): a process cache of access tokens and the refresh behind it.
// No token reaches a log line or an error (the plan secrets rule). Every line here carries the provider (a closed set).

const log = createLog("mail");

/** A cached token is used only while at least this much of its life is left. */
export const TOKEN_MIN_LEFT_MS = 5 * MINUTE_MS;

export interface OAuthTokensDeps {
  /** The pool. The refresh opens its own transaction on it (`withMailboxOAuthLock`), never inside the caller's one. */
  pool: Db;
  secrets: SecretBox;
  clients: MailOAuthClients;
  now(): Date;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
  /** The organization of the mailbox: a hit for another organization is a miss, so a wrong context never gets a token. */
  orgId: string;
}

const keyOf = (mailboxId: string, resource: TokenResource): string => `${mailboxId}:${resource}`;

/**
 * The token store behind `openMailboxProvider`. A token lives in process memory only; the database holds the refresh token.
 *
 * Lock order (the same as Reconnect, `apply.ts`): the advisory lock of the mailbox first (`withMailboxOAuthLock`), then the mailbox
 * row (`lockMailbox`, FOR UPDATE). The row lock comes only after the HTTP call, for the write of a rotated refresh token: the
 * statuses of the mailbox stay writable while the provider answers (up to 10 s).
 */
export function createOAuthTokens(deps: OAuthTokensDeps): OAuthTokens {
  const cache = new Map<string, CachedToken>();
  // One error line for each provider and process: the next runs would only repeat it.
  const notConfiguredLogged = new Set<MailOAuthProvider>();

  function drop(mailboxId: string): void {
    cache.delete(keyOf(mailboxId, "mail"));
    cache.delete(keyOf(mailboxId, "graph"));
  }

  async function refresh(ctx: TenantContext, mailboxId: string, resource: TokenResource): Promise<string> {
    try {
      return await withMailboxOAuthLock(deps.pool, mailboxId, async (tx) => {
        const secret = await readOAuthSecret(tx, deps.secrets, ctx, mailboxId);
        const client = deps.clients[secret.provider];
        if (client === undefined) {
          if (!notConfiguredLogged.has(secret.provider)) {
            notConfiguredLogged.add(secret.provider);
            log.error("mail_oauth_not_configured", { provider: secret.provider });
          }
          throw new SoftError("mail oauth is not configured");
        }
        let answer;
        try {
          answer = await client.refresh(secret.refreshToken, resource);
        } catch (error) {
          if (error instanceof OAuthSoftError && error.kind === "client_invalid") {
            log.error("mail_oauth_client_invalid", { provider: secret.provider });
          }
          throw error;
        }
        // A new refresh token replaces the old one in this transaction. Microsoft rotates; Google answers none.
        if (answer.refreshToken !== null && answer.refreshToken !== secret.refreshToken) {
          // The row lock is taken after the advisory lock, as Reconnect does. A mailbox that is gone has nothing to save.
          if ((await lockMailbox(tx, ctx, mailboxId)) === undefined) {
            throw new SoftError("mailbox is gone");
          }
          await saveOAuthSecret(tx, deps.secrets, ctx, mailboxId, { ...secret, refreshToken: answer.refreshToken });
        }
        const expiresAt = deps.now().getTime() + answer.expiresInSec * 1000;
        return { accessToken: answer.accessToken, expiresAt, orgId: ctx.orgId };
      }).then((fresh) => {
        // After the commit: a token of a rolled-back refresh never reaches the cache.
        cache.set(keyOf(mailboxId, resource), fresh);
        return fresh.accessToken;
      });
    } catch (error) {
      if (error instanceof OAuthGrantError) {
        // The grant is dead: no cached token of this mailbox may outlive it.
        drop(mailboxId);
        throw new MailAuthError("oauth grant refused", { reason: error.reason });
      }
      throw error;
    }
  }

  return {
    async accessToken(ctx, mailboxId, resource, opts) {
      if (opts?.fresh !== true) {
        const hit = cache.get(keyOf(mailboxId, resource));
        if (hit?.orgId === ctx.orgId && hit.expiresAt - deps.now().getTime() >= TOKEN_MIN_LEFT_MS) {
          return hit.accessToken;
        }
      }
      return refresh(ctx, mailboxId, resource);
    },
    drop,
  };
}
