import type { RemoveAccessPage } from "@ea/core";

import type { SecretBox } from "../../../platform/crypto";
import type { Db, TenantContext } from "../../../platform/db";
import type { Log } from "../../../platform/log";

import { OAuthSoftError, type MailOAuthClients } from "./client";
import type { MailOAuthProvider } from "./providers";
import { readOAuthSecret, withMailboxOAuthLock } from "./secret-store";

// What Remove does at the provider (remove rule). Google has a revoke call. Microsoft has none for a delegated token: the owner
// withdraws the access on a page, so Remove only picks the page. A token never reaches a log line or an error here.

/** The tenant of every personal Microsoft account (Outlook.com, Hotmail). A work or school tenant has another GUID. */
export const MICROSOFT_PERSONAL_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

/** What a failed revoke is called in the log: a client fault kind, or the cause on our side. */
export type RevokeFailureKind = OAuthSoftError["kind"] | "not_configured" | "secret_unreadable" | "unknown";

export interface RemoveTarget {
  provider: MailOAuthProvider;
  /** Secret. Null when the stored secret could not be read. */
  refreshToken: string | null;
  tenantId: string | null;
}

/**
 * Reads and decrypts the secret of an OAuth mailbox before its delete, under the mailbox lock, and releases the lock at once (a
 * refresh in flight finishes first, so the token read is the current one). Never throws: an unreadable secret must not stop a Remove.
 */
export async function readRemoveTarget(
  deps: { db: Db; secrets: SecretBox },
  ctx: TenantContext,
  mailboxId: string,
  provider: MailOAuthProvider
): Promise<RemoveTarget> {
  try {
    const secret = await withMailboxOAuthLock(deps.db, mailboxId, (tx) =>
      readOAuthSecret(tx, deps.secrets, ctx, mailboxId)
    );
    return { provider: secret.provider, refreshToken: secret.refreshToken, tenantId: secret.tenantId };
  } catch {
    return { provider, refreshToken: null, tenantId: null };
  }
}

/** Where the owner withdraws the access. An unreadable Microsoft secret has no tenant: the work page is the default. */
export function accessPageOf(target: RemoveTarget): RemoveAccessPage {
  if (target.provider === "google") return "google";
  return target.tenantId?.toLowerCase() === MICROSOFT_PERSONAL_TENANT ? "microsoft_personal" : "microsoft_work";
}

/** Revokes a Google refresh token, best effort. A failure is one `warn` line with the provider and the kind; it never throws. */
export async function revokeGoogleToken(
  clients: MailOAuthClients,
  target: RemoveTarget,
  mailboxLog: Log
): Promise<boolean> {
  const fail = (kind: RevokeFailureKind): false => {
    mailboxLog.warn("mail_oauth_revoke_failed", { provider: "google", kind });
    return false;
  };
  const client = clients.google;
  if (client === undefined) return fail("not_configured");
  if (target.refreshToken === null) return fail("secret_unreadable");
  try {
    await client.revoke(target.refreshToken);
    return true;
  } catch (error) {
    return fail(error instanceof OAuthSoftError ? error.kind : "unknown");
  }
}
