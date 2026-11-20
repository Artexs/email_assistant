import { randomUUID } from "node:crypto";

import { EXIT } from "@ea/core";

import {
  actionsScope,
  committerDeps,
  gateEvidenceOf,
  loopsLlmScope,
  mailOAuthRuntime,
  sendScope,
  trustEvidenceOf,
  uidplusOf,
} from "../composition";
import { type CommitterDeps, createCommitterJob, createExpiryJob } from "../modules/actions";
import { cardEditHooks, createTelegramRuntime } from "../modules/channels";
import { createContactsRefreshJob } from "../modules/contacts";
import { delegationHooks } from "../modules/delegation";
import { createLoopChaserJob, createLoopJobs, createLoopMatchJob } from "../modules/loops";
import { configureMailHosts } from "../modules/mail";
import { createReplyJobs, createReplySweep } from "../modules/replies";
import { type CliSpec, exitCodeOf, runCli } from "../platform/cli";
import { type Config, llmRoleTable, loadConfig, mailAllowLocal, sendLimits, testMailRule } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb, type Db } from "../platform/db";
import { describeError } from "../platform/errors";
import { createLlmClient } from "../platform/llm";
import { setLogRelease, withLogContext } from "../platform/log";
import { createRetentionJob } from "../retention";

import { cliDescriptions, parseJobRunArgs } from "./job-run-args";

/** The deps of the committer job: the same secret box, token store, scopes and send limits as the server. */
export function jobRunCommitterDeps(config: Config, db: Db): CommitterDeps {
  const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
  return committerDeps({
    db,
    secrets,
    oauthTokens: mailOAuthRuntime(config, db, secrets).tokens,
    scope: actionsScope(config),
    sendScope: sendScope(config),
    sendLimits: sendLimits(config),
  });
}

