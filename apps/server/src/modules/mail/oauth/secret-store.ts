import { sql, type Transaction } from "kysely";
import { z } from "zod";

import type { SecretBox } from "../../../platform/crypto";
import type { DB, Db, TenantContext } from "../../../platform/db";
import { HardError } from "../../../platform/errors";
import { getCredentials, updateCredentials } from "../repo";

import type { MailOAuthProvider } from "./providers";

// The stored secret of an OAuth mailbox and the lock that orders its writers (F117 stage 09).
// The secret is the refresh token and its metadata, encrypted with AAD `mailbox:<id>` and the current key version (ADR 0009).
// No access token is stored. An error here has a fixed message; it never holds the secret or the ciphertext (F117 plan, secrets rule).

export interface OAuthSecret {
  v: 1;
  provider: MailOAuthProvider;
  /** Secret. */
  refreshToken: string;
  /** Microsoft: the tenant GUID. Google: null. */
  tenantId: string | null;
  scopes: string[];
}

const oauthSecretSchema = z.object({
  v: z.literal(1),
  provider: z.enum(["microsoft", "google"]),
  refreshToken: z.string().min(1),
  tenantId: z.string().min(1).nullable(),
  scopes: z.array(z.string()),
});

export function encodeOAuthSecret(secret: OAuthSecret): string {
  return JSON.stringify({
    v: 1,
    provider: secret.provider,
    refreshToken: secret.refreshToken,
    tenantId: secret.tenantId,
    scopes: secret.scopes,
  } satisfies OAuthSecret);
}

/** @throws HardError (no content in the message) when the text is not JSON or has another shape. */
export function decodeOAuthSecret(clear: string): OAuthSecret {
  let parsed: unknown;
  try {
    parsed = JSON.parse(clear);
  } catch {
    throw new HardError("oauth secret is not valid");
  }
  const result = oauthSecretSchema.safeParse(parsed);
  if (!result.success) throw new HardError("oauth secret is not valid");
  return result.data;
}

/**
 * Runs `fn` in one transaction on the pool under the per-mailbox advisory lock. The lock ends with the transaction. A Reconnect and a
 * refresh (stage 10) both take it, so they never interleave. Pass the pool, never a caller's transaction.
 */
export async function withMailboxOAuthLock<T>(
  pool: Db,
  mailboxId: string,
  fn: (tx: Transaction<DB>) => Promise<T>
): Promise<T> {
  return pool.transaction().execute(async (tx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`mailbox_oauth:${mailboxId}`}, 0))`.execute(tx);
    return fn(tx);
  });
}

/** @throws HardError when the mailbox has no credentials row, or its secret is a password. */
export async function readOAuthSecret(
  tx: Transaction<DB>,
  secrets: SecretBox,
  ctx: TenantContext,
  mailboxId: string
): Promise<OAuthSecret> {
  const credentials = await getCredentials(tx, ctx, mailboxId);
  if (credentials === undefined) throw new HardError("mailbox has no stored secret");
  if (credentials.secret_kind !== "oauth") throw new HardError("mailbox secret is not an oauth secret");
  return decodeOAuthSecret(
    secrets.decrypt(
      { ciphertext: credentials.encrypted_secret, keyVersion: credentials.key_version },
      `mailbox:${mailboxId}`
    )
  );
}

/** Replaces the secret of the mailbox in the caller's transaction. @throws HardError when the credentials row is missing. */
export async function saveOAuthSecret(
  tx: Transaction<DB>,
  secrets: SecretBox,
  ctx: TenantContext,
  mailboxId: string,
  secret: OAuthSecret
): Promise<void> {
  const sealed = secrets.encrypt(encodeOAuthSecret(secret), `mailbox:${mailboxId}`);
  const stored = await updateCredentials(tx, ctx, mailboxId, {
    encryptedSecret: sealed.ciphertext,
    secretKind: "oauth",
    keyVersion: sealed.keyVersion,
  });
  if (!stored) throw new HardError("mailbox has no stored secret");
}
