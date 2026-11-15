import type { SentSyncView } from "@ea/core/web";

import type { TextKey } from "../i18n";

// The one status line under the "Track my sent mail" switch. null while the switch is off.
// The first rule that matches wins. `sent_last` carries the time of the newest user mail in `vars.at`.
export function sentStatusLine(view: SentSyncView): { key: TextKey; vars?: Record<string, string> } | null {
  if (!view.enabled) return null;
  if (!view.flagOn) return { key: "sent_paused" };
  if (view.folder === null || view.errorCode === "no_folder") return { key: "sent_no_folder" };
  if (view.errorCode === "folder_missing") return { key: "sent_folder_missing" };
  if (view.errorCode === "failed") return { key: "sent_failed" };
  if (!view.firstPassDone) return { key: "sent_first_pass" };
  if (view.lastSentAt === null || view.storedCount === 0) return { key: "sent_none" };
  return { key: "sent_last", vars: { at: view.lastSentAt } };
}
