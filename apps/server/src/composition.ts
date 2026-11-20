import { resolve } from "node:path";

import { type GateEvidenceDeps, type GateView, normalizeAddress, type SendLimits } from "@ea/core";
import type { Transaction } from "kysely";

import {
  expireReady,
  expireUnseenApprovals,
  isOwnActionId,
  type ActionsScope,
  type CommitterDeps,
  type SendScope,
} from "./modules/actions";
import {
  cancelPendingApprovalRequestsOfClosedSends,
  cancelPendingOutboxOfOrg,
  cardEditHooks,
  clearLoopCards,
  isOwnReportMail,
  SENDER_STALE_MS,
} from "./modules/channels";
import type { SettingsChange, SettingsDeps } from "./modules/config";
import { readProfiles, senderFlags } from "./modules/contacts";
import { delegationHooks } from "./modules/delegation";
import { type AnalysisScope, loopHooks, onSentOff } from "./modules/loops";
import type { TestMailRule } from "./modules/mail";
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
  type SentSwitchHooks,
} from "./modules/mail";
import type { SetOrgPlanHooks } from "./modules/tenancy";
import { isFeatureOn } from "./modules/tenancy";
import {
  type ClassifierExtrasInput,
  loadGateEvidence,
  noGateEvidence,
  runningEvidenceKey,
  setCategoryAutoWithGate,
} from "./modules/triage";
import {
  clearTrips,
  setCategoryAutoWithEvidence,
  trustEvidenceReader,
  type CategoryEvidence,
  type EvidenceGateInput,
} from "./modules/trust";
import { llmRoleTable, sendTestAddresses, testMailRule, type Config } from "./platform/config";
import type { SecretBox } from "./platform/crypto";
import type { DB, Db, TenantContext } from "./platform/db";
import type { LlmRoleTable } from "./platform/llm";
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

// The scope of the model for the Sent analysis of the open loops: the word of `TRIAGE_LLM_SCOPE`. null: the model is off.
export function loopsLlmScope(config: Config): AnalysisScope | null {
  if (config.TRIAGE_LLM_SCOPE === "off") return null;
  if (config.TRIAGE_LLM_SCOPE === "synthetic") return { kind: "synthetic", testMail: testMailRule(config) };
  return { kind: "all" };
}

// The config check guarantees the list for `self`.
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

// The profile reader of the classifier prompt part `profile` (`classifier-v4`): the stored profile of one sender in one mailbox,
// or null (flag `sender_context` off, no stored row). `triage` may not import `contacts`, so the roots pass this.
// The production prompt reads no profile (triage rule 18); only a prompt with the part calls it.
export function senderProfileReader(input: {
  db: Db | Transaction<DB>;
  credentialsKey: string;
  now: () => Date;
}): NonNullable<ClassifierExtrasInput["readProfile"]> {
  return async (ctx, mailboxId, senderLower) => {
    if (!(await senderFlags(input.db, ctx)).context) return null;
    const address = normalizeAddress(senderLower);
    const profiles = await readProfiles(
      { db: input.db, credentialsKey: input.credentialsKey },
      ctx,
      [{ mailboxId, address }],
      input.now()
    );
    return profiles.get(`${mailboxId}:${address}`) ?? null;
  };
}

// The one own-mail check of every sync, backfill and history run (ADR 0022 point 2): a draft or a send of the system (`X-EA-Action-Id` =
// an action id), or a report mail that the system appended (`X-EA-Action-Id` = an outbox id of channel `mail`). Every composition root
// that builds a sync, a backfill or a history deps passes this, never `isOwnActionId` alone (`composition.test.ts` scans for it).
export function isOwnMailOf(
  db: Db | Transaction<DB>
): (ctx: TenantContext, mailboxId: string, id: string) => Promise<boolean> {
  return async (ctx, mailboxId, id) =>
    (await isOwnActionId(db, ctx, mailboxId, id)) || (await isOwnReportMail(db, ctx, mailboxId, id));
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
    // A send that the committer closes (a changed or a missing Drafts copy) edits its Telegram cards like any other close.
    approvalHooks: cardEditHooks({ sendScope: input.sendScope }),
    // A follow-up reads and updates its loop through these.
    loopHooks: loopHooks(),
    scope: input.scope,
    sendScope: input.sendScope,
    sendLimits: input.sendLimits,
    ...(input.onSendLimited === undefined ? {} : { onSendLimited: input.onSendLimited }),
    now: () => new Date(),
  };
}

