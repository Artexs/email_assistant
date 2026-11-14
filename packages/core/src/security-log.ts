// The security log registry (plan D25). Pure: no process.env, no Date.now().
// One list says which audit events are security events and which kind key the web names them by.

export const securityEventKinds = [
  "sign_in",
  "locked",
  "password_set",
  "password_changed",
  "sessions_ended",
  "other_sessions_ended",
] as const; // E7-T6 adds the 2FA kinds, E7-T3 the export, delete and DSR kinds

export type SecurityEventKind = (typeof securityEventKinds)[number];

// Audit event code → kind. The codes are the values of `auditEvents` in apps/server/src/modules/audit.
export const securityEvents = {
  "web.login": "sign_in",
  "web.login_locked": "locked",
  "web.password_set": "password_set",
  "web.password_changed": "password_changed",
  "web.sessions_revoked": "sessions_ended",
  "web.other_sessions_revoked": "other_sessions_ended",
} as const satisfies Record<string, SecurityEventKind>;

export const securityEventCodes: readonly string[] = Object.keys(securityEvents);

export function securityKindOf(event: string): SecurityEventKind | null {
  return Object.hasOwn(securityEvents, event) ? securityEvents[event as keyof typeof securityEvents] : null;
}

export const SECURITY_LOG_LIMIT = 50;
export const SECURITY_LOG_DAYS = 90;
