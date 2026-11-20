import {
  DAY_MS,
  type OperatorEvent,
  type OperatorEventKind,
  operatorEventKey,
  renderOperatorEvent,
  type SendLimitKind,
  sendLimitOfError,
  type UserLocale,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { errorFields } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { listSendLimitHolds } from "../actions";
import { auditEvents, hasAuditKey, recordAudit } from "../audit";
import { listAuthErrorMailboxesBefore } from "../mail";
import { listOrganizations } from "../tenancy";

import type { OperatorDelivery } from "./deliver";

const log = createLog("channels");

const TRIAL_WARNING_MS = 3 * DAY_MS;

export interface OperatorNoticeDeps {
  db: Db | Transaction<DB>;
  now: () => Date;
  // The one delivery of the operator texts; it logs the send and a failed send.
  delivery: OperatorDelivery;
  // The language of the texts (`OPERATOR_LOCALE`).
  locale: UserLocale;
}

export interface OperatorNoticeHooks {
  // The hourly job: trial_ending and auth_error_24h, and one more try of every failed llm_cap and send_limit notice.
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
  // Called by the committer after a hold commits. Never throws, never blocks.
  sendLimitReached(ctx: TenantContext, hit: { mailboxId: string; limit: SendLimitKind; until: Date; at: Date }): void;
  // Tests only: resolves when no notify is in flight.
  idle(): Promise<void>;
}

interface Retry {
  ctx: TenantContext;
  kind: OperatorEventKind;
  text: string;
}

// An event reaches the operator at least once. The text holds ids, dates and counts only.
// The dedup is an audit row `operator.notice` with `data.key`, written after a successful send, in the organization of the event.
export function createOperatorNotices(deps: OperatorNoticeDeps): OperatorNoticeHooks {
  const { db, delivery } = deps;
  const { locale } = deps;
  // The key and the text of an event come from core. Throws on an invalid date: the caller guards it.
  const noticeOf = (event: OperatorEvent): { key: string; text: string } => ({
    key: operatorEventKey(event),
    text: renderOperatorEvent(event, locale),
  });
  const doneKeys = new Set<string>();
  const inFlight = new Set<string>();
  const retries = new Map<string, Retry>();
  const running = new Set<Promise<void>>();

  // Never throws.
  async function notify(ctx: TenantContext, kind: OperatorEventKind, key: string, text: string): Promise<void> {
    if (doneKeys.has(key) || inFlight.has(key)) return;
    inFlight.add(key);
    try {
      try {
        if (await hasAuditKey(db, ctx, auditEvents.operatorNotice, key)) {
          doneKeys.add(key);
          return;
        }
      } catch (error) {
        log.error("operator_alert_failed", { kind, ...errorFields(error) });
        return;
      }

      if (!(await delivery.deliver({ kind, status: "open", key }, text))) {
        // A capped mailbox calls `capReached` on every mail: the next hourly run retries, the triage loop does not.
        // A held mailbox calls `sendLimitReached` on every held send: same rule.
        if (kind === "llm_cap" || kind === "send_limit") retries.set(key, { ctx, kind, text });
        return;
      }

      try {
        await recordAudit(db, ctx, {
          actor: "system",
          event: auditEvents.operatorNotice,
          data: { kind, key },
        });
      } catch (error) {
        log.error("operator_alert_failed", { kind, ...errorFields(error) });
        return;
      }
      retries.delete(key);
      doneKeys.add(key);
    } finally {
      inFlight.delete(key);
    }
  }

  function start(ctx: TenantContext, kind: OperatorEventKind, key: string, text: string): Promise<void> {
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
        const { key, text } = noticeOf({
          kind: "trial_ending",
          orgId,
          endsAt: trialEndsAt,
          ended: now.getTime() >= trialEndsAt.getTime(),
        });
        await start({ orgId }, "trial_ending", key, text);
      } catch (error) {
        log.error("operator_check_failed", { kind: "trial_ending", ...errorFields(error) });
      }
    }
  }

  async function runAuthErrors(now: Date): Promise<void> {
    const mailboxes = await listAuthErrorMailboxesBefore(db, new Date(now.getTime() - DAY_MS));
    for (const { orgId, mailboxId, statusChangedAt } of mailboxes) {
      try {
        const { key, text } = noticeOf({ kind: "auth_error_24h", orgId, mailboxId, since: statusChangedAt });
        await start({ orgId }, "auth_error_24h", key, text);
      } catch (error) {
        log.error("operator_check_failed", { kind: "auth_error_24h", ...errorFields(error) });
      }
    }
  }

  async function runRetries(): Promise<void> {
    for (const [key, entry] of [...retries]) {
      retries.delete(key);
      await start(entry.ctx, entry.kind, key, entry.text);
    }
  }

  type SendLimitHit = Parameters<OperatorNoticeHooks["sendLimitReached"]>[1];

  // Never throws. Resolves when the text is sent or has failed (a failed text goes to `retries`).
  function startSendLimit(ctx: TenantContext, hit: SendLimitHit): Promise<void> {
    const { key, text } = noticeOf({
      kind: "send_limit",
      orgId: ctx.orgId,
      mailboxId: hit.mailboxId,
      limit: hit.limit,
      at: hit.at,
      until: hit.until,
    });
    if (retries.has(key)) return Promise.resolve();
    return start(ctx, "send_limit", key, text);
  }

  // The catch for a lost `sendLimitReached` call: a crash between the hold commit and the callback.
  // The key is the same, so the dedup makes one text per mailbox per UTC day.
  async function runSendLimits(now: Date): Promise<void> {
    const organizations = await listOrganizations(db);
    for (const organization of organizations) {
      if (organization.plan === "suspended") continue;
      try {
        const ctx = { orgId: organization.id };
        for (const hold of await listSendLimitHolds(db, ctx, now)) {
          const limit = sendLimitOfError(hold.lastError);
          if (limit === null) continue;
          await startSendLimit(ctx, { mailboxId: hold.mailboxId, limit, until: hold.nextAt, at: now });
        }
      } catch (error) {
        log.error("operator_check_failed", { kind: "send_limit", ...errorFields(error) });
      }
    }
  }

  return {
    async run() {
      const now = deps.now();
      // Each part has its own guard: one failure does not stop the next part.
      for (const part of [
        () => runOrganizations(now),
        () => runAuthErrors(now),
        () => runRetries(),
        () => runSendLimits(now),
      ]) {
        try {
          await part();
        } catch (error) {
          log.error("operator_check_failed", { ...errorFields(error) });
        }
      }
    },

    capReached(ctx, mailboxId, dayStart, cap) {
      try {
        const { key, text } = noticeOf({ kind: "llm_cap", orgId: ctx.orgId, mailboxId, cap, dayStart });
        if (retries.has(key)) return;
        void start(ctx, "llm_cap", key, text);
      } catch (error) {
        log.error("operator_alert_failed", { kind: "llm_cap", ...errorFields(error) });
      }
    },

    authMailFailed(ctx, userId, kind, code, now) {
      try {
        const { key, text } = noticeOf({
          kind: "auth_mail_failed",
          orgId: ctx.orgId,
          userId,
          mail: kind,
          code,
          at: now,
        });
        void start(ctx, "auth_mail_failed", key, text);
      } catch (error) {
        log.error("operator_alert_failed", { kind: "auth_mail_failed", ...errorFields(error) });
      }
    },

    sendLimitReached(ctx, hit) {
      try {
        void startSendLimit(ctx, hit);
      } catch (error) {
        log.error("operator_alert_failed", { kind: "send_limit", ...errorFields(error) });
      }
    },

    async idle() {
      while (running.size > 0) await Promise.allSettled([...running]);
    },
  };
}