// Turning off "Track my sent mail" ends the loops that the Sent mail started, in the same transaction. The web and the CLI
// pass this to `setSentSync`; a caller without it would leave open loops that hold the texts of deleted mail.
// The same transaction also clears the follow-up cards that copy the Sent mail (`clearLoopCards`: `channels` sits above `loops`).
export const sentSwitchHooks: SentSwitchHooks = {
  onDisabled: async (trx, ctx, input) => {
    await onSentOff(trx, ctx, input);
    await clearLoopCards(trx, ctx, input);
  },
};

// The one builder of the settings setters' deps: the CLI and the web call it, so both close the gate the same way.
// `gate` is the global evidence of the running classifier, built once at start; the default has no file (a closed gate).
export function settingsDeps(db: Db, now: () => Date, gate: GateEvidenceDeps = noGateEvidence): SettingsDeps {
  const hooks = delegationHooks({ db });
  return {
    db,
    now,
    gate,
    clearTrips,
    expireReady: async (trx, trxCtx, filter, opts) =>
      expireReady(trx, trxCtx, filter, {
        ...opts,
        sendClose: { hooks, uidplus: await mailboxHasUidplus(trx, trxCtx, filter.mailboxId) },
      }),
  };
}

// The M8 reader of the week service (stats route, `stats:week`, the weekly report). `reports` and `channels` may not
// import `trust`, so every root that builds a week service passes this one, over the same settings deps as the trust routes.
export function trustEvidenceOf(
  db: Db,
  now: () => Date,
  gate: GateEvidenceDeps | undefined,
  testMail: TestMailRule
): ReturnType<typeof trustEvidenceReader> {
  return trustEvidenceReader({ settings: settingsDeps(db, now, gate), testMail });
}

// The resume hook of `setOrgPlan`. Sends whose approval request no owner saw before the pause end as `not_seen`
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

// The hooks of `setOrgPlan` for every caller (the `org:plan` CLI and the operator console), so both suspend and
// resume the same way: suspend cancels the queued messages, resume closes the sends with an unseen approval request.
export function orgPlanHooks(db: Db): SetOrgPlanHooks {
  return { onSuspended: cancelPendingOutboxOfOrg, onResumed: resumeHook(db) };
}

// The gate files of the image. `GATE_EVIDENCE_DIR` overrides the folder; the default is `evals/results/gate` from the repo
// root, where the eval scripts write it (the Dockerfile copies it to the same place).
export function gateEvidenceDir(config: Config): string {
  return config.GATE_EVIDENCE_DIR ?? resolve(import.meta.dir, "../../../evals/results/gate");
}

// The global evidence of the running classifier: the gate files read once, and the key of the role table (ADR 0028).
// The server, the CLI and the lab all build it here, so none of them is stricter than another. `quiet` is for a CLI.
export function gateEvidenceOf(config: Config, opts: { table?: LlmRoleTable; quiet?: boolean } = {}): GateEvidenceDeps {
  return {
    index: loadGateEvidence(gateEvidenceDir(config), { quiet: opts.quiet === true }),
    runningKey: runningEvidenceKey(opts.table ?? llmRoleTable(config)),
  };
}

export type AutoSetResult =
  | { kind: "changed"; change: SettingsChange; gate: GateView | null; evidence: CategoryEvidence | null }
  | { kind: "refused"; gate: GateView; evidence: CategoryEvidence | null };

// The one setter of `auto` for the web and the CLI: the evidence gate when `trust_ladder` is on for the organization,
// else the gate of the real labels. Both write the grant and clear the trips (ADR 0028).
export function autoSetter(
  settings: SettingsDeps,
  testMail: TestMailRule
): (ctx: TenantContext, mailboxId: string, input: EvidenceGateInput) => Promise<AutoSetResult> {
  return async (ctx, mailboxId, input) => {
    if (await isFeatureOn(settings.db, ctx, "trust_ladder")) {
      return setCategoryAutoWithEvidence({ settings, testMail }, ctx, mailboxId, input);
    }
    const result = await setCategoryAutoWithGate(settings, ctx, mailboxId, input, testMail);
    return result.kind === "refused"
      ? { kind: "refused", gate: result.gate, evidence: null }
      : { kind: "changed", change: result.change, gate: result.gate, evidence: null };
  };
}
