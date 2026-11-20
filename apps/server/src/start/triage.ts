import { gateEvidenceOf, isOwnMailOf, senderProfileReader, sendScope, settingsDeps, uidplusOf } from "../composition";
import { cardEditHooks } from "../modules/channels";
import { delegationHooks } from "../modules/delegation";
import { createLoopJobs } from "../modules/loops";
import { openImapProvider } from "../modules/mail";
import {
  createReplyJobs,
  createStylePreview,
  replySampleScope,
  type ReplySampleScope,
  type StylePreview,
} from "../modules/replies";
import { createLlmPause, createTriageJob, type LlmPause, type TriageScope } from "../modules/triage";
import { createHistoryJob, regateAll, type RegateDeps } from "../modules/trust";
import { llmRoleTable, mailTrustedAuthservIds, testMailRule, type Config } from "../platform/config";
import { errorFields } from "../platform/errors";
import { createLlmClient, llmEndpointFields, llmProviders, type LlmProviderId } from "../platform/llm";
import type { Log } from "../platform/log";

import type { StartContext } from "./context";
import type { OperatorStart } from "./operator";

export interface TriageStart {
  // The global evidence of this classifier: the gate files are read once here and passed to the settings deps.
  gate: ReturnType<typeof gateEvidenceOf>;
  // The hooks of the delegation and the card edits, the send scope and the UIDPLUS read: the committer, the expiry job and the reply drafter share them.
  hooks: ReturnType<typeof delegationHooks>;
  uidplus: ReturnType<typeof uidplusOf>;
  scopeOfSends: ReturnType<typeof sendScope>;
  classifierRow: ReturnType<typeof llmRoleTable>["roles"]["classifier"];
  // One pause object for the triage worker and the `not_triaged` notice job: they run in this process.
  degraded: { pause: LlmPause; scope: TriageScope } | undefined;
  // The style preview of the reply drafts: it needs the model client, so it exists only while the LLM scope is on.
  stylePreview: StylePreview | null;
  replySamples: ReplySampleScope | null;
}

// null: the worker is off.
function triageScope(log: Log, config: Config, provider: LlmProviderId): TriageScope | null {
  if (config.TRIAGE_LLM_SCOPE === "off") {
    log.info("triage_scope", { scope: "off" });
    return null;
  }
  if (config.TRIAGE_LLM_SCOPE === "synthetic") {
    log.info("triage_scope", { scope: "synthetic" });
    return { kind: "synthetic", testMail: testMailRule(config) };
  }
  log.warn("triage_scope", { scope: "all", provider });
  return { kind: "all" };
}

