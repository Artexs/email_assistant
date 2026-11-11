import {
  ASSIST_DEFAULT_SWITCHES,
  settingsChangeSchema,
  toolSwitchNames,
  type SettingsWebChange,
  type SettingsWebView,
} from "@ea/core/web";

import { api } from "./api";

export function settingsPath(mailboxId: string, tail = ""): string {
  return `/api/settings/${encodeURIComponent(mailboxId)}${tail}`;
}

// The query id when it is listed, else the first mailbox, else null.
export function selectedMailboxId(list: readonly { id: string }[], query: string | null): string | null {
  if (query !== null && list.some((item) => item.id === query)) return query;
  return list[0]?.id ?? null;
}

// The switch names that are on after the mode change to assist.
export function switchesAfterAssist(
  current: SettingsWebView["toolSwitches"],
  keep: boolean
): (keyof SettingsWebView["toolSwitches"])[] {
  return toolSwitchNames.filter((name) => (keep ? current[name] : (ASSIST_DEFAULT_SWITCHES[name] ?? current[name])));
}

export function patchSettings(mailboxId: string, tail: string, body: unknown): Promise<SettingsWebChange> {
  return api(settingsPath(mailboxId, tail), settingsChangeSchema, { method: "PATCH", body });
}
