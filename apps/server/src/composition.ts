import type { SendLimits } from "@ea/core";
import type { Transaction } from "kysely";

import {
  expireReady,
  expireUnseenApprovals,
  type ActionsScope,
  type CommitterDeps,
  type SendScope,
} from "./modules/actions";
import { cancelPendingApprovalRequestsOfClosedSends, SENDER_STALE_MS } from "./modules/channels";
import type { SettingsDeps } from "./modules/config";
import { delegationHooks } from "./modules/delegation";
import { composeMessage, mailboxHasUidplus, openImapProvider, openSmtpSender } from "./modules/mail";
import { sendTestAddresses, testMailRule, type Config } from "./platform/config";
import type { SecretBox } from "./platform/crypto";
import type { DB, Db, TenantContext } from "./platform/db";
import { createLog } from "./platform/log";

// The parts that `main.ts` and `scripts/job-run.ts` build the same way.
const log = createLog("main");

// The one value goes to the committer and to the Telegram runtime.
export function actionsScope(config: Config): ActionsScope {
  if (config.ACTIONS_SCOPE === "off") {
    log.info("actions committer: mailbox changes are off (ACTIONS_SCOPE=off)");
    return { kind: "off" };
  }
  if (config.ACTIONS_SCOPE === "synthetic") {
    log.info("actions committer applies mailbox changes to test mail only");
    return { kind: "synthetic", testMail: testMailRule(config) };
  }
  log.warn(
    "actions committer applies mailbox changes to the real mail of every active mailbox, by its mode (ACTIONS_SCOPE=all)"
  );
  return { kind: "all" };
}

// D16, D31. The config check guarantees the list for `self`.
export function sendScope(config: Config): SendScope {
  if (config.SEND_SCOPE === "off") {
    log.info("sends: off (SEND_SCOPE=off)");
    return { kind: "off" };
  }
  if (config.SEND_SCOPE === "self") {
    log.warn("sends go only to the SEND_TEST_ADDRESSES list (SEND_SCOPE=self)");
    return { kind: "self", addresses: sendTestAddresses(config) };
  }
  log.warn("sends go to real recipients after an owner's tap (SEND_SCOPE=all)");
  return { kind: "all" };
}

export function uidplusOf(db: Db): (ctx: TenantContext, mailboxId: string) => Promise<boolean> {
  return (ctx, mailboxId) => mailboxHasUidplus(db, ctx, mailboxId);
}

export function committerDeps(input: {
  db: Db;
  secrets: SecretBox;
  scope: ActionsScope;
  sendScope: SendScope;
  sendLimits: SendLimits;
  onSendLimited?: CommitterDeps["onSendLimited"];
}): CommitterDeps {
  return {
    db: input.db,
    secrets: input.secrets,
    openProvider: openImapProvider,
    openSender: openSmtpSender,
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
