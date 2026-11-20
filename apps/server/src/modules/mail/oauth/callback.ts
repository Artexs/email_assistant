import { MINUTE_MS } from "@ea/core";
import { z } from "zod";

import type { SecretBox } from "../../../platform/crypto";
import type { Db, TenantContext } from "../../../platform/db";
import { createLog } from "../../../platform/log";
import { getMailbox } from "../repo/mailboxes";

import { OAuthGrantError, type MailOAuthClient, type TokenAnswer } from "./client";
import { parseIdTokenClaims } from "./id-token";
import { mailOAuthProviders, type MailOAuthProvider } from "./providers";
import { consumeOAuthState, type OAuthStart } from "./state";

// The check of the provider's redirect. The query goes in; a checked grant or one refusal code comes
// out. No route, no mailbox write and no audit row here. A refusal stores nothing.
// No code, token, ID token, state, verifier or provider `error_description` reaches a log line, an error or the result of a
// refusal. A refusal logs its code only.

const log = createLog("mail");

/** The closed set of codes a callback may end with. A later step adds `connected` and `reconnected`. */
export type OAuthRefusalCode =
  | "oauth_cancelled"
  | "oauth_state_invalid"
  | "oauth_state_expired"
  | "oauth_code_invalid"
  | "oauth_scope_missing"
  | "oauth_wrong_account"
  | "mailbox_exists"
  | "mailbox_limit"
  | "admin_consent_required"
  | "protocol_disabled"
  | "feature_off"
  | "not_configured"
  | "oauth_failed";

export interface OAuthGrant {
  start: OAuthStart;
  provider: MailOAuthProvider;
  /** Lower case. */
  address: string;
  /** Microsoft: the `tid` claim. Google: null. */
  tenantId: string | null;
  /** Secret. */
  refreshToken: string;
  /** Secret. */
  mailAccessToken: string;
  mailExpiresInSec: number;
  scopes: string[];
}

export type CallbackResult = { ok: true; grant: OAuthGrant } | { ok: false; code: OAuthRefusalCode };

export interface CallbackDeps {
  /** The pool, never a caller's transaction: the state row is deleted and committed before the code redeem. */
  db: Db;
  secrets: SecretBox;
  clients: Partial<Record<MailOAuthProvider, MailOAuthClient>>;
  now(): Date;
}

export interface CallbackInput {
  /** The provider of the route path, not a value from the query. */
  provider: MailOAuthProvider;
  /** The signed-in user of the request. */
  userId: string;
  query: Record<string, string>;
}

// AADSTS numbers that mean "consent is missing" (`CONSENT_AADSTS`).
const CONSENT_NUMBERS: readonly string[] = ["90094", "90095", "65001"];
/** An ID token may be up to 5 minutes past its `exp` (clock skew). */
const EXP_SKEW_MS = 5 * MINUTE_MS;
// The same rule as `addressSchema` of @ea/core (not exported there): the HTML5 pattern and at most 254 characters.
const ADDRESS = z.email({ pattern: z.regexes.html5Email }).max(254);
const GUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const MICROSOFT_MAIL_SCOPE = /^(?:https:\/\/outlook\.office(?:365)?\.com\/)?imap\.accessasuser\.all$/;

const refuse = (provider: MailOAuthProvider, code: OAuthRefusalCode): CallbackResult => {
  log.info("oauth_callback_refused", { provider, code });
  return { ok: false, code };
};

/** The code for an `error` in the query. Reads the AADSTS numbers only; the description is never kept. */
function codeOfQueryError(error: string, description: string | undefined): OAuthRefusalCode {
  if (error === "consent_required") return "admin_consent_required";
  if (description !== undefined && CONSENT_NUMBERS.some((number) => description.includes(`AADSTS${number}`))) {
    return "admin_consent_required";
  }
  if (error === "access_denied") return "oauth_cancelled";
  return "oauth_failed";
}

/**
 * Does the answer's scope list hold the one mail scope of the provider? Google names it in full. Microsoft may answer the full form or
 * the short form (`IMAP.AccessAsUser.All`); the full form must name a Microsoft Outlook host (`outlook.office.com`, `outlook.office365.com`). Microsoft leaves out `offline_access` and `openid`. The check is case-insensitive.
 */
