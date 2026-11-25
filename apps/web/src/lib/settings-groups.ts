import type { TextKey } from "../i18n";

export type SettingsGroupId = "mailbox" | "notices" | "organization" | "account";

// The four named regions of the Settings page, in page order. The id is the anchor (`/settings#notices`).
export const SETTINGS_GROUPS: readonly { id: SettingsGroupId; label: TextKey }[] = [
  { id: "mailbox", label: "set_group_mailbox" },
  { id: "notices", label: "set_group_notices" },
  { id: "organization", label: "set_group_organization" },
  { id: "account", label: "set_group_account" },
];

// The group that a hash names, or null for no hash or an unknown one.
export function groupIdFromHash(hash: string): SettingsGroupId | null {
  const id = hash.startsWith("#") ? hash.slice(1) : hash;
  return SETTINGS_GROUPS.find((group) => group.id === id)?.id ?? null;
}
