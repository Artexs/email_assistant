// A text key built at run time (a template such as `cat_${category}`) is found by its prefix. Each prefix is listed once with the
// file that builds it. The unused-key test checks that the file still builds a key with the prefix, and the docs text check
// (`apps/docs/src/panel-keys.ts`) accepts a docs key that starts with a prefix. The list defines no text.
export const RUNTIME_KEY_PREFIXES: readonly { prefix: string; file: string }[] = [
  { prefix: "legal_kept_until_", file: "apps/web/src/lib/legal-tables.ts" },
  { prefix: "cat_", file: "apps/web/src/components/report/ReportContent.tsx" },
  { prefix: "cat_effect_", file: "apps/web/src/components/settings/CategoriesCard.tsx" },
  { prefix: "cat_action_", file: "apps/web/src/components/settings/CategoriesCard.tsx" },
  { prefix: "folder_", file: "apps/web/src/components/settings/SyncFoldersCard.tsx" },
  { prefix: "sec_kind_", file: "apps/web/src/lib/security-log-text.ts" },
  { prefix: "browser_", file: "apps/web/src/components/settings/AccountCard.tsx" },
  { prefix: "os_", file: "apps/web/src/components/settings/AccountCard.tsx" },
  { prefix: "act_range_", file: "apps/web/src/components/activity/ActivityFilterBar.tsx" },
  { prefix: "act_cat_", file: "apps/web/src/lib/activity-text.ts" },
  { prefix: "act_rule_", file: "apps/web/src/lib/activity-text.ts" },
  { prefix: "undo_", file: "apps/web/src/lib/activity-text.ts" },
  { prefix: "sender_rel_", file: "apps/web/src/lib/activity-text.ts" },
  { prefix: "stats_m8_", file: "apps/web/src/lib/stats-view.ts" },
  { prefix: "rep_mode_", file: "apps/web/src/components/report/ReportContent.tsx" },
  { prefix: "switch_", file: "apps/web/src/components/settings/ModeCard.tsx" },
];
