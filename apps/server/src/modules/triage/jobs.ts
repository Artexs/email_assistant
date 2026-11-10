import { mailboxModes, parseCategoryPolicy, parseToolSwitches, QUOTA_TIMEZONE } from "@ea/core";
import type { Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";
import { describeError } from "../../platform/errors";
import type { LlmClient } from "../../platform/llm";
import { createLog } from "../../platform/log";
import { getMailboxSettings, listSenderRules } from "../config";
import { listDelegates } from "../delegation";
import { claimEmails, getMailbox, listSyncTargets, releaseEmail, type ClaimedEmail } from "../mail";
import { getOrganization } from "../tenancy";

import type { LlmPause } from "./pause";
import { finishTriageError, HARD_ERROR_TRIES, triageOne, type TriageMailbox } from "./service";

const log = createLog("triage");

const STALE_AFTER_MS = 5 * 60_000;
const RETRY_WAIT_MS = 5 * 60_000;

const modeSchema = z.enum(mailboxModes);

// `synthetic`: only the seeded test mail of every mailbox. `all`: all mail, but only of one mailbox.
export type TriageScope = { kind: "synthetic" } | { kind: "all"; mailboxAddress: string };

export interface TriageJobDeps {
  db: Db | Transaction<DB>;
  llm: LlmClient;
  pause: LlmPause;
  scope: TriageScope;
  batchSize: number;
  dailyCap: number;
  now(): Date;
  // Only for tests of an error outside the LLM call.
  triageOne?: typeof triageOne;
}

// The log lines carry the mailbox id only: never the address.
export function createTriageJob(deps: TriageJobDeps): { run(): Promise<void> } {
  const warnedNoSettings = new Set<string>();
  const warnedNoOrganization = new Set<string>();
  // The quota day (ISO start) for which a mailbox already got the cap warning.
  const warnedCap = new Map<string, string>();
  const triage = deps.triageOne ?? triageOne;
  const scopeAddress = deps.scope.kind === "all" ? deps.scope.mailboxAddress.trim().toLowerCase() : null;

  return {
    async run() {
      // The client is paused: no claim, no log line.
      if (deps.pause.isPaused(deps.now())) return;
      // The zone of an organization, read once per run.
      const timezones = new Map<string, string>();
      try {
        const targets = await listSyncTargets(deps.db);
        for (const { orgId, mailboxId } of targets) {
          // A pause that a mailbox tripped stops all later mailboxes, also when its release failed.
          if (deps.pause.isPaused(deps.now())) return;
          const ctx = { orgId };
          let mailbox: TriageMailbox | undefined;
          let claimed: ClaimedEmail[] = [];
          // The index of the mail in work; -1 before the claim.
          let current = -1;
          try {
            const row = await getMailbox(deps.db, ctx, mailboxId);
            if (row === undefined) continue;
            if (scopeAddress !== null && row.address.toLowerCase() !== scopeAddress) continue;

            const settings = await getMailboxSettings(deps.db, ctx, mailboxId);
            if (settings === undefined) {
              if (!warnedNoSettings.has(mailboxId)) {
                warnedNoSettings.add(mailboxId);
                log.warn(`triage ${mailboxId}: no mailbox_settings row, mailbox skipped`);
              }
              continue;
            }

            let timezone = timezones.get(orgId);
            if (timezone === undefined) {
              const organization = await getOrganization(deps.db, ctx);
              if (organization === undefined) {
                if (!warnedNoOrganization.has(mailboxId)) {
                  warnedNoOrganization.add(mailboxId);
                  log.warn(`triage ${mailboxId}: no organization row, mailbox skipped`);
                }
                continue;
              }
              timezone = organization.timezone;
              timezones.set(orgId, timezone);
            }
            const delegates = (await listDelegates(deps.db, ctx, { activeOnly: true })).map((delegate) => ({
              id: delegate.id,
              name: delegate.name,
              email: delegate.email,
              tags: delegate.competence_tags,
            }));

            const capabilities: { move?: boolean; uidplus?: boolean } = row.capabilities;
            mailbox = {
              id: mailboxId,
              settingsVersion: settings.version,
              mode: modeSchema.parse(settings.mode),
              toolSwitches: parseToolSwitches(settings.tool_switches),
              policy: parseCategoryPolicy(settings.category_policy),
              rules: await listSenderRules(deps.db, ctx, mailboxId),
              movesSupported: capabilities.move === true || capabilities.uidplus === true,
              delegates,
              timezone,
            };
            log.debug(`triage ${mailboxId}: delegates ${delegates.length}`);

            const now = deps.now();
            claimed = await claimEmails(deps.db, ctx, mailboxId, {
              now,
              limit: deps.batchSize,
              staleBefore: new Date(now.getTime() - STALE_AFTER_MS),
              syntheticOnly: deps.scope.kind === "synthetic",
            });
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
                  log.warn(
                    `daily LLM cap reached for mailbox ${mailboxId}: ${deps.dailyCap} calls since ${dayStart} (${QUOTA_TIMEZONE} day); mail waits until ${outcome.until.toISOString()}`
                  );
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
        log.error(`triage failed: ${describeError(error)}`);
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
        log.error(`triage ${email.mailbox_id}: release failed: ${describeError(releaseError)}`);
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
    const failing = current >= 0 ? claimed[current] : undefined;
    if (deps.pause.isPaused(deps.now())) {
      // The current mail tripped the pause, but its release failed. It gets no try and no triage_error.
      await releaseUntried(ctx, claimed.slice(Math.max(current, 0)));
      log.error(`triage ${mailboxId} failed: ${describeError(error)}`);
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
          log.error(`triage ${mailboxId}: release failed: ${describeError(releaseError)}`);
        }
      };
      if (failing.attempts + 1 >= HARD_ERROR_TRIES) {
        try {
          await finishTriageError(deps, ctx, mailbox, failing);
        } catch (finishError) {
          log.error(`triage ${mailboxId}: triage_error save failed: ${describeError(finishError)}`);
          await retryLater();
        }
      } else {
        await retryLater();
      }
    }
    await releaseUntried(ctx, claimed.slice(current + 1));
    log.error(`triage ${mailboxId} failed: ${describeError(error)}`);
  }
}
