import { isOwnMailOf } from "../composition";
import { sentOriginOf } from "../modules/actions";
import { countSyncTargets, createMailSyncJob, openImapProvider } from "../modules/mail";
import { listOrganizations } from "../modules/tenancy";
import { mailSyncCron } from "../platform/config";
import { checkDb } from "../platform/db";
import { errorFields } from "../platform/errors";
import { createHeartbeat } from "../platform/heartbeat";

import type { StartContext } from "./context";

export interface MailStart {
  heartbeat: ReturnType<typeof createHeartbeat>;
}

// The mail sync and the heartbeat, then the start line for a scope of `all`.
export async function startMail(ctx: StartContext): Promise<MailStart> {
  const { config, db, log, scheduler, secrets, mailOAuth } = ctx;
  const mailSync = createMailSyncJob({
    db,
    secrets,
    openProvider: openImapProvider,
    oauthTokens: mailOAuth.tokens,
    isOwnActionId: isOwnMailOf(db),
    sentOriginOf: (tenant, mailboxId, actionId) => sentOriginOf(db, tenant, mailboxId, actionId),
    now: () => new Date(),
  });
  const heartbeat = createHeartbeat({ url: config.HEARTBEAT_URL, checkDb: () => checkDb(db) });
  if (config.HEARTBEAT_URL === undefined) log.warn("heartbeat_off");
  if (config.WEB_BASE_URL !== undefined && config.OPERATOR_CONTACT === undefined) {
    log.warn("operator_contact_empty");
  }

  scheduler.add("mail.sync", mailSyncCron(config), mailSync.run);
  log.info("mail_sync_interval", { minutes: Number(config.MAIL_SYNC_EVERY_MIN) });
  scheduler.add("platform.heartbeat", "*/5 * * * *", heartbeat.tick);

  // When a scope is `all`, one start line says whom the jobs act on (counts only, no ids). A DB error does not stop the start.
  if (config.TRIAGE_LLM_SCOPE === "all" || config.ACTIONS_SCOPE === "all" || config.SEND_SCOPE === "all") {
    try {
      const targets = await countSyncTargets(db);
      const suspended = (await listOrganizations(db)).filter((org) => org.plan === "suspended").length;
      log.warn("scope_targets", {
        mailbox_count: targets.mailboxes,
        org_count: targets.organizations,
        suspended_count: suspended,
      });
    } catch (error) {
      log.warn("scope_targets_failed", { ...errorFields(error) });
    }
  }
  return { heartbeat };
}