function hasMailScope(provider: MailOAuthProvider, scopes: readonly string[]): boolean {
  const lower = scopes.map((scope) => scope.toLowerCase());
  if (provider === "google") return lower.includes("https://mail.google.com/");
  return lower.some((scope) => MICROSOFT_MAIL_SCOPE.test(scope));
}

/**
 * Checks the redirect of the provider and redeems the code. Order: client, state (consumed first, also with `error`), query error, code
 * redeem, refresh token, scopes, ID token, address, Reconnect account.
 * @throws a soft error of the token client (`OAuthSoftError`) is turned into `oauth_failed`; nothing is thrown for a refusal.
 */
export async function finishOAuthCallback(
  deps: CallbackDeps,
  ctx: TenantContext,
  input: CallbackInput
): Promise<CallbackResult> {
  const { provider, query } = input;
  const client = deps.clients[provider];
  if (client === undefined) return refuse(provider, "not_configured");
  const state = query.state;
  if (state === undefined || state === "") return refuse(provider, "oauth_state_invalid");

  // The delete commits here, before any call to the provider: a replay finds nothing, and a crash leaves nothing stored.
  const consumed = await consumeOAuthState(
    deps.db,
    deps.secrets,
    ctx,
    { state, provider, userId: input.userId },
    deps.now()
  );
  if (!consumed.ok) return refuse(provider, consumed.code);
  const { start, verifier } = consumed;

  if (query.error !== undefined) return refuse(provider, codeOfQueryError(query.error, query.error_description));
  const code = query.code;
  if (code === undefined || code === "") return refuse(provider, "oauth_failed");

  let answer: TokenAnswer;
  try {
    answer = await client.redeemCode(code, verifier);
  } catch (error) {
    // The token client logged its own safe line. Its error holds a reason and a code, never a token.
    if (error instanceof OAuthGrantError) {
      return refuse(
        provider,
        error.reason === "admin_consent_required" ? "admin_consent_required" : "oauth_code_invalid"
      );
    }
    return refuse(provider, "oauth_failed");
  }

  if (answer.refreshToken === null) return refuse(provider, "oauth_failed");
  if (!hasMailScope(provider, answer.scopes)) return refuse(provider, "oauth_scope_missing");

  const spec = mailOAuthProviders[provider];
  const claims = answer.idToken === null ? null : parseIdTokenClaims(answer.idToken);
  if (claims === null) return refuse(provider, "oauth_failed");
  if (!claims.aud.includes(client.clientId)) return refuse(provider, "oauth_failed");
  if (claims.exp === null || claims.exp * 1000 <= deps.now().getTime() - EXP_SKEW_MS)
    return refuse(provider, "oauth_failed");
  if (claims.iss === null || !spec.issuerOk(claims.iss)) return refuse(provider, "oauth_failed");

  let tenantId: string | null = null;
  let rawAddress: string | null;
  if (provider === "google") {
    if (claims.emailVerified !== true) return refuse(provider, "oauth_failed");
    rawAddress = claims.email;
  } else {
    // `issuerOk` made the issuer `https://login.microsoftonline.com/<tenant GUID>/v2.0`. `tid` must be a GUID and equal that path segment
    // (not a part of the URL: the host segment must never pass as a tenant).
    const issuerTenant = claims.iss.split("/")[3]?.toLowerCase();
    if (claims.tid === null || !GUID.test(claims.tid) || claims.tid.toLowerCase() !== issuerTenant) {
      return refuse(provider, "oauth_failed");
    }
    tenantId = claims.tid.toLowerCase();
    rawAddress = claims.email ?? claims.preferredUsername;
  }
  if (rawAddress === null) return refuse(provider, "oauth_failed");
  const parsed = ADDRESS.safeParse(rawAddress);
  if (!parsed.success) return refuse(provider, "oauth_failed");
  const address = parsed.data.toLowerCase();

  if (start.mailboxId !== null) {
    const mailbox = await getMailbox(deps.db, ctx, start.mailboxId);
    // A mailbox removed since the start has nothing to reconnect.
    if (mailbox === undefined) return refuse(provider, "oauth_failed");
    if (mailbox.address.toLowerCase() !== address) return refuse(provider, "oauth_wrong_account");
  }

  return {
    ok: true,
    grant: {
      start,
      provider,
      address,
      tenantId,
      refreshToken: answer.refreshToken,
      mailAccessToken: answer.accessToken,
      mailExpiresInSec: answer.expiresInSec,
      scopes: answer.scopes,
    },
  };
}
