import { type EvidenceKey, mailboxModes, parseCategoryPolicy, parseToolSwitches, MINUTE_MS } from "@ea/core";
import type { Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";
import { errorFields } from "../../platform/errors";
import type { LlmClient } from "../../platform/llm";
import { createLog } from "../../platform/log";
import { getMailboxSettings, listSenderRules, parseUrgencyProfile } from "../config";
import { listDelegates } from "../delegation";
import {
  claimEmails,
  getJunkFolderPath,
  getMailbox,
  listSyncTargets,
  releaseEmail,
  type ClaimedEmail,
  type TestMailRule,
} from "../mail";
import { getOrganization, isOrgSuspended } from "../tenancy";

import type { LlmPause } from "./pause";
import { finishTriageError, HARD_ERROR_TRIES, triageOne, type TriageDeps, type TriageMailbox } from "./service";
import { loadSuspiciousContext } from "./suspicious-context";

const log = createLog("triage");

const STALE_AFTER_MS = 5 * MINUTE_MS;
const RETRY_WAIT_MS = 5 * MINUTE_MS;

const modeSchema = z.enum(mailboxModes);

// `synthetic`: only test mail (seeded, or from a test sender) of every mailbox. `all`: all mail of every active mailbox.
export type TriageScope = { kind: "synthetic"; testMail: TestMailRule } | { kind: "all" };

export interface TriageJobDeps {
  db: Db | Transaction<DB>;
  llm: LlmClient;
  pause: LlmPause;
  scope: TriageScope;
  // Thread context of a test mail comes from test mail only.
  testMail: TestMailRule;
  batchSize: number;
  dailyCap: number;
  junkDailyCap: number;
  // The key of the running classifier: `auto` granted under another key moves no mail Never read from env here.
  runningKey: EvidenceKey;
  // `MAIL_TRUSTED_AUTHSERV_IDS` (lower case): authserv-ids that the suspicious-mail rules trust besides the IMAP host of the mailbox.
  trustedAuthservIds?: readonly string[];
  now(): Date;
  // The operator notice of a reached cap. Called on every capped mail, never awaited: it must not block the loop.
  onCapReached?: (ctx: TenantContext, mailboxId: string, dayStart: Date) => void;
  // The profile reader of the composition root (`classifier-v4` part `profile`).
  readProfile?: TriageDeps["readProfile"];
  // Only for tests of an error outside the LLM call.
  triageOne?: typeof triageOne;
}

// The log lines carry the mailbox id only: never the address.
export function createTriageJob(deps: TriageJobDeps): { run(): Promise<void> } {
  const warnedNoSettings = new Set<string>();
  const warnedNoOrganization = new Set<string>();
  // The quota day (ISO start) for which a mailbox already got the cap warning.
  const warnedCap = new Map<string, string>();
  // The same for the junk folder limit.
  const warnedJunkCap = new Map<string, string>();
  const triage = deps.triageOne ?? triageOne;

  return {
    async run() {
      // The client is paused: no claim, no log line.
      if (deps.pause.isPaused(deps.now())) return;
      // The zone and the resume time of an organization, read once per run.
      const orgs = new Map<string, { timezone: string; resumedAt: Date | null }>();
      try {
        const targets = await listSyncTargets(deps.db);
        for (const { orgId, mailboxId } of targets) {
          // A pause that a mailbox tripped stops all later mailboxes, also when its release failed.
          if (deps.pause.isPaused(deps.now())) return;
          const ctx = { orgId };
          const mailboxLog = log.with({ org_id: orgId, mailbox_id: mailboxId });
          let mailbox: TriageMailbox | undefined;
          let claimed: ClaimedEmail[] = [];
          // The index of the mail in work; -1 before the claim.
          let current = -1;
          try {
            // A suspend during the run stops the next mailbox, not only the next run.
            if (await isOrgSuspended(deps.db, ctx)) continue;
            const row = await getMailbox(deps.db, ctx, mailboxId);
            if (row === undefined) continue;

            const settings = await getMailboxSettings(deps.db, ctx, mailboxId);
            if (settings === undefined) {
              if (!warnedNoSettings.has(mailboxId)) {
                warnedNoSettings.add(mailboxId);
                mailboxLog.warn("triage_no_settings");
              }
              continue;
            }

            let org = orgs.get(orgId);
            if (org === undefined) {
              const organization = await getOrganization(deps.db, ctx);
              if (organization === undefined) {
                if (!warnedNoOrganization.has(mailboxId)) {
                  warnedNoOrganization.add(mailboxId);
                  mailboxLog.warn("triage_no_organization");
                }
                continue;
              }
              org = { timezone: organization.timezone, resumedAt: organization.resumed_at };
              orgs.set(orgId, org);
            }
            const delegates = (await listDelegates(deps.db, ctx, { activeOnly: true })).map((delegate) => ({
              id: delegate.id,
              name: delegate.name,
              email: delegate.email,
              tags: delegate.competence_tags,
            }));

            const capabilities: { move?: boolean; uidplus?: boolean } = row.capabilities;
            const rules = await listSenderRules(deps.db, ctx, mailboxId);
            const now = deps.now();
            claimed = await claimEmails(deps.db, ctx, mailboxId, {
              now,
              limit: deps.batchSize,
              staleBefore: new Date(now.getTime() - STALE_AFTER_MS),
              syntheticOnly: deps.scope.kind === "synthetic" ? { testMail: deps.scope.testMail } : false,
            });
            if (claimed.length === 0) continue;
            // Once per batch: the known senders, the protected names and the trusted authserv-ids of this mailbox.
            const suspicious = await loadSuspiciousContext(deps.db, ctx, {
              mailbox: { id: mailboxId, rules, delegates },
              imapHost: row.imap_host,
              senders: claimed.map((email) => email.from_address),
              trustedAuthservIds: deps.trustedAuthservIds ?? [],
              now,
            });
            mailbox = {
              id: mailboxId,
              settingsVersion: settings.version,
              mode: modeSchema.parse(settings.mode),
              toolSwitches: parseToolSwitches(settings.tool_switches),
              policy: parseCategoryPolicy(settings.category_policy),
              runningKey: deps.runningKey,
              rules,
              movesSupported: capabilities.move === true || capabilities.uidplus === true,
              delegates,
              timezone: org.timezone,
              junkFolder: await getJunkFolderPath(deps.db, ctx, mailboxId),
              resumedAt: org.resumedAt,
              suspicious,
              urgencyProfile: parseUrgencyProfile(settings.urgency_profile),
            };
            mailboxLog.debug("triage_delegates", { count: delegates.length });

            for (const [index, email] of claimed.entries()) {
              current = index;
              // A stale take-back counts an attempt: a mail that reached the limit this way gets no more LLM call.
              if (email.attempts >= HARD_ERROR_TRIES) {
                await finishTriageError(deps, ctx, mailbox, email);
                continue;
              }
              const outcome = await triage(deps, ctx, mailbox, email);
              // The cap holds LLM calls only: the next mail may be a blocklist or too-old mail.
              if (outcome.kind === "capped") {
                const dayStart = outcome.dayStart.toISOString();
                if (warnedCap.get(mailboxId) !== dayStart) {
                  warnedCap.set(mailboxId, dayStart);
                  mailboxLog.warn("llm_daily_cap_reached", {
                    count: deps.dailyCap,
                    day_start: dayStart,
                    until: outcome.until.toISOString(),
                  });
                }
                deps.onCapReached?.(ctx, mailboxId, outcome.dayStart);
                continue;
              }
              // The junk limit holds junk folder mail only: other mail of this batch still runs. No operator notice.
              if (outcome.kind === "junk_capped") {
                const dayStart = outcome.dayStart.toISOString();
                if (warnedJunkCap.get(mailboxId) !== dayStart) {
                  warnedJunkCap.set(mailboxId, dayStart);
                  mailboxLog.warn("llm_junk_daily_cap_reached", {
                    count: deps.junkDailyCap,
                    day_start: dayStart,
                    until: outcome.until.toISOString(),
                  });
                }
                continue;
              }
              if (outcome.kind === "settings_changed") {
                // The snapshot is old: more mail of this batch would cost LLM calls for nothing. The next run reloads it.
                await releaseUntried(ctx, claimed.slice(index + 1));
                break;
              }
              if (outcome.kind === "paused" || deps.pause.isPaused(deps.now())) {
                // The quota is per project: stop all mailboxes. Untried mail keeps its old `next_attempt_at`.
                await releaseUntried(ctx, claimed.slice(index + 1));
                return;
              }
            }
          } catch (error) {
            await recoverFromError(ctx, mailboxId, mailbox, claimed, current, error);
          }
        }
      } catch (error) {
        log.error("triage_failed", errorFields(error));
      }
    },
  };

  async function releaseUntried(ctx: TenantContext, emails: readonly ClaimedEmail[]): Promise<void> {
    for (const email of emails) {
      try {
        await releaseEmail(deps.db, ctx, email.id, email.locked_at, {
          nextAttemptAt: email.next_attempt_at,
          countAttempt: false,
        });
      } catch (releaseError) {
        log.error("triage_release_failed", {
          org_id: ctx.orgId,
          mailbox_id: email.mailbox_id,
          ...errorFields(releaseError),
        });
      }
    }
  }

  // An error stops this mailbox only. The mail in work counts a try; later claimed mail goes back untouched.
  async function recoverFromError(
    ctx: TenantContext,
    mailboxId: string,
    mailbox: TriageMailbox | undefined,
    claimed: readonly ClaimedEmail[],
    current: number,
    error: unknown
  ): Promise<void> {
    const mailboxLog = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId });
    const failing = current >= 0 ? claimed[current] : undefined;
    if (deps.pause.isPaused(deps.now())) {
      // The current mail tripped the pause, but its release failed. It gets no try and no triage_error.
      await releaseUntried(ctx, claimed.slice(Math.max(current, 0)));
      mailboxLog.error("triage_mailbox_failed", errorFields(error));
      return;
    }
    if (failing !== undefined && mailbox !== undefined) {
      const retryLater = async (): Promise<void> => {
        try {
          await releaseEmail(deps.db, ctx, failing.id, failing.locked_at, {
            nextAttemptAt: new Date(deps.now().getTime() + RETRY_WAIT_MS),
            countAttempt: true,
          });
        } catch (releaseError) {
          mailboxLog.error("triage_release_failed", errorFields(releaseError));
        }
      };
      if (failing.attempts + 1 >= HARD_ERROR_TRIES) {
        try {
          await finishTriageError(deps, ctx, mailbox, failing);
        } catch (finishError) {
          mailboxLog.error("triage_error_save_failed", errorFields(finishError));
          await retryLater();
        }
      } else {
        await retryLater();
      }
    }
    await releaseUntried(ctx, claimed.slice(current + 1));
    mailboxLog.error("triage_mailbox_failed", errorFields(error));
  }
}
