import type { SettingsWebView } from "@ea/core/web";

// The controls of the open loops in the mailbox settings. The server sends `toolSwitches.auto_follow_up` only
// while the flag `open_loops` is on, so its absence hides the card. The controls need "Track my sent mail": a loop is read from Sent.
export const LOOP_WAIT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export interface LoopControls {
  // false: the flag is off, nothing shows.
  visible: boolean;
  // true: both controls are disabled (a member, or Sent tracking is not on).
  disabled: boolean;
  // true: the line "Turn on 'Track my sent mail'" shows.
  needsSentTracking: boolean;
}

export function loopControls(
  settings: Pick<SettingsWebView, "toolSwitches" | "sentTracking">,
  isOwner: boolean
): LoopControls {
  const needsSentTracking = settings.sentTracking !== "on";
  return {
    visible: settings.toolSwitches.auto_follow_up !== undefined,
    disabled: !isOwner || needsSentTracking,
    needsSentTracking,
  };
}
