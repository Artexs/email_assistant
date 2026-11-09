import { type ActionType, MOVE_TARGET_NAMES, type MoveTarget } from "../triage/planners";

import { cutText } from "./text";

export interface ActionView {
  id: string;
  type: ActionType;
  status: string;
  folder: MoveTarget | null;
  reverse: boolean;
  reversesActionId: string | null;
  appliedAt: Date | null;
  kind: "delegation" | "clarification" | "reminder" | null; // from the payload of a draft or a send
  delegateId: string | null;
}

const TENSES: Record<string, string> = {
  logged: "would",
  ready: "will",
  applying: "will",
  awaiting_approval: "will",
  approved: "will",
  applied: "done:",
  undone: "undone:",
  failed: "failed:",
};

// A draft that was undone (a send followed) or expired is not shown: the line reads from the send.
const DRAFT_TENSES: Record<string, string> = {
  logged: "would",
  ready: "will",
  applying: "will",
  applied: "done:",
  failed: "failed:",
};

// A send phrase has no tense.
const SEND_PHRASES: Record<string, string> = {
  logged: "would ask you to send it",
  awaiting_approval: "waits for your approval",
  approved: "approved, sending",
  applying: "sending",
  applied: "sent",
  rejected: "rejected",
  expired: "not sent (approval expired)",
  failed: "not sent (failed)",
};

function draftPhrase(action: ActionView, names: ReadonlyMap<string, string>): string {
  const name = (action.delegateId === null ? undefined : names.get(action.delegateId)) ?? "a delegate";
  if (action.kind === "clarification") return "draft a question to the sender";
  return action.kind === "reminder" ? `draft a reminder to ${name}` : `draft a delegation to ${name}`;
}

function phrase(action: ActionView, names: ReadonlyMap<string, string>): string | null {
  switch (action.type) {
    case "flag":
      return "flag";
    case "mark_read":
      return "mark read";
    case "move":
      return action.folder === null ? "move" : `move to ${MOVE_TARGET_NAMES[action.folder]}`;
    case "create_draft":
      return draftPhrase(action, names);
    case "save_summary":
    case "send":
      return null;
  }
}

// The "what the system does or would do" line of a digest or notice. `names` maps delegate ids to names.
export function describeActions(
  actions: readonly ActionView[],
  names: ReadonlyMap<string, string> = new Map(),
  opts: { stayFolder?: string } = {}
): string {
  const groups = new Map<string, string[]>();
  const sends: string[] = [];
  for (const action of actions) {
    if (action.reverse) continue;
    if (action.type === "send") {
      const sendPhrase = SEND_PHRASES[action.status];
      if (sendPhrase !== undefined) sends.push(sendPhrase);
      continue;
    }
    const tense = action.type === "create_draft" ? DRAFT_TENSES[action.status] : TENSES[action.status];
    const text = phrase(action, names);
    if (tense === undefined || text === null) continue;
    groups.set(tense, [...(groups.get(tense) ?? []), text]);
  }
  const all = [...[...groups].map(([tense, phrases]) => `${tense} ${phrases.join(", ")}`), ...sends];
  const parts = all.filter((part, index) => part !== all[index - 1]); // the same phrase never twice in a row
  return parts.length === 0
    ? `stays in ${opts.stayFolder === undefined ? "INBOX" : cutText(opts.stayFolder, 30)}`
    : parts.join("; ");
}
