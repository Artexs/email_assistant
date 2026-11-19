import {
  effectiveDetail,
  TELEGRAM_CONSENT_VERSION,
  type TelegramDetail,
  type TelegramDetailAnswer,
  type TelegramDetailBody,
  type TelegramLockAnswer,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { auditEvents, recordAudit } from "../audit";
import {
  getOrganization,
  isFeatureOn,
  listTelegramDetailsOf,
  setMemberTelegramDetail,
  setTelegramMinimalLocked,
} from "../tenancy";

// The member's Telegram detail level and the owner's lock (ADR 0032 point 5). The sender decides the level of each message at send
// time (`effectiveDetail`, `detail.ts`); this file is the write side: the member's own choice and the organization's lock.
// Every function runs in one transaction. With the flag `telegram_minimal` off, the routes answer as a feature that is off.

function inTransaction<T>(db: Db | Transaction<DB>, run: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.isTransaction ? run(db as Transaction<DB>) : (db as Db).transaction().execute(run);
}

/** The stored level, the effective level and the lock of one member, for the panel. undefined: the flag is off, or the user is no member. */
export async function telegramDetailOfMember(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  userId: string
): Promise<TelegramDetailAnswer | undefined> {
  if (!(await isFeatureOn(db, ctx, "telegram_minimal"))) return undefined;
  const row = (await listTelegramDetailsOf(db, [{ orgId: ctx.orgId, userId }])).get(`${ctx.orgId}:${userId}`);
  if (row === undefined) return undefined;
  return {
    detail: row.memberDetail,
    effectiveDetail: effectiveDetail({ flagOn: true, locked: row.locked, memberDetail: row.memberDetail }),
    locked: row.locked,
  };
}

/** Stores the level and writes the audit row when the stored value changes: `{ detail }` and nothing else. false: the user is no member. */
export async function storeTelegramDetail(
  trx: Transaction<DB>,
  ctx: TenantContext,
  userId: string,
  detail: TelegramDetail,
  now: Date
): Promise<boolean> {
  const before = await setMemberTelegramDetail(trx, ctx, userId, detail);
  if (before === undefined) return false;
  if (before !== detail) {
    await recordAudit(trx, ctx, {
      event: auditEvents.memberTelegramDetailChanged,
      actor: userId,
      data: { detail },
      at: now,
    });
  }
  return true;
}

/** Records the consent to the current Telegram text, as the link route and the confirm route do. */
export async function recordTelegramConsent(trx: Transaction<DB>, ctx: TenantContext, userId: string, now: Date) {
  await recordAudit(trx, ctx, {
    event: auditEvents.webTelegramConsent,
    actor: userId,
    data: { via: "web", version: TELEGRAM_CONSENT_VERSION },
    at: now,
  });
}

/**
 * The detail level that a link asks for. `locked`: the organization locked `minimal` and the link asked for `full`. Reads only.
 * `undefined`: the flag is off; the link keeps today's behaviour and leaves the stored level alone.
 */
export async function linkDetailOf(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  asked: TelegramDetail | undefined
): Promise<{ detail: TelegramDetail } | { locked: true } | undefined> {
  if (!(await isFeatureOn(db, ctx, "telegram_minimal"))) return undefined;
  const detail = asked ?? "minimal";
  if (detail === "full" && (await getOrganization(db, ctx))?.telegram_minimal_locked === true) return { locked: true };
  return { detail };
}

export type ChangeDetailResult =
  | { kind: "ok"; answer: TelegramDetailAnswer }
  | { kind: "locked" }
  | { kind: "consent_outdated" }
  | { kind: "not_found" };

/**
 * `PATCH /me/telegram-detail`: the member changes the own level. `full` needs the current consent text (and records it in the same
 * transaction) and is refused while the organization locks `minimal`; `minimal` needs nothing. The row is the one of `userId`.
 */
export function changeTelegramDetail(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  userId: string,
  body: TelegramDetailBody,
  now: Date
): Promise<ChangeDetailResult> {
  return inTransaction(db, async (trx): Promise<ChangeDetailResult> => {
    const organization = await getOrganization(trx, ctx);
    if (organization === undefined) return { kind: "not_found" };
    if (body.detail === "full") {
      if (organization.telegram_minimal_locked) return { kind: "locked" };
      if (body.consentVersion !== TELEGRAM_CONSENT_VERSION) return { kind: "consent_outdated" };
    }
    if (!(await storeTelegramDetail(trx, ctx, userId, body.detail, now))) return { kind: "not_found" };
    if (body.detail === "full") await recordTelegramConsent(trx, ctx, userId, now);
    return {
      kind: "ok",
      answer: {
        detail: body.detail,
        effectiveDetail: effectiveDetail({
          flagOn: true,
          locked: organization.telegram_minimal_locked,
          memberDetail: body.detail,
        }),
        locked: organization.telegram_minimal_locked,
      },
    };
  });
}

/** `PATCH /organization/telegram-lock` (owner): the lock changes no member value (the stored levels stay for the unlock). */
export function changeTelegramLock(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  actor: string,
  locked: boolean,
  now: Date
): Promise<TelegramLockAnswer | undefined> {
  return inTransaction(db, async (trx) => {
    const before = await setTelegramMinimalLocked(trx, ctx, locked);
    if (before === undefined) return undefined;
    if (before !== locked) {
      await recordAudit(trx, ctx, { event: auditEvents.orgTelegramLockChanged, actor, data: { locked }, at: now });
    }
    return { locked };
  });
}
