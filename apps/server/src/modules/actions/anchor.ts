// An action hangs on one incoming mail (`email_id`) or on one open loop (`loop_id`, open loops feature). The database
// holds the rule (`actions_anchor_check`: exactly one is set). These helpers read the two columns apart.
export interface ActionAnchorColumns {
  email_id: string | null;
  loop_id: string | null;
}
export type ActionAnchor = { kind: "email"; emailId: string } | { kind: "loop"; loopId: string };

/** `loop_anchor`: a loop row reached a path for incoming mail. `invalid_anchor`: a row that breaks the database rule. */
export class ActionAnchorError extends Error {
  readonly code: "loop_anchor" | "invalid_anchor";
  constructor(code: "loop_anchor" | "invalid_anchor") {
    super(`action anchor: ${code}`);
    this.name = "ActionAnchorError";
    this.code = code;
  }
}

export function anchorOfRow(row: ActionAnchorColumns): ActionAnchor {
  if (row.email_id !== null && row.loop_id === null) {
    return { kind: "email", emailId: row.email_id };
  }
  if (row.email_id === null && row.loop_id !== null) {
    return { kind: "loop", loopId: row.loop_id };
  }
  throw new ActionAnchorError("invalid_anchor");
}

/**
 * The mail of an action, for the code paths that exist only for incoming mail (mailbox changes, Undo, triage planning,
 * delegation, clarification, reminder, the activity of a mail). A loop-anchored row throws `loop_anchor`.
 */
export function emailIdOf(row: ActionAnchorColumns): string {
  const anchor = anchorOfRow(row);
  if (anchor.kind === "loop") {
    throw new ActionAnchorError("loop_anchor");
  }
  return anchor.emailId;
}
