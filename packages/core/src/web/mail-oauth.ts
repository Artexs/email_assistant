import { z } from "./zod";

// The panel API of the mailbox OAuth sign-in (F117). The route, its apiDoc and the panel parse with these objects.

/** The providers a mailbox connects with. Registry order: the order of `options`. */
export const mailOAuthProviderKeys = ["microsoft", "google"] as const;
export type MailOAuthProviderKey = (typeof mailOAuthProviderKeys)[number];

/** Display name of a provider in a user text. A name never gets a case ending. */
export const mailOAuthProviderNames: Readonly<Record<MailOAuthProviderKey, string>> = {
  microsoft: "Microsoft",
  google: "Google",
};

/** Why an OAuth login was refused (ADR 0031 point 6). A password mailbox has no reason. */
export const authErrorReasons = [
  "oauth_expired",
  "oauth_revoked",
  "admin_consent_required",
  "protocol_disabled",
] as const;
export type AuthErrorReason = (typeof authErrorReasons)[number];

/**
 * Where an owner withdraws the app's access after a Remove. `google`: the revoke call may have done it already.
 * `microsoft_work`: My Apps of the tenant. `microsoft_personal`: the consent page of a personal account.
 */
export const removeAccessPages = ["google", "microsoft_work", "microsoft_personal"] as const;
export type RemoveAccessPage = (typeof removeAccessPages)[number];

export const mailOAuthProviderParamsSchema = z.object({ provider: z.enum(mailOAuthProviderKeys) });

/** `mailboxId` is set for a Reconnect of an OAuth mailbox; left out it starts a new connect. */
export const mailOAuthStartBodySchema = z.object({ mailboxId: z.uuid().optional() });
export type MailOAuthStartBody = z.infer<typeof mailOAuthStartBodySchema>;

/** The provider sign-in URL. It holds the one-time `state`: never log it. */
export const mailOAuthStartResultSchema = z.object({ url: z.string() });
export type MailOAuthStartResult = z.infer<typeof mailOAuthStartResultSchema>;

export const mailOAuthOptionsSchema = z.object({
  providers: z.array(
    z.object({
      provider: z.enum(mailOAuthProviderKeys),
      /** A new connect: the provider is configured and its flag is on for the organization. */
      connect: z.boolean(),
      /** A Reconnect: the provider is configured. */
      reconnect: z.boolean(),
    })
  ),
});
export type MailOAuthOptions = z.infer<typeof mailOAuthOptionsSchema>;

/**
 * The value of `?oauth=` on `/mailboxes` after the callback redirect (D11). The panel maps each code to a text.
 * The server type `OAuthResultCode` (`mail/oauth/apply.ts`) must hold the same codes.
 */
export const mailOAuthResultCodes = [
  "connected",
  "reconnected",
  "oauth_cancelled",
  "oauth_state_invalid",
  "oauth_state_expired",
  "oauth_code_invalid",
  "oauth_scope_missing",
  "oauth_wrong_account",
  "mailbox_exists",
  "mailbox_limit",
  "admin_consent_required",
  "protocol_disabled",
  "feature_off",
  "not_configured",
  "oauth_failed",
] as const;
export type MailOAuthResultCode = (typeof mailOAuthResultCodes)[number];
