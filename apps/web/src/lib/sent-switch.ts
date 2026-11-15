import type { SettingsWebChange } from "@ea/core/web";

import type { TextKey } from "../i18n";
import { ApiError } from "./api";
import { errorText } from "./errors";

export interface SentSwitchDeps {
  patch(mailboxId: string, tail: string, body: unknown): Promise<SettingsWebChange>;
  onChanged(change: SettingsWebChange, toastKey: TextKey): void;
  toastError(key: TextKey): void;
  // A 404 means the mailbox is gone, or the flag went off: the page reloads its mailbox list.
  onMissing?(): void;
}

// The write of the "Track my sent mail" switch: one PATCH, then a toast. An error shows its text; a 404 also asks for a reload.
export async function changeSentSync(deps: SentSwitchDeps, mailboxId: string, enabled: boolean): Promise<void> {
  try {
    const result = await deps.patch(mailboxId, "/sent-sync", { enabled });
    deps.onChanged(result, enabled ? "sent_on_toast" : "sent_off_toast");
  } catch (error) {
    deps.toastError(errorText(error));
    if (error instanceof ApiError && error.status === 404) deps.onMissing?.();
  }
}
