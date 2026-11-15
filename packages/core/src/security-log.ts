// The security log registry (plan D25). Pure: no process.env, no Date.now().
// One list says which audit events are security events and which kind key the web names them by.

export const securityEventKinds = [
  "sign_in",
  "locked",
  "password_set",
  "password_changed",
  "sessions_ended",
  "other_sessions_ended",
  "two_factor_on",
  "two_factor_off",
  "two_factor_reset",
  "backup_codes_new",
  "backup_code_used",
  "two_factor_locked",
  "two_factor_refused",
  "break_glass_set",
  "break_glass_cleared",
  "data_exported",
  "delete_refused",
  "dsr_find",
  "dsr_erase",
  "sso_sign_in",
  "sso_refused",
  "sso_provider_set",
  "sso_provider_removed",
  "sso_domain_verified",
  "sso_domain_attested",
  "sso_required_changed",
  "sso_unlinked",
  "member_added",
  "member_sessions_ended",
] as const;

export type SecurityEventKind = (typeof securityEventKinds)[number];

// Audit event code → kind. The codes are the values of `auditEvents` in apps/server/src/modules/audit.
export const securityEvents = {
  "web.login": "sign_in",
  "web.login_locked": "locked",
  "web.password_set": "password_set",
  "web.password_changed": "password_changed",
  "web.sessions_revoked": "sessions_ended",
  "web.other_sessions_revoked": "other_sessions_ended",
  "web.two_factor_enabled": "two_factor_on",
  "web.two_factor_disabled": "two_factor_off",
  "web.two_factor_reset": "two_factor_reset",
  "web.backup_codes_generated": "backup_codes_new",
  "web.backup_code_used": "backup_code_used",
  "web.two_factor_locked": "two_factor_locked",
  "web.two_factor_refused": "two_factor_refused",
  "org.break_glass_set": "break_glass_set",
  "org.break_glass_cleared": "break_glass_cleared",
  "org.exported": "data_exported",
  "org.delete_refused": "delete_refused",
  "dsr.find": "dsr_find",
  "dsr.erase": "dsr_erase",
  "sso.login": "sso_sign_in",
  "sso.refused": "sso_refused",
  "sso.provider_set": "sso_provider_set",
  "sso.provider_removed": "sso_provider_removed",
  "sso.domain_verified": "sso_domain_verified",
  "sso.domain_attested": "sso_domain_attested",
  "sso.required_changed": "sso_required_changed",
  "sso.unlinked": "sso_unlinked",
  "org.member_added": "member_added",
  "web.member_sessions_ended": "member_sessions_ended",
} as const satisfies Record<string, SecurityEventKind>;

export const securityEventCodes: readonly string[] = Object.keys(securityEvents);

export function securityKindOf(event: string): SecurityEventKind | null {
  return Object.hasOwn(securityEvents, event) ? securityEvents[event as keyof typeof securityEvents] : null;
}

export const SECURITY_LOG_LIMIT = 50;
export const SECURITY_LOG_DAYS = 90;
