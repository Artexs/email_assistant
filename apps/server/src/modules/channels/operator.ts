import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { describeError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { auditEvents, hasAuditKey, recordAudit } from "../audit";
import { listAuthErrorMailboxesBefore } from "../mail";
import { listOrganizations } from "../tenancy";

import { telegramErrorLabel } from "./telegram/errors";

const log = createLog("channels");

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const TRIAL_WARNING_MS = 3 * DAY_MS;

export type OperatorNoticeKind = "trial_ending" | "llm_cap" | "auth_error_24h" | "auth_mail_failed";

export interface OperatorNoticeDeps {
  db: Db | Transaction<DB>;
  now: () => Date;
  // The Telegram direct send to the operator chat; null = a `warn` log line instead.
  send: ((text: string) => Promise<void>) | null;
}

export interface OperatorNotices {
  // The hourly job: trial_ending and auth_error_24h, and one more try of every failed llm_cap notice.
  run(): Promise<void>;
  // Called by the triage job. Never throws, never blocks.
  capReached(ctx: TenantContext, mailboxId: string, dayStart: Date, cap: number): void;
  // Called by the web wiring (reset request) and the lockout. Never throws, never blocks.
  authMailFailed(
    ctx: TenantContext,
    userId: string,
    kind: "invite" | "reset" | "lockout",
    code: string,
    now: Date
  ): void;
  // Tests only: resolves when no notify is in flight.
  idle(): Promise<void>;
}

interface RetryCap {
  ctx: TenantContext;
  kind: OperatorNoticeKind;
  text: string;
}

// D31, A19: an event reaches the operator at least once. The text holds ids, dates and counts only.
// The dedup is an audit row `operator.notice` with `data.key`, written after a successful send, in the organization of the event.
export function createOperatorNotices(deps: OperatorNoticeDeps): OperatorNotices {
  const { db, send } = deps;
  const doneKeys = new Set<string>();
  const inFlight = new Set<string>();
  const failedLogged = new Set<string>();
  const retryCaps = new Map<string, RetryCap>();
  const running = new Set<Promise<void>>();

  async function sendOrLog(kind: OperatorNoticeKind, text: string): Promise<void> {
    if (send === null) {
      log.warn(`operator notice ${kind}: ${text}`);
      return;
    }
    await send(text);
  }

  // Never throws.
  async function notify(ctx: TenantContext, kind: OperatorNoticeKind, key: string, text: string): Promise<void> {
    if (doneKeys.has(key) || inFlight.has(key)) return;
    inFlight.add(key);
    try {
      try {
        if (await hasAuditKey(db, ctx, auditEvents.operatorNotice, key)) {
          doneKeys.add(key);
          return;
        }
      } catch (error) {
        log.error(`operator notice ${kind}: ${describeError(error)}`);
        return;
      }

      try {
        await sendOrLog(kind, text);
      } catch (error) {
        if (!failedLogged.has(key)) {
          failedLogged.add(key);
          log.error(`operator notice ${kind} failed: ${telegramErrorLabel(error)}`);
        }
        // A capped mailbox calls `capReached` on every mail: the next hourly run retries, the triage loop does not.
        if (kind === "llm_cap") retryCaps.set(key, { ctx, kind, text });
        return;
      }

      try {
        await recordAudit(db, ctx, {
          actor: "system",
          event: auditEvents.operatorNotice,
          data: { kind, key },
        });
      } catch (error) {
        log.error(`operator notice ${kind}: ${describeError(error)}`);
        return;
      }
      retryCaps.delete(key);
      doneKeys.add(key);
    } finally {
      inFlight.delete(key);
    }
  }

  function start(ctx: TenantContext, kind: OperatorNoticeKind, key: string, text: string): Promise<void> {
    const promise = notify(ctx, kind, key, text).finally(() => running.delete(promise));
    running.add(promise);
    return promise;
  }

  async function runOrganizations(now: Date): Promise<void> {
    const organizations = await listOrganizations(db);
    for (const organization of organizations) {
      try {
        const { id: orgId, plan, trialEndsAt } = organization;
        if (plan !== "trial" || trialEndsAt === null) continue;
        if (trialEndsAt.getTime() > now.getTime() + TRIAL_WARNING_MS) continue;
        const iso = trialEndsAt.toISOString();
        const text =
          now.getTime() < trialEndsAt.getTime()
            ? `Trial of org ${orgId} ends ${iso}.`
            : `Trial of org ${orgId} ended ${iso}.`;
        await start({ orgId }, "trial_ending", `trial_ending:${orgId}:${trialEndsAt.getTime()}`, text);
      } catch (error) {
        log.error(`operator notice trial_ending: ${describeError(error)}`);
      }
    }
  }

  async function runAuthErrors(now: Date): Promise<void> {
    const mailboxes = await listAuthErrorMailboxesBefore(db, new Date(now.getTime() - DAY_MS));
    for (const { orgId, mailboxId, statusChangedAt } of mailboxes) {
      try {
        await start(
          { orgId },
          "auth_error_24h",
          `auth_error_24h:${mailboxId}:${statusChangedAt.getTime()}`,
          `Mailbox ${mailboxId} of org ${orgId} has been in auth_error since ${statusChangedAt.toISOString()}.`
        );
      } catch (error) {
        log.error(`operator notice auth_error_24h: ${describeError(error)}`);
      }
    }
  }

  async function runRetries(): Promise<void> {
    for (const [key, entry] of [...retryCaps]) {
      retryCaps.delete(key);
      await start(entry.ctx, entry.kind, key, entry.text);
    }
  }

  return {
    async run() {
      const now = deps.now();
      // Each part has its own guard: one failure does not stop the next part.
      for (const part of [() => runOrganizations(now), () => runAuthErrors(now), () => runRetries()]) {
        try {
          await part();
        } catch (error) {
          log.error(`operator notice run: ${describeError(error)}`);
        }
      }
    },

    capReached(ctx, mailboxId, dayStart, cap) {
      try {
        const dayIso = dayStart.toISOString();
        const key = `llm_cap:${mailboxId}:${dayIso}`;
        if (retryCaps.has(key)) return;
        void start(
          ctx,
          "llm_cap",
          key,
          `Mailbox ${mailboxId} of org ${ctx.orgId} reached the daily LLM cap (${cap} calls) on the quota day from ${dayIso}.`
        );
      } catch (error) {
        log.error(`operator notice llm_cap: ${describeError(error)}`);
      }
    },

    authMailFailed(ctx, userId, kind, code, now) {
      try {
        const key = `auth_mail_failed:${userId}:${code}:${now.toISOString().slice(0, 10)}`;
        void start(
          ctx,
          "auth_mail_failed",
          key,
          `Auth mail ${kind} to user ${userId} of org ${ctx.orgId} failed (${code}).`
        );
      } catch (error) {
        log.error(`operator notice auth_mail_failed: ${describeError(error)}`);
      }
    },

    async idle() {
      while (running.size > 0) await Promise.allSettled([...running]);
    },
  };
}
