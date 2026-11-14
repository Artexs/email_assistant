import { type BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";

import type { AuthEventKind } from "./auth";

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
const SIGN_IN_AUDIT_PATHS: ReadonlySet<string> = new Set([SIGN_IN_PATH, VERIFY_TOTP_PATH, VERIFY_BACKUP_CODE_PATH]);

function twoFactorOn(user: object): boolean {
  return (user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true;
}

// Listed after `twoFactorPlugin()` in `plugins`. The plugin's own after hook has then deleted the
// session of a sign-in that waits for its code, so `newSession` is null for that request : no row.
export function signInAuditPlugin(report: AuthReport) {
  return {
    id: "ea-sign-in-audit",
    hooks: {
      after: [
        {
          matcher: (context) => SIGN_IN_AUDIT_PATHS.has(context.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            if (isAPIError(ctx.context.returned)) return;
            const newSession = ctx.context.newSession;
            if (!newSession) return;
            if (ctx.path === SIGN_IN_PATH) {
              await report("login", newSession.user.id, {
                second_factor: twoFactorOn(newSession.user) ? "trusted_device" : "none",
              });
              return;
            }
            // The enrolment check has a session already: no login row.
            if (ctx.context.session) return;
            await report("login", newSession.user.id, {
              second_factor: ctx.path === VERIFY_TOTP_PATH ? "totp" : "backup_code",
            });
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
