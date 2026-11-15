import type { MailOAuthOptions } from "@ea/core";
import { mailOAuthProviderKeys } from "@ea/core";

import type { SecretBox } from "../../../platform/crypto";
import type { Db, TenantContext } from "../../../platform/db";
import { isFeatureOn } from "../../tenancy";
import { getMailbox } from "../repo";

import type { MailOAuthClients } from "./client";
import type { MailOAuthProvider } from "./providers";
import { createOAuthState } from "./state";

// The start of a provider sign-in and the options the panel shows (F117 stage 07, D8, D9). The routes call these two functions.

export interface MailOAuthStartDeps {
  db: Db;
  secrets: SecretBox;
  /** A provider without keys has no client (`createMailOAuthClients`). */
  clients: MailOAuthClients;
}

const flagOf = (provider: MailOAuthProvider) => `mail_oauth_${provider}` as const;

/** `connect`: configured and the flag is on for the organization. `reconnect`: configured (the flag gates a new connect only). */
export async function mailOAuthOptions(deps: MailOAuthStartDeps, ctx: TenantContext): Promise<MailOAuthOptions> {
  const providers: MailOAuthOptions["providers"] = [];
  for (const provider of mailOAuthProviderKeys) {
    const configured = deps.clients[provider] !== undefined;
    providers.push({
      provider,
      connect: configured && (await isFeatureOn(deps.db, ctx, flagOf(provider))),
      reconnect: configured,
    });
  }
  return { providers };
}

export type StartResult =
  /** `url` holds the one-time `state`: never log it. */
  { kind: "started"; url: string } | { kind: "not_configured" } | { kind: "feature_off" } | { kind: "not_found" };

/**
 * Makes the state row and the provider URL. A new connect (`mailboxId` null) needs the flag; a Reconnect needs an OAuth mailbox of this
 * provider in the organization and works with the flag off (a mailbox must never be stranded). `userId` must be a member of `ctx.orgId`
 * (`createOAuthState` throws `OAuthStateRefusedError` otherwise).
 */
export async function startMailOAuth(
  deps: MailOAuthStartDeps,
  ctx: TenantContext,
  input: { provider: MailOAuthProvider; userId: string; mailboxId: string | null },
  now: Date
): Promise<StartResult> {
  const { provider, userId, mailboxId } = input;
  const client = deps.clients[provider];
  if (client === undefined) return { kind: "not_configured" };
  let loginHint: string | undefined;
  if (mailboxId === null) {
    if (!(await isFeatureOn(deps.db, ctx, flagOf(provider)))) return { kind: "feature_off" };
  } else {
    const mailbox = await getMailbox(deps.db, ctx, mailboxId);
    if (mailbox === undefined || mailbox.oauth_provider !== provider) return { kind: "not_found" };
    loginHint = mailbox.address;
  }
  const { state, codeChallenge } = await createOAuthState(
    deps.db,
    deps.secrets,
    ctx,
    { provider, userId, mailboxId },
    now
  );
  return {
    kind: "started",
    url: client.authorizeUrl({ state, codeChallenge, ...(loginHint === undefined ? {} : { loginHint }) }),
  };
}
