import { MAILBOX_ACTION_TYPES } from "../triage/planners";

import type { ActionView } from "./would-do";

export const UNDO_WINDOW_MS = 7 * 24 * 3_600_000;

// P4/D14: the line gets the ↩️ button while an original mailbox action is `applied`, inside the window, with no reverse row.
export function isUndoable(actions: readonly ActionView[], now: Date): boolean {
  const reversed = new Set(actions.map((action) => action.reversesActionId).filter((id) => id !== null));
  return actions.some(
    (action) =>
      !action.reverse &&
      (MAILBOX_ACTION_TYPES as readonly string[]).includes(action.type) &&
      action.status === "applied" &&
      action.appliedAt !== null &&
      now.getTime() - action.appliedAt.getTime() <= UNDO_WINDOW_MS &&
      !reversed.has(action.id)
  );
}
