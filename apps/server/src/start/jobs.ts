import { actionsScope, committerDeps, settingsDeps } from "../composition";
import { createCommitterJob, createExpiryJob } from "../modules/actions";
import { cardEditHooks, createImapReportMailbox, createReportMailSender } from "../modules/channels";
import { createContactsRefreshJob } from "../modules/contacts";
import { createLoopChaserJob, createLoopMatchJob } from "../modules/loops";
import { openImapProvider } from "../modules/mail";
import { createReplySweep } from "../modules/replies";
import { createReturnedJob } from "../modules/triage";
import { createTripwireJob } from "../modules/trust";
import { sendLimits, testMailRule } from "../platform/config";
import { createRetentionJob } from "../retention";

import type { StartContext } from "./context";
import type { OperatorStart } from "./operator";
import type { TriageStart } from "./triage";

export interface JobsStart {
  scopeOfActions: ReturnType<typeof actionsScope>;
}

// The jobs that run with the LLM scope off too, and the report mail sender.
export function startJobs(ctx: StartContext, { operator }: OperatorStart, triage: TriageStart): JobsStart {
  const { config, db, log, scheduler, runs, secrets, mailOAuth } = ctx;
  const { gate, hooks, uidplus, scopeOfSends } = triage;
  // The tripwire of the trust ladder: a category whose moves the user corrects loses its `auto`. It reads corrections and checks, not
  // mail, and calls no model, so it runs with the scope off too.
  const tripwire = createTripwireJob({
    db,
    settings: settingsDeps(db, () => new Date(), gate),
    testMail: testMailRule(config),
    ...(config.WEB_BASE_URL === undefined ? {} : { webBaseUrl: config.WEB_BASE_URL }),
    now: () => new Date(),
  });
  // prettier-ignore
  scheduler.add("trust.tripwire", "0 * * * * *", runs.track("trust.tripwire", () => tripwire.run()));
  log.info("job_scheduled", { job: "trust.tripwire" });
  // The close rules need no model: they run with the scope off too, so a reply still closes its loop.
  const loopMatch = createLoopMatchJob({ db, now: () => new Date() });
  // prettier-ignore
  scheduler.add("loops.match", "50 */2 * * * *", runs.track("loops.match", () => loopMatch.run().then(() => undefined)));
  log.info("job_scheduled", { job: "loops.match" });
  // The sender profiles: one recompute of each active mailbox with the flag `sender_context` on, hourly at minute 7. It reads the
  // database only and calls no model, so it runs with the scope off too.
  const contactsRefresh = createContactsRefreshJob({
    db,
    credentialsKey: config.CREDENTIALS_KEY,
    testMail: testMailRule(config),
    now: () => new Date(),
  });
  // prettier-ignore
  scheduler.add("contacts.refresh", "0 7 * * * *", runs.track("contacts.refresh", () => contactsRefresh.run().then(() => undefined)));
  log.info("job_scheduled", { job: "contacts.refresh" });
  // The sweep of the reply drafts: it closes an open reply whose mail was answered, left its folder or got a newer mail in its thread. It
  // reads the database only and calls no model and no mailbox, so it runs with the scope off too.
  const replySweep = createReplySweep({
    db,
    hooks,
    approvalHooks: cardEditHooks({ sendScope: scopeOfSends }),
    uidplus,
    now: () => new Date(),
  });
  // prettier-ignore
  scheduler.add("replies.sweep", "40 */5 * * * *", runs.track("replies.sweep", () => replySweep.run().then(() => undefined)));
  log.info("job_scheduled", { job: "replies.sweep" });

  const scopeOfActions = actionsScope(config);
  const limitsOfSends = sendLimits(config);
  log.info("send_limits", {
    mailbox_hour: limitsOfSends.mailboxHour,
    mailbox_day: limitsOfSends.mailboxDay,
    recipient_day: limitsOfSends.recipientDay,
  });
  // Always built: `save_summary` rows are applied under every scope.
  const committer = createCommitterJob(
    committerDeps({
      db,
      secrets,
      oauthTokens: mailOAuth.tokens,
      scope: scopeOfActions,
      sendScope: scopeOfSends,
      sendLimits: limitsOfSends,
      onSendLimited: (tenant, hit) => operator.sendLimitReached(tenant, hit),
    })
  );
  // prettier-ignore
  scheduler.add("actions.committer", "*/15 * * * * *", runs.track("actions.committer", () => committer.run()));
  const expiry = createExpiryJob({ db, now: () => new Date(), hooks, uidplus });
  // prettier-ignore
  scheduler.add("actions.expiry", "0 7 * * * *", runs.track("actions.expiry", () => expiry.run()));
  log.info("job_scheduled", { job: "actions.expiry" });
  // The one chaser (delegation reminders, loop follow-ups, stale and expired loops). It replaces `delegation.chaser`.
  const chaser = createLoopChaserJob({ db, now: () => new Date() });
  // prettier-ignore
  scheduler.add("loops.chaser", "20 */15 * * * *", runs.track("loops.chaser", () => chaser.run().then(() => undefined)));
  log.info("job_scheduled", { job: "loops.chaser" });
  const returned = createReturnedJob({ db, now: () => new Date() });
  // prettier-ignore
  scheduler.add("triage.returned", "*/15 * * * * *", runs.track("triage.returned", () => returned.run()));

  // The daily retention run.
  const retention = createRetentionJob({ db, now: () => new Date() });
  // prettier-ignore
  scheduler.add("platform.retention", "0 40 2 * * *", runs.track("platform.retention", () => retention.run()));
  log.info("job_scheduled", { job: "platform.retention" });

  // The report mail sender (ADR 0022): it APPENDs the `mail` rows into the user's own INBOX. It runs with or without the
  // Telegram runtime, because a mail-only member needs no bot. It never sends: no SMTP sender is built for it. Rows exist only when the flag
  // `report_mail` is on, and the sender checks the flag again before each APPEND.
  const reportMail = createReportMailSender({
    db,
    mailbox: createImapReportMailbox({
      db,
      secrets,
      openProvider: openImapProvider,
      oauthTokens: mailOAuth.tokens,
      now: () => new Date(),
    }),
    now: () => new Date(),
    ...(config.WEB_BASE_URL === undefined ? {} : { webBaseUrl: config.WEB_BASE_URL }),
  });
  // prettier-ignore
  scheduler.add("channels.report_mail", "*/15 * * * * *", runs.track("channels.report_mail", () => reportMail.run()));
  log.info("job_scheduled", { job: "channels.report_mail" });
  return { scopeOfActions };
}
