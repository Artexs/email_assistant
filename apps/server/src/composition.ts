import { expireReady, type ActionsScope, type CommitterDeps, type SendScope } from "./modules/actions";
import type { SettingsDeps } from "./modules/config";
import { delegationHooks } from "./modules/delegation";
import { composeMessage, mailboxHasUidplus, openImapProvider, openSmtpSender } from "./modules/mail";
import { sendTestAddresses, type Config } from "./platform/config";
import type { SecretBox } from "./platform/crypto";
import type { Db, TenantContext } from "./platform/db";
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
    log.info("actions committer applies mailbox changes to synthetic mail only");
    return { kind: "synthetic" };
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
