import { createHash } from "node:crypto";

import { MINUTE_MS } from "@ea/core";
import { sql } from "kysely";

import type { SecretBox } from "../../../platform/crypto";
import type { Db, TenantContext } from "../../../platform/db";
import { HardError } from "../../../platform/errors";
import { createLog } from "../../../platform/log";
import { getMembership } from "../../tenancy";

import type { MailOAuthProvider } from "./providers";

// The sign-in state of the mailbox OAuth code flow.
// A row binds one sign-in attempt to a user, an organization, a provider and (a Reconnect) a mailbox. The `state` value is random and
// leaves the server only in the provider URL: the row keeps its SHA-256. The PKCE verifier is stored encrypted (AAD `oauth_state:<row id>`).
// No state, verifier or code reaches a log line, an error message or an audit row.

const log = createLog("mail");

export const OAUTH_STATE_TTL_MS = 10 * MINUTE_MS;
/** At most this many live rows for one user in one organization: a new start deletes the oldest beyond `cap - 1` first. */
export const OAUTH_STATE_CAP = 5;

const RANDOM_BYTES = 32;
/** 32 random bytes in base64url, no padding. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export interface OAuthStart {
  provider: MailOAuthProvider;
  userId: string;
  /** Set for a Reconnect: the OAuth mailbox of this provider in the organization. */
  mailboxId: string | null;
}

/** A start that the binding forbids: the user is no member of the organization, or the mailbox is no OAuth mailbox of this provider there. The message holds no id. */
export class OAuthStateRefusedError extends HardError {
  readonly reason: "not_a_member" | "mailbox_not_found";

  constructor(reason: OAuthStateRefusedError["reason"]) {
    super(`oauth state refused: ${reason}`);
    this.name = "OAuthStateRefusedError";
    this.reason = reason;
  }
}

export type ConsumeResult =
  | { ok: true; start: OAuthStart; verifier: string }
  | { ok: false; code: "oauth_state_invalid" | "oauth_state_expired" };

const randomToken = (): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(RANDOM_BYTES))).toString("base64url");

/** The hash a row keeps. */
export const stateHashOf = (state: string): string => createHash("sha256").update(state, "utf8").digest("hex");

/** The S256 challenge of a verifier (RFC 7636 §4.2). */
export const challengeOf = (verifier: string): string =>
  createHash("sha256").update(verifier, "ascii").digest("base64url");

const aadOf = (rowId: string): string => `oauth_state:${rowId}`;

/**
 * Makes one state row and returns the `state` value and the PKCE challenge for the provider URL. One transaction: the binding checks, the
 * cap and the insert. The caller's `now` sets `expires_at`.
 * @throws OAuthStateRefusedError when the user is no member of `ctx.orgId`, or a Reconnect mailbox is not an OAuth mailbox of the provider in it.
 */
export async function createOAuthState(
  db: Db,
  secrets: SecretBox,
  ctx: TenantContext,
  start: OAuthStart,
  now: Date
): Promise<{ state: string; codeChallenge: string }> {
  const state = randomToken();
  const verifier = randomToken();
  const id = crypto.randomUUID();
  const encrypted = secrets.encrypt(verifier, aadOf(id));
  await db.transaction().execute(async (trx) => {
    // The state row binds a user to its organization: the foreign key checks the user and the organization one by one, not the pair.
    if ((await getMembership(trx, ctx, start.userId)) === undefined) throw new OAuthStateRefusedError("not_a_member");
    if (start.mailboxId !== null) {
      const mailbox = await trx
        .selectFrom("mailboxes")
        .select("id")
        .where("org_id", "=", ctx.orgId)
        .where("id", "=", start.mailboxId)
        .where("oauth_provider", "=", start.provider)
        .executeTakeFirst();
      if (mailbox === undefined) throw new OAuthStateRefusedError("mailbox_not_found");
    }
    // Two starts of one user at the same time must not both pass the cap.
    await sql`select pg_advisory_xact_lock(hashtextextended(${`oauth_state:${ctx.orgId}:${start.userId}`}, 0))`.execute(
      trx
    );
    await trx
      .deleteFrom("mailbox_oauth_states")
      .where("org_id", "=", ctx.orgId)
      .where(
        "id",
        "in",
        trx
          .selectFrom("mailbox_oauth_states")
          .select("id")
          .where("org_id", "=", ctx.orgId)
          .where("user_id", "=", start.userId)
          .orderBy("created_at", "desc")
          .orderBy("id", "desc")
          .offset(OAUTH_STATE_CAP - 1)
      )
      .execute();
    await trx
      .insertInto("mailbox_oauth_states")
      .values({
        id,
        org_id: ctx.orgId,
        user_id: start.userId,
        provider: start.provider,
        mailbox_id: start.mailboxId,
        state_hash: stateHashOf(state),
        encrypted_verifier: encrypted.ciphertext,
        key_version: encrypted.keyVersion,
        expires_at: new Date(now.getTime() + OAUTH_STATE_TTL_MS),
      })
      .execute();
  });
  return { state, codeChallenge: challengeOf(verifier) };
}

const invalid = { ok: false, code: "oauth_state_invalid" } as const;

/**
 * Takes the row of `state` and deletes it in one statement that commits at once: the caller redeems the code afterwards, and a replay finds
 * nothing. The row must match the organization, the user and the provider: any other row answers `oauth_state_invalid` and stays. A row that
 * is found and expired is deleted and answers `oauth_state_expired`. The user must still be a member of the organization.
 * `db` is the pool, never a caller's transaction: the delete must not wait for the caller's commit.
 */
export async function consumeOAuthState(
  db: Db,
  secrets: SecretBox,
  ctx: TenantContext,
  input: { state: string; provider: MailOAuthProvider; userId: string },
  now: Date
): Promise<ConsumeResult> {
  // Not a value this server made: no database call.
  if (!TOKEN_SHAPE.test(input.state)) return invalid;
  const row = await db
    .deleteFrom("mailbox_oauth_states")
    .where("state_hash", "=", stateHashOf(input.state))
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", input.userId)
    .where("provider", "=", input.provider)
    .returningAll()
    .executeTakeFirst();
  if (row === undefined) return invalid;
  if (row.expires_at.getTime() <= now.getTime()) return { ok: false, code: "oauth_state_expired" };
  if ((await getMembership(db, ctx, input.userId)) === undefined) return invalid;
  let verifier: string;
  try {
    verifier = secrets.decrypt({ ciphertext: row.encrypted_verifier, keyVersion: row.key_version }, aadOf(row.id));
  } catch {
    // A key change since the start. The error is dropped on purpose; the user signs in again.
    log.warn("oauth_state_decrypt_failed", { org_id: ctx.orgId, mailbox_id: row.mailbox_id });
    return invalid;
  }
  return { ok: true, start: { provider: input.provider, userId: input.userId, mailboxId: row.mailbox_id }, verifier };
}
