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
  "break_glass_set",
  "break_glass_cleared",
] as const; // E7-T3 adds the export, delete and DSR kinds

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
  "org.break_glass_set": "break_glass_set",
  "org.break_glass_cleared": "break_glass_cleared",
} as const satisfies Record<string, SecurityEventKind>;

export const securityEventCodes: readonly string[] = Object.keys(securityEvents);

export function securityKindOf(event: string): SecurityEventKind | null {
  return Object.hasOwn(securityEvents, event) ? securityEvents[event as keyof typeof securityEvents] : null;
}

export const SECURITY_LOG_LIMIT = 50;
export const SECURITY_LOG_DAYS = 90;
