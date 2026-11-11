import type { RuleView, SenderRuleKind } from "@ea/core/web";

import type { TextKey } from "../i18n/en";

export const ruleKindOrder = ["vip", "whitelist", "blocklist"] as const;

export const kindTitles: Record<SenderRuleKind, TextKey> = {
  vip: "rule_kind_vip",
  whitelist: "rule_kind_whitelist",
  blocklist: "rule_kind_blocklist",
};

// Keeps the API order inside a kind.
export function groupRules(rules: readonly RuleView[]): Record<SenderRuleKind, RuleView[]> {
  const groups: Record<SenderRuleKind, RuleView[]> = { vip: [], whitelist: [], blocklist: [] };
  for (const rule of rules) groups[rule.kind].push(rule);
  return groups;
}

export function scopeLabel(
  rule: RuleView,
  mailboxes: readonly { id: string; address: string }[]
): { key: TextKey } | { address: string } {
  if (rule.mailboxId === null) return { key: "rules_all_mailboxes" };
  const mailbox = mailboxes.find((item) => item.id === rule.mailboxId);
  return mailbox === undefined ? { key: "rules_scope_removed" } : { address: mailbox.address };
}

export function rulesPath(mailboxId: string | null): string {
  return mailboxId === null ? "/api/rules" : `/api/rules?mailboxId=${encodeURIComponent(mailboxId)}`;
}
