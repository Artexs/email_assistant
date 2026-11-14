import type { MailboxView } from "@ea/core/web";

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