// Runs one job once with the deps of `main.ts`. For dev and ops checks; it logs ids and counts only, like the server.
const main: CliSpec["main"] = async (argv, out) => {
  const args = parseJobRunArgs(argv);
  const config = loadConfig();
  setLogRelease(config.EA_RELEASE);
  configureMailHosts({ allowLocal: mailAllowLocal(config) });
  if (args.name === "channels.notifier" && config.TELEGRAM_BOT_TOKEN === undefined) {
    out.fail("TELEGRAM_BOT_TOKEN is empty");
    return 1;
  }
  const needsModel = args.name === "loops.analyze" || args.name === "replies.drafter";
  const llmScope = needsModel ? loopsLlmScope(config) : null;
  if (needsModel && llmScope === null) {
    out.fail(`TRIAGE_LLM_SCOPE is off: ${args.name} needs the model`);
    return 1;
  }
  return await withLogContext({ job: args.name, run_id: randomUUID() }, async () => {
    const db = createDb(config.DATABASE_URL);
    try {
      await assertAppRole(db);
      const now = () => new Date();
      const hooks = delegationHooks({ db });
      const uidplus = uidplusOf(db);
      if (args.name === "actions.expiry") {
        await createExpiryJob({ db, now, hooks, uidplus }).run();
      } else if (args.name === "loops.chaser" || args.name === "delegation.chaser") {
        const run = await createLoopChaserJob({ db, now }).run({ force: args.force });
        // Counts only: no id, no address, no text.
        out.print(
          `${args.name}: ran once (mailboxes ${run.mailboxes}, delegations due ${run.due}, overdue ${run.overdue}, reminders ${run.reminders}, follow-ups ${run.followUps}, stale ${run.stale}, expired ${run.expired}, mailbox errors ${run.mailboxErrors})`
        );
        // After the run: a run that throws must not leave this line behind.
        if (args.name === "delegation.chaser")
          out.print("delegation.chaser is an alias of loops.chaser: the one chaser ran");
        return run.mailboxErrors > 0 ? 1 : 0;
      } else if (args.name === "actions.committer") {
        out.fail("do not run the committer here while the server runs on the same database: the log lines double");
        await createCommitterJob(jobRunCommitterDeps(config, db)).run();
      } else if (args.name === "platform.retention") {
        await createRetentionJob({ db, now }).run();
      } else if (args.name === "loops.analyze") {
        if (llmScope === null) throw new Error("the model scope is off");
        const llm = createLlmClient({ table: llmRoleTable(config) });
        const jobs = createLoopJobs({
          db,
          llm,
          dailyCap: config.LLM_DAILY_CAP,
          credentialsKey: config.CREDENTIALS_KEY,
          scope: llmScope,
          now,
        });
        const run = await jobs.analyze.run();
        // Counts only: no id, no address, no text.
        out.print(
          `${args.name}: ran once (mailboxes ${run.mailboxes}, analysed ${run.analysed}, skipped ${run.skipped}, opened ${run.opened}, restarted ${run.restarted}, promises closed ${run.promisesClosed}, waiting ${run.waiting}, failed ${run.failed}, mailbox errors ${run.mailboxErrors}${run.stopped ? ", stopped by the model" : ""})`
        );
        return 0;
      } else if (args.name === "replies.drafter") {
        if (llmScope === null) throw new Error("the model scope is off");
        const llm = createLlmClient({ table: llmRoleTable(config) });
        const jobs = createReplyJobs({
          db,
          llm,
          dailyCap: config.LLM_DAILY_CAP,
          scope: llmScope,
          hooks,
          approvalHooks: cardEditHooks({ sendScope: sendScope(config) }),
          uidplus,
          now,
        });
        const run = await jobs.drafter.run();
        // Counts only: no id, no address, no text.
        const { outcomes } = run;
        out.print(
          `${args.name}: ran once (mailboxes ${run.mailboxes}, requested ${run.requested}, claimed ${run.claimed}, timed out ${run.timedOut}, done ${outcomes.done}, no draft ${outcomes.no_draft}, failed ${outcomes.failed}, cancelled ${outcomes.cancelled}, superseded ${outcomes.superseded}, waiting ${outcomes.waiting}, retry ${outcomes.retry}, lost ${outcomes.lost}, mailbox errors ${run.mailboxErrors})`
        );
        return run.mailboxErrors > 0 ? 1 : 0;
      } else if (args.name === "replies.sweep") {
        const run = await createReplySweep({
          db,
          hooks,
          approvalHooks: cardEditHooks({ sendScope: sendScope(config) }),
          uidplus,
          now,
        }).run();
        // Counts only: no id, no address, no text.
        const { closed } = run;
        out.print(
          `${args.name}: ran once (mailboxes ${run.mailboxes}, checked ${run.checked}, answered ${closed.answered}, newer mail ${closed.newer_mail}, original moved ${closed.original_moved}, suspicious ${closed.suspicious}, policy changed ${closed.policy_changed}, skipped ${run.skipped}, mailbox errors ${run.mailboxErrors})`
        );
        return run.mailboxErrors > 0 ? 1 : 0;
      } else if (args.name === "loops.match") {
        const run = await createLoopMatchJob({ db, now }).run();
        // Counts only: no id, no address, no text.
        out.print(
          `${args.name}: ran once (mailboxes ${run.mailboxes}, checked ${run.checked}, replied ${run.replied}, replied by subject ${run.repliedSubject}, dropped ${run.dropped}, automatic ${run.autoMarked}, mailbox errors ${run.mailboxErrors})`
        );
        return 0;
      } else if (args.name === "contacts.refresh") {
        const run = await createContactsRefreshJob({
          db,
          credentialsKey: config.CREDENTIALS_KEY,
          testMail: testMailRule(config),
          now,
        }).run();
        // Counts only: no id, no address, no hash.
        out.print(
          `${args.name}: ran once (mailboxes ${run.mailboxes}, skipped ${run.skipped}, written ${run.written}, unchanged ${run.unchanged}, zeroed ${run.zeroed}, mailbox errors ${run.mailboxErrors})`
        );
        return run.mailboxErrors > 0 ? 1 : 0;
      } else {
        const row = llmRoleTable(config).roles.classifier;
        const runtime = createTelegramRuntime({
          db,
          token: config.TELEGRAM_BOT_TOKEN ?? "",
          apiRoot: config.TELEGRAM_API_ROOT,
          now,
          startedAt: now(),
          llmDailyCap: config.LLM_DAILY_CAP,
          triageScope: config.TRIAGE_LLM_SCOPE,
          actionsScope: actionsScope(config),
          llm: { provider: row.provider, classifierModel: row.model },
          hooks,
          uidplus,
          sendScope: sendScope(config),
          testMail: testMailRule(config),
          trustEvidence: trustEvidenceOf(db, now, gateEvidenceOf(config, { quiet: true }), testMailRule(config)),
          operatorContact: null,
          syncEveryMin: Number(config.MAIL_SYNC_EVERY_MIN),
        });
        await runtime.notify();
      }
      out.print(`${args.name}: ran once`);
      return 0;
    } catch (error) {
      const code = exitCodeOf(error);
      out.fail(
        code === EXIT.unreachable
          ? `unreachable: ${args.name}: ${describeError(error)}`
          : `${args.name} failed: ${describeError(error)}`
      );
      return code;
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });
};

if (import.meta.main) {
  await runCli({ prefix: "job-run", descriptions: cliDescriptions, main });
}
