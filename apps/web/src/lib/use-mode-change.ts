import type { SettingsWebChange } from "@ea/core/web";
import { useState } from "react";

import { patchSettings } from "./settings-api";

export type Mode = "shadow" | "assist";

export interface ModeChangeHandlers {
  onChanged(change: SettingsWebChange, mode: Mode): void;
  // Every failure goes here; the caller maps a 404 (the mailbox is gone) and shows the error.
  onFail(error: unknown): void;
}

// The mode call: `pending` is true from the call until it ends, also when it fails.
export async function runModeChange(
  mailboxId: string,
  mode: Mode,
  keepSwitches: boolean,
  setPending: (pending: boolean) => void,
  handlers: ModeChangeHandlers
): Promise<void> {
  setPending(true);
  try {
    const change = await patchSettings(mailboxId, "/mode", { mode, keepSwitches });
    handlers.onChanged(change, mode);
  } catch (error) {
    handlers.onFail(error);
  } finally {
    setPending(false);
  }
}

export function useModeChange(mailboxId: string, handlers: ModeChangeHandlers) {
  const [pending, setPending] = useState(false);
  const change = (mode: Mode, keepSwitches: boolean) =>
    runModeChange(mailboxId, mode, keepSwitches, setPending, handlers);
  return { pending, change };
}
