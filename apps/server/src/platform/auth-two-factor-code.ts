import { type BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { TWO_FACTOR_ERROR_CODES, twoFactor } from "better-auth/plugins";

import type { AuthEventKind, AuthHandle } from "./auth";
import { errorFields } from "./errors";
import { createLog } from "./log";

const log = createLog("auth_two_factor");

// The numbers of the two-factor plugin.
export const TWO_FACTOR_LOCK = { maxFailedAttempts: 10, durationSeconds: 900 } as const;
export const TRUST_DEVICE_SECONDS = 2_592_000; // 30 days
export const BACKUP_CODE_COUNT = 10;

// The only /two-factor/* paths that reach Better Auth.
// `get-totp-uri` (it shows the secret again), `send-otp` and `verify-otp` stay closed.
export const TWO_FACTOR_ALLOWED_PATHS = [
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
  "/two-factor/generate-backup-codes",
] as const;

// The plugin stores the secret and the backup codes encrypted with the auth secret.
// `enable` writes `verified: false` itself (the plugin default of the model is true, the database default is false).
export function twoFactorPlugin() {
  return twoFactor({
    issuer: "Email Assistant",
    trustDeviceMaxAge: TRUST_DEVICE_SECONDS,
    accountLockout: { enabled: true, ...TWO_FACTOR_LOCK },
    backupCodeOptions: { amount: BACKUP_CODE_COUNT, length: 10, storeBackupCodes: "encrypted" },
    schema: {
      user: { fields: { twoFactorEnabled: "two_factor_enabled" } },
      twoFactor: {
        modelName: "auth_two_factors",
        fields: {
          userId: "user_id",
          backupCodes: "backup_codes",
          failedVerificationCount: "failed_verification_count",
          lockedUntil: "locked_until",
        },
      },
    },
  });
}

// The number of unused backup codes, never the codes. null when the read fails (also: no row).
export async function backupCodesLeft(handle: AuthHandle, userId: string): Promise<number | null> {
  try {
    return (await handle.auth.api.viewBackupCodes({ body: { userId } })).backupCodes.length;
  } catch (error) {
    log.warn("two_factor_codes_unreadable", { user_id: userId, ...errorFields(error) });
    return null;
  }
}

export type AuthReport = (kind: AuthEventKind, userId: string, data?: Record<string, string>) => Promise<void>;

const SIGN_IN_PATH = "/sign-in/email";
const VERIFY_TOTP_PATH = "/two-factor/verify-totp";
const VERIFY_BACKUP_CODE_PATH = "/two-factor/verify-backup-code";
const DISABLE_PATH = "/two-factor/disable";
const GENERATE_BACKUP_CODES_PATH = "/two-factor/generate-backup-codes";
const SIGN_IN_AUDIT_PATHS: ReadonlySet<string> = new Set([
  SIGN_IN_PATH,
  VERIFY_TOTP_PATH,
  VERIFY_BACKUP_CODE_PATH,
  DISABLE_PATH,
  GENERATE_BACKUP_CODES_PATH,
]);

export function twoFactorOn(user: object): boolean {
  return (user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true;
}

type AuditContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

// Turning two-factor off and making new backup codes need a code, not only the password.
// The code goes through the plugin's own verify (`verifyTOTP`, `verifyBackupCode`); no code check is written here.
// The plugin counts failed codes only at sign-in, so the lock-out is applied here on the same columns and numbers.
export const SECOND_FACTOR_ACTIONS: Readonly<Record<string, "disable" | "backup_codes" | undefined>> = {
  [DISABLE_PATH]: "disable",
  [GENERATE_BACKUP_CODES_PATH]: "backup_codes",
};

export function secondFactorActionOf(path: string): "disable" | "backup_codes" | null {
  return Object.hasOwn(SECOND_FACTOR_ACTIONS, path) ? (SECOND_FACTOR_ACTIONS[path] ?? null) : null;
}

// The two verify endpoints of the plugin. `auth.ts` passes `auth.api` after the instance exists.
interface VerifyInput {
  body: { code: string };
  headers: Headers;
}
export interface CodeApi {
  verifyTOTP: (input: VerifyInput) => Promise<unknown>;
  verifyBackupCode: (input: VerifyInput) => Promise<unknown>;
}

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

const WRONG_CODE_ERRORS: ReadonlySet<string> = new Set(["INVALID_CODE", "INVALID_BACKUP_CODE"]);

// The request whose failed code made the count reach the limit reports the lock, once.
// The challenge cookie names the user; the request has no session.
async function reportLockOnce(ctx: AuditContext, report: AuthReport): Promise<void> {
  const id = await ctx.getSignedCookie(ctx.context.createAuthCookie("two_factor").name, ctx.context.secret);
  if (!id) return;
  const challenge = await ctx.context.internalAdapter.findVerificationValue(id);
  if (!challenge) return;
  const userId = challenge.value;
  const row = await ctx.context.adapter.findOne<{ failedVerificationCount?: number | null; lockedUntil?: Date | null }>(
    {
      model: "twoFactor",
      where: [{ field: "userId", value: userId }],
    }
  );
  if (!row?.lockedUntil) return;
  if (row.failedVerificationCount !== TWO_FACTOR_LOCK.maxFailedAttempts) return;
  if (row.lockedUntil.getTime() <= Date.now()) return;
  await report("two_factor_locked", userId, { locked_until: row.lockedUntil.toISOString() });
}

// TOTP turns on. Every older trusted device and every other session of the user ends: none of
// them passed a second factor. The read comes first, so a failed read changes nothing.
async function endOlderAccess(ctx: AuditContext, userId: string, keepSessionId: string): Promise<void> {
  const others = (await ctx.context.internalAdapter.listSessions(userId))
    .filter((row) => row.id !== keepSessionId)
    .map((row) => row.token);
  await ctx.context.adapter.deleteMany({ model: "verification", where: [{ field: "value", value: userId }] });
  if (others.length > 0) await ctx.context.internalAdapter.deleteSessions(others);
}

// Fail closed: the plugin has stored the enrolment before this hook runs. When the purge fails,
// the hook takes the enrolment back (one transaction), so the user is not enrolled, the old access is
// unchanged and a retry works. It then rethrows: the answer stays a 500. Trusted-device rows stay:
// they are old access, and the retry purges them.
async function rollbackEnrolment(ctx: AuditContext, userId: string): Promise<void> {
  try {
    await ctx.context.adapter.transaction(async (trx) => {
      await trx.update({
        model: "user",
        where: [{ field: "id", value: userId }],
        update: { twoFactorEnabled: false },
      });
      await trx.deleteMany({ model: "twoFactor", where: [{ field: "userId", value: userId }] });
    });
    log.warn("two_factor_enrol_rollback", { user_id: userId });
  } catch (error) {
    log.error("two_factor_enrol_rollback_failed", { user_id: userId, ...errorFields(error) });
  }
}

// Listed after `twoFactorPlugin()` in `plugins`. The plugin's own after hook has then deleted the
// session of a sign-in that waits for its code, so `newSession` is null for that request : no row.
export function signInAuditPlugin(report: AuthReport) {
  return {
    id: "ea-sign-in-audit",
    hooks: {
      // The panel never sends `disableSession`; on the sign-in path it would use up a code with no session and no row.
      before: [
        {
          matcher: (context) => context.path === VERIFY_BACKUP_CODE_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            if ((ctx.body as { disableSession?: unknown } | undefined)?.disableSession === true) {
              throw APIError.from("BAD_REQUEST", {
                code: "DISABLE_SESSION_REFUSED",
                message: "disableSession is not supported.",
              });
            }
          }),
        },
      ],
      after: [
        {
          matcher: (context) => SIGN_IN_AUDIT_PATHS.has(context.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned;
            const requestSession = ctx.context.session;
            const newSession = ctx.context.newSession;
            if (isAPIError(returned)) {
              const wrongCode = returned.statusCode === 401 && WRONG_CODE_ERRORS.has(String(returned.body?.code));
              if (
                wrongCode &&
                !requestSession &&
                (ctx.path === VERIFY_TOTP_PATH || ctx.path === VERIFY_BACKUP_CODE_PATH)
              ) {
                try {
                  await reportLockOnce(ctx, report);
                } catch (error) {
                  log.error("two_factor_lock_report_failed", { ...errorFields(error) });
                }
              }
              return;
            }
            if (ctx.path === DISABLE_PATH) {
              if (requestSession) await report("two_factor_disabled", requestSession.user.id);
              return;
            }
            if (ctx.path === GENERATE_BACKUP_CODES_PATH) {
              if (requestSession) await report("backup_codes_generated", requestSession.user.id);
              return;
            }
            if (ctx.path === SIGN_IN_PATH) {
              if (!newSession) return;
              await report("login", newSession.user.id, {
                second_factor: twoFactorOn(newSession.user) ? "trusted_device" : "none",
              });
              return;
            }
            if (ctx.path === VERIFY_TOTP_PATH && requestSession && newSession && !twoFactorOn(requestSession.user)) {
              // The enrolment: the check has a session, TOTP was off before it, and the plugin made a new session.
              const userId = requestSession.user.id;
              try {
                await endOlderAccess(ctx, userId, newSession.session.id);
              } catch (error) {
                await rollbackEnrolment(ctx, userId);
                throw error;
              }
              await report("two_factor_enabled", userId);
              return;
            }
            if (ctx.path === VERIFY_BACKUP_CODE_PATH) {
              // The sign-in path has no request session; the session path has no new session.
              if (!requestSession && newSession) {
                await report("login", newSession.user.id, { second_factor: "backup_code" });
              }
              const userId = requestSession?.user.id ?? newSession?.user.id;
              if (userId) await report("backup_code_used", userId);
              return;
            }
            if (ctx.path === VERIFY_TOTP_PATH && !requestSession && newSession) {
              await report("login", newSession.user.id, { second_factor: "totp" });
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
