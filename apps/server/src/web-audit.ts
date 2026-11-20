import { auditEvents, recordAudit } from "./modules/audit";
import { listMembershipsOfUser, setUserTerms } from "./modules/tenancy";
import type { AuthDeps, AuthEventKind } from "./platform/auth";
import type { AuthMailKind } from "./platform/auth-mail-texts";
import type { Db } from "./platform/db";
import { errorFields } from "./platform/errors";
import { createLog } from "./platform/log";
import type { WebExtras } from "./web-routers";

// The composition root of the web: the parts that need more than one module.
export const log = createLog("web");

const eventNames = {
  login: auditEvents.webLogin,
  password_set: auditEvents.webPasswordSet,
  password_changed: auditEvents.webPasswordChanged,
  login_locked: auditEvents.webLoginLocked,
  sessions_revoked: auditEvents.webSessionsRevoked,
  other_sessions_revoked: auditEvents.webOtherSessionsRevoked,
  two_factor_enabled: auditEvents.webTwoFactorEnabled,
  two_factor_disabled: auditEvents.webTwoFactorDisabled,
  backup_codes_generated: auditEvents.webBackupCodesGenerated,
  backup_code_used: auditEvents.webBackupCodeUsed,
  two_factor_locked: auditEvents.webTwoFactorLocked,
  two_factor_refused: auditEvents.webTwoFactorRefused,
} satisfies Record<AuthEventKind, string>;

// A login or a password change is a row in the audit log of the user's oldest organization. It never throws.
export function auditWebEvent(db: Db): AuthDeps["onEvent"] {
  return async (kind, userId, data) => {
    try {
      const [membership] = await listMembershipsOfUser(db, userId);
      if (!membership) {
        log.warn("web_no_organization", { user_id: userId });
        return;
      }
      await recordAudit(
        db,
        { orgId: membership.org_id },
        { event: eventNames[kind], actor: userId, data: { via: "web", ...data } }
      );
    } catch (error) {
      log.error("web_audit_failed", { kind, ...errorFields(error) });
    }
  };
}

// An SSO sign-in or refusal is a row in the provider's organization. `ssoPlugins` catches a failure and logs it.
export function auditSsoEvent(db: Db): NonNullable<AuthDeps["onSsoEvent"]> {
  return async (event) => {
    await recordAudit(
      db,
      { orgId: event.orgId },
      {
        event: event.kind === "login" ? auditEvents.ssoLogin : auditEvents.ssoRefused,
        actor: event.userId ?? "system",
        data: event.data,
      }
    );
  };
}

// The accepted terms and their audit row go in one transaction, in the user's oldest organization. It never throws.
export function termsAcceptedHandler(db: Db, now: () => Date): AuthDeps["onTermsAccepted"] {
  return async (userId, version) => {
    try {
      const [membership] = await listMembershipsOfUser(db, userId);
      await db.transaction().execute(async (trx) => {
        await setUserTerms(trx, userId, version, now());
        if (membership) {
          await recordAudit(
            trx,
            { orgId: membership.org_id },
            { event: auditEvents.webTermsAccepted, actor: userId, data: { via: "web", version } }
          );
        }
      });
    } catch (error) {
      log.error("terms_record_failed", { user_id: userId, ...errorFields(error) });
    }
  };
}

// A failed auth mail is an operator notice in the user's oldest organization. It never throws.
export function authMailFailedHandler(
  db: Db,
  notify: WebExtras["onAuthMailFailed"]
): (userId: string, kind: AuthMailKind, code: string) => void {
  return (userId, kind, code) => {
    if (!notify) return;
    void (async () => {
      try {
        const [membership] = await listMembershipsOfUser(db, userId);
        if (!membership) return;
        notify({ orgId: membership.org_id }, userId, kind, code);
      } catch (error) {
        log.error("web_auth_mail_notice_failed", { user_id: userId, ...errorFields(error) });
      }
    })();
  };
}
