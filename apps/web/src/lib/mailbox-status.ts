import type { MailboxView } from "@ea/core/web";
import { CircleCheck, Clock, Pause, TriangleAlert, type LucideIcon } from "lucide-react";

import type { TextKey } from "../i18n";

// One entry per mailbox status: a new status fails typecheck here until the panel maps it.
export const mailboxStatusUi: Record<
  MailboxView["status"],
  { variant: "default" | "secondary" | "destructive"; text: TextKey; hint: TextKey | null }
> = {
  active: { variant: "default", text: "status_active", hint: null },
  paused: { variant: "secondary", text: "status_paused", hint: null },
  auth_error: { variant: "destructive", text: "status_auth_error", hint: "mb_auth_error_hint" },
  host_blocked: { variant: "destructive", text: "status_host_blocked", hint: "mb_host_blocked_hint" },
};

export type MailboxCardState =
  | "connected"
  | "never_synced"
  | "paused"
  | "login_error"
  | "host_refused"
  | "access_revoked";

// The six looks of a mailbox card. An OAuth mailbox with a failed login is "access revoked": it has no password to change.
export function mailboxCardState(mailbox: MailboxView): MailboxCardState {
  switch (mailbox.status) {
    case "paused":
      return "paused";
    case "host_blocked":
      return "host_refused";
    case "auth_error":
      return mailbox.authMethod === "oauth" ? "access_revoked" : "login_error";
    case "active":
      return mailbox.lastSyncedAt === null ? "never_synced" : "connected";
  }
}

// One entry per card state: a new state fails typecheck here until the card maps it. `label` is the status line; null shows the last
// sync time instead. `error` states get the destructive tone and edge.
export const mailboxCardUi: Record<MailboxCardState, { icon: LucideIcon; label: TextKey | null; error: boolean }> = {
  connected: { icon: CircleCheck, label: null, error: false },
  never_synced: { icon: Clock, label: "mb_never_synced", error: false },
  paused: { icon: Pause, label: "status_paused", error: false },
  login_error: { icon: TriangleAlert, label: "status_auth_error", error: true },
  host_refused: { icon: TriangleAlert, label: "status_host_blocked", error: true },
  access_revoked: { icon: TriangleAlert, label: "status_access_revoked", error: true },
};

// The hint an owner reads on an error card; null for a state with no error.
export function mailboxCardHint(state: MailboxCardState, authReason: MailboxView["authReason"]): TextKey | null {
  switch (state) {
    case "login_error":
      return "mb_auth_error_hint";
    case "host_refused":
      return "mb_host_blocked_hint";
    case "access_revoked":
      if (authReason === "admin_consent_required") return "oauth_err_admin";
      if (authReason === "protocol_disabled") return "oauth_err_protocol";
      return "mb_access_revoked_hint";
    default:
      return null;
  }
}
