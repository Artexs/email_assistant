import type { SendLimits } from "@ea/core";
import type { Transaction } from "kysely";

import {
  expireReady,
  expireUnseenApprovals,
  type ActionsScope,
  type CommitterDeps,
  type SendScope,
} from "./modules/actions";
import {
  cancelPendingApprovalRequestsOfClosedSends,
  cancelPendingOutboxOfOrg,
  SENDER_STALE_MS,
} from "./modules/channels";
import type { SettingsDeps } from "./modules/config";
import { delegationHooks } from "./modules/delegation";
import {
  composeMessage,
  createMailOAuthClients,
  createOAuthTokens,
  mailboxHasUidplus,
  mailOAuthProviders,
  openGraphSender,
  openImapProvider,
  openSmtpSender,
  type MailOAuthClients,
  type OAuthTokens,
} from "./modules/mail";
import type { SetOrgPlanHooks } from "./modules/tenancy";
import { sendTestAddresses, testMailRule, type Config } from "./platform/config";
import type { SecretBox } from "./platform/crypto";
import type { DB, Db, TenantContext } from "./platform/db";
import { createLog } from "./platform/log";

// The parts that `main.ts` and `scripts/job-run.ts` build the same way.
const log = createLog("main");

// The one value goes to the committer and to the Telegram runtime.
export function actionsScope(config: Config): ActionsScope {
  if (config.ACTIONS_SCOPE === "off") {
    log.info("actions_scope", { config_key: "ACTIONS_SCOPE", scope: "off" });
    return { kind: "off" };
  }
  if (config.ACTIONS_SCOPE === "synthetic") {
    log.info("actions_scope", { config_key: "ACTIONS_SCOPE", scope: "synthetic" });
    return { kind: "synthetic", testMail: testMailRule(config) };
  }
  log.warn("actions_scope", { config_key: "ACTIONS_SCOPE", scope: "all" });
  return { kind: "all" };
}

// D16, D31. The config check guarantees the list for `self`.
export function sendScope(config: Config): SendScope {
  if (config.SEND_SCOPE === "off") {
    log.info("send_scope", { config_key: "SEND_SCOPE", scope: "off" });
    return { kind: "off" };
  }
  if (config.SEND_SCOPE === "self") {
    log.warn("send_scope", { config_key: "SEND_SCOPE", scope: "self" });
    return { kind: "self", addresses: sendTestAddresses(config) };
  }
  log.warn("send_scope", { config_key: "SEND_SCOPE", scope: "all" });
  return { kind: "all" };
}

export function uidplusOf(db: Db): (ctx: TenantContext, mailboxId: string) => Promise<boolean> {
  return (ctx, mailboxId) => mailboxHasUidplus(db, ctx, mailboxId);
}

// The access-token cache and the OAuth clients of one process. The sync job, the committer and the web Reconnect share the one
// cache, so a Reconnect drops the token the jobs hold. `mail_oauth_not_configured` logs once per process and provider.
export function mailOAuthRuntime(
  config: Config,
  db: Db,
  secrets: SecretBox
): { clients: MailOAuthClients; tokens: OAuthTokens } {
  const clients = createMailOAuthClients(config);
  return { clients, tokens: createOAuthTokens({ pool: db, secrets, clients, now: () => new Date() }) };
}

export function committerDeps(input: {
  db: Db;
  secrets: SecretBox;
  oauthTokens: OAuthTokens;
  scope: ActionsScope;
  sendScope: SendScope;
  sendLimits: SendLimits;
  onSendLimited?: CommitterDeps["onSendLimited"];
  /** The Graph origin. Absent: the provider registry's. A test passes the fake Graph server. */
  graphBaseUrl?: string;
}): CommitterDeps {
  // Every Microsoft mailbox sends through Graph: the registry's origin is bound here, so the opener of the mailbox names no URL.
  const baseUrl = input.graphBaseUrl ?? mailOAuthProviders.microsoft.graphBaseUrl;
  if (baseUrl === null) throw new Error("the Microsoft provider has no Graph URL");
  return {
    db: input.db,
    secrets: input.secrets,
    openProvider: openImapProvider,
    openSender: openSmtpSender,
    openGraphSender: (opts) => openGraphSender({ ...opts, baseUrl }),
    oauthTokens: input.oauthTokens,
    compose: composeMessage,
    hooks: delegationHooks({ db: input.db }),
    scope: input.scope,
    sendScope: input.sendScope,
    sendLimits: input.sendLimits,
    ...(input.onSendLimited === undefined ? {} : { onSendLimited: input.onSendLimited }),
    now: () => new Date(),
  };
}

// The one builder of the settings setters' deps: the CLI and the web call it, so both close the gate the same way.
export function settingsDeps(db: Db, now: () => Date): SettingsDeps {
  const hooks = delegationHooks({ db });
  return {
    db,
    now,
    expireReady: async (trx, trxCtx, filter, opts) =>
      expireReady(trx, trxCtx, filter, {
        ...opts,
        sendClose: { hooks, uidplus: await mailboxHasUidplus(trx, trxCtx, filter.mailboxId) },
      }),
  };
}

// F079: the resume hook of `setOrgPlan`. Sends whose approval request no owner saw before the pause end as `not_seen`
// (the owner gets the result notice); their queued requests are cancelled. Returns the number of closed sends.
export function resumeHook(
  db: Db
): (trx: Transaction<DB>, ctx: TenantContext, input: { now: Date; actor: string }) => Promise<number> {
  const hooks = delegationHooks({ db });
  return async (trx, ctx, input) => {
    const expired = await expireUnseenApprovals(trx, ctx, {
      resumedAt: input.now,
      actor: input.actor,
      hooks,
      uidplus: mailboxHasUidplus,
    });
    await cancelPendingApprovalRequestsOfClosedSends(trx, ctx, {
      staleBefore: new Date(input.now.getTime() - SENDER_STALE_MS),
    });
    return expired;
  };
}

// D20: the hooks of `setOrgPlan` for every caller (the `org:plan` CLI and the operator console), so both suspend and
// resume the same way: suspend cancels the queued messages, resume closes the sends with an unseen approval request.
export function orgPlanHooks(db: Db): SetOrgPlanHooks {
  return { onSuspended: cancelPendingOutboxOfOrg, onResumed: resumeHook(db) };
}
