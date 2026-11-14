import { type BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";

import type { AuthEventKind } from "./auth";
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

function twoFactorOn(user: object): boolean {
  return (user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true;
}

type AuditContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

const WRONG_CODE_ERRORS: ReadonlySet<string> = new Set(["INVALID_CODE", "INVALID_BACKUP_CODE"]);

// D8: the request whose failed code made the count reach the limit reports the lock, once.
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

// D9: TOTP turns on. Every older trusted device and every other session of the user ends: none of
// them passed a second factor. The read comes first, so a failed read changes nothing.
async function endOlderAccess(ctx: AuditContext, userId: string, keepSessionId: string): Promise<void> {
  const others = (await ctx.context.internalAdapter.listSessions(userId))
    .filter((row) => row.id !== keepSessionId)
    .map((row) => row.token);
  await ctx.context.adapter.deleteMany({ model: "verification", where: [{ field: "value", value: userId }] });
  if (others.length > 0) await ctx.context.internalAdapter.deleteSessions(others);
}

// D9, fail closed: the plugin has stored the enrolment before this hook runs. When the purge fails,
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
