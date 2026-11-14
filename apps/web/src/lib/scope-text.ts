import type { MailboxView, ScopeBadge } from "@ea/core/web";

import type { TextKey } from "../i18n";

type Scope = "triage" | "actions" | "send";

const badgeKeys: Record<Scope, Partial<Record<ScopeBadge["state"], TextKey>>> = {
  triage: { on: "badge_triage_on", synthetic: "badge_triage_synthetic", off: "badge_triage_off" },
  actions: { on: "badge_actions_on", synthetic: "badge_actions_synthetic", off: "badge_actions_off" },
  send: { on: "badge_send_on", self: "badge_send_self", off: "badge_send_off" },
};

const envOffKeys: Record<Scope, TextKey> = {
  triage: "reason_triage_env_off",
  actions: "reason_actions_env_off",
  send: "reason_send_env_off",
};

// A state the server never sends for a scope falls back to the safe `off` text.
export function badgeKey(scope: Scope, state: ScopeBadge["state"]): TextKey {
  return badgeKeys[scope][state] ?? `badge_${scope}_off`;
}

function reasonKey(scope: Scope, reason: ScopeBadge["reason"]): TextKey | null {
  switch (reason) {
    case "env_off":
      return envOffKeys[scope];
    case "synthetic_only":
      return "reason_synthetic_only";
    case "test_addresses_only":
      return "reason_test_addresses_only";
    case "by_mode":
      return "reason_by_mode";
    case "after_approval":
      return "reason_after_approval";
    case "all_mailboxes":
      return null;
  }
}

export function reasonKeys(scopes: MailboxView["scopes"]): TextKey[] {
  const keys: TextKey[] = [];
  for (const scope of ["triage", "actions", "send"] as const) {
    const key = reasonKey(scope, scopes[scope].reason);
    if (key !== null && !keys.includes(key)) keys.push(key);
  }
  return keys;
}
