import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { TWO_FACTOR_ERROR_CODES } from "better-auth/plugins";

import type { AuthReport, CodeApi } from "./auth-two-factor";

type AuditContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

export const TWO_FACTOR_LOCK = { maxFailedAttempts: 10, durationSeconds: 900 } as const;

export const WRONG_CODE_ERRORS: ReadonlySet<string> = new Set(["INVALID_CODE", "INVALID_BACKUP_CODE"]);

export interface SecondFactorInput {
  userId: string;
  action: "disable" | "backup_codes";
  api: CodeApi | null;
  report: AuthReport;
  now: () => Date;
}

interface TwoFactorRow {
  id: string;
  failedVerificationCount?: number | null;
  lockedUntil?: Date | null;
}
type Refusal = "missing" | "wrong" | "locked";

// A TOTP code is digits only. A backup code always holds a dash, so the shape picks the verify with no second try.
const DIGITS = /^\d+$/;

function isWrongCode(error: unknown): boolean {
  return isAPIError(error) && error.statusCode === 401 && WRONG_CODE_ERRORS.has(String(error.body?.code));
}

// The try is counted before the code is checked, in one guarded atomic step: parallel requests cannot pass the limit
// together (a count after the check let 14 of 15 parallel wrong codes through). Returns the new count, or null when
// the limit is already used up (the lock is on or about to be written).
async function reserveTry(ctx: AuditContext, row: TwoFactorRow): Promise<number | null> {
  const reserved = await ctx.context.adapter.incrementOne<{ failedVerificationCount?: number | null }>({
    model: "twoFactor",
    where: [
      { field: "id", value: row.id },
      { field: "failedVerificationCount", operator: "lt", value: TWO_FACTOR_LOCK.maxFailedAttempts },
    ],
    increment: { failedVerificationCount: 1 },
  });
  return reserved ? (reserved.failedVerificationCount ?? null) : null;
}

// A failure that is not a wrong code (a 500, a missing row) gives the try back.
async function releaseTry(ctx: AuditContext, row: TwoFactorRow): Promise<void> {
  await ctx.context.adapter.incrementOne({
    model: "twoFactor",
    where: [
      { field: "id", value: row.id },
      { field: "failedVerificationCount", operator: "gt", value: 0 },
    ],
    increment: { failedVerificationCount: -1 },
  });
}

// The wrong code that used the last try writes the lock, and the lock row once.
async function lockAfterLastTry(ctx: AuditContext, row: TwoFactorRow, input: SecondFactorInput): Promise<void> {
  const lockedUntil = new Date(input.now().getTime() + TWO_FACTOR_LOCK.durationSeconds * 1000);
  await ctx.context.adapter.incrementOne({
    model: "twoFactor",
    where: [
      { field: "id", value: row.id },
      { field: "failedVerificationCount", operator: "gte", value: TWO_FACTOR_LOCK.maxFailedAttempts },
    ],
    increment: {},
    set: { lockedUntil },
  });
  await input.report("two_factor_locked", input.userId, { locked_until: lockedUntil.toISOString() });
}

async function clearCount(ctx: AuditContext, row: TwoFactorRow): Promise<void> {
  await ctx.context.adapter.update({
    model: "twoFactor",
    where: [{ field: "id", value: row.id }],
    update: { failedVerificationCount: 0, lockedUntil: null },
  });
}

// Runs in `hooks.before` of the two paths, for a session whose user has TOTP on. Order: the password first (a wrong
// password uses up no code and gives no answer about a code), then the lock, then the code. Every refusal is a
// security-log row with the action and the reason, never the code. The break-glass check runs before this one.
export async function requireSecondFactorCode(ctx: AuditContext, input: SecondFactorInput): Promise<void> {
  await ctx.context.password.checkPassword(input.userId, ctx);
  const refuse = async (reason: Refusal): Promise<void> => {
    await input.report("two_factor_refused", input.userId, { action: input.action, reason });
  };
  const given = (ctx.body as { code?: unknown } | undefined)?.code;
  const code = typeof given === "string" ? given.trim() : "";
  if (code === "") {
    await refuse("missing");
    throw APIError.from("BAD_REQUEST", {
      code: "TWO_FACTOR_CODE_REQUIRED",
      message: "A code from the authenticator app or a backup code is required.",
    });
  }
  const row = await ctx.context.adapter.findOne<TwoFactorRow>({
    model: "twoFactor",
    where: [{ field: "userId", value: input.userId }],
  });
  if (row?.lockedUntil) {
    if (row.lockedUntil.getTime() > input.now().getTime()) {
      await refuse("locked");
      throw APIError.from("TOO_MANY_REQUESTS", TWO_FACTOR_ERROR_CODES.ACCOUNT_TEMPORARILY_LOCKED);
    }
    await clearCount(ctx, row);
  }
  // Fail closed: no API or no headers is an error, never a pass.
  if (!input.api || !ctx.headers) throw new Error("The second-factor check has no verify API.");
  let attempt: number | null = null;
  if (row) {
    attempt = await reserveTry(ctx, row);
    if (attempt === null) {
      await refuse("locked");
      throw APIError.from("TOO_MANY_REQUESTS", TWO_FACTOR_ERROR_CODES.ACCOUNT_TEMPORARILY_LOCKED);
    }
  }
  const verify = { body: { code }, headers: ctx.headers };
  try {
    await (DIGITS.test(code) ? input.api.verifyTOTP(verify) : input.api.verifyBackupCode(verify));
  } catch (error) {
    if (!isWrongCode(error)) {
      if (row) await releaseTry(ctx, row);
      throw error;
    }
    if (row && attempt === TWO_FACTOR_LOCK.maxFailedAttempts) await lockAfterLastTry(ctx, row, input);
    await refuse("wrong");
    throw error;
  }
  if (row) await clearCount(ctx, row);
}