// The start re-gate, then the jobs that need the model client (only while the LLM scope is on).
export async function startTriage(ctx: StartContext, { operator }: OperatorStart): Promise<TriageStart> {
  const { config, db, log, scheduler, runs, secrets, mailOAuth } = ctx;
  let degraded: TriageStart["degraded"];
  let stylePreview: StylePreview | null = null;
  let replySamples: ReplySampleScope | null = null;
  const scopeOfSends = sendScope(config);
  const hooks = delegationHooks({ db });
  const uidplus = uidplusOf(db);
  const llmTable = llmRoleTable(config);
  const classifierRow = llmTable.roles.classifier;
  const gate = gateEvidenceOf(config, { table: llmTable });
  const scope = triageScope(log, config, classifierRow.provider);
  // The re-gate of `auto` (ADR 0028, rule 16 of the product rules): it runs once here, before the triage worker and the committer exist, so a `ready` move that
  // was planned under the old model meets the new policy. A failure of the whole run (the database) stops the start: the container restarts.
  // A mailbox that fails alone is logged and left to the job below. It always runs: the global evidence belongs to the model, not to a flag.
  const regateDeps: Omit<RegateDeps, "run"> = {
    db,
    gate,
    testMail: testMailRule(config),
    settingsOf: (trx) => settingsDeps(trx, () => new Date(), gate),
    ...(config.WEB_BASE_URL === undefined ? {} : { webBaseUrl: config.WEB_BASE_URL }),
  };
  try {
    await regateAll({ ...regateDeps, run: "start" }, new Date());
  } catch (error) {
    log.error("trust_regate_failed", { ...errorFields(error) });
    await db.destroy().catch(() => undefined);
    process.exit(1);
  }
  const regateJob = () => regateAll({ ...regateDeps, run: "job" }, new Date()).then(() => undefined);
  scheduler.add("trust.regate", "20 */5 * * * *", runs.track("trust.regate", regateJob));
  log.info("job_scheduled", { job: "trust.regate" });
  if (scope !== null) {
    log.info("llm_settings", { ...llmEndpointFields(llmTable, "classifier") });
    const llm = createLlmClient({ table: llmTable });
    const pause = createLlmPause();
    degraded = { pause, scope };
    const triage = createTriageJob({
      db,
      llm,
      pause,
      scope,
      testMail: testMailRule(config),
      batchSize: 5,
      dailyCap: config.LLM_DAILY_CAP,
      runningKey: gate.runningKey,
      trustedAuthservIds: mailTrustedAuthservIds(config),
      now: () => new Date(),
      readProfile: senderProfileReader({ db, credentialsKey: config.CREDENTIALS_KEY, now: () => new Date() }),
      onCapReached: (tenant, mailboxId, dayStart) =>
        operator.capReached(tenant, mailboxId, dayStart, config.LLM_DAILY_CAP),
    });
    // prettier-ignore
    scheduler.add("triage.worker", "*/15 * * * * *", runs.track("triage.worker", () => triage.run()));
    // The history check of the trust ladder: it reads mail, classifies a sample with the model client and the pause of the triage worker, and writes the checks.
    const history = createHistoryJob({
      db,
      secrets,
      openProvider: openImapProvider,
      oauthTokens: mailOAuth.tokens,
      isOwnActionId: isOwnMailOf(db),
      runningKey: gate.runningKey,
      gateIndex: gate.index,
      llm,
      pause,
      scope,
      testMail: testMailRule(config),
      trustedAuthservIds: mailTrustedAuthservIds(config),
      ...(config.WEB_BASE_URL === undefined ? {} : { webBaseUrl: config.WEB_BASE_URL }),
      now: () => new Date(),
    });
    // prettier-ignore
    scheduler.add("trust.history", "*/15 * * * * *", runs.track("trust.history", () => history.run()));
    log.info("job_scheduled", { job: "trust.history" });
    // The Sent analysis of the open loops uses the same model client and the same scope: with the scope off, no mail goes out.
    const loopJobs = createLoopJobs({
      db,
      llm,
      dailyCap: config.LLM_DAILY_CAP,
      credentialsKey: config.CREDENTIALS_KEY,
      scope,
      now: () => new Date(),
    });
    // prettier-ignore
    scheduler.add("loops.analyze", "35 * * * * *", runs.track("loops.analyze", () => loopJobs.analyze.run().then(() => undefined)));
    log.info("job_scheduled", { job: "loops.analyze" });
    // The reply drafter: it scans triaged `needs_reply` mail, claims the requests and writes a draft that waits for one tap. It never
    // sends. It has its own LLM pause, the same model client and the same scope: with the scope off, no mail goes out.
    const replyJobs = createReplyJobs({
      db,
      llm,
      dailyCap: config.LLM_DAILY_CAP,
      scope,
      hooks,
      approvalHooks: cardEditHooks({ sendScope: scopeOfSends }),
      uidplus,
      now: () => new Date(),
      onCapReached: (tenant, mailboxId, dayStart) =>
        operator.capReached(tenant, mailboxId, dayStart, config.LLM_DAILY_CAP),
    });
    stylePreview = createStylePreview({
      db,
      llm,
      realMail: llmProviders[llmTable.roles.drafter.provider].realMail,
      dailyCap: config.LLM_DAILY_CAP,
      now: () => new Date(),
    });
    // The sample drafts are queued for the drafter job above, so they follow its scope: with `synthetic` only test mail is a candidate.
    replySamples = replySampleScope(scope, () => new Date());
    // prettier-ignore
    scheduler.add("replies.drafter", "*/15 * * * * *", runs.track("replies.drafter", () => replyJobs.drafter.run().then(() => undefined)));
    log.info("job_scheduled", { job: "replies.drafter" });
  }
  return { gate, hooks, uidplus, scopeOfSends, classifierRow, degraded, stylePreview, replySamples };
}
