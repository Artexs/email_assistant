import { type ActionType, AI_FOLDER_NAMES, type FolderKey } from "../triage/planners";

export interface ActionView {
  type: ActionType;
  status: string;
  folder: FolderKey | null;
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

function phrase(action: ActionView): string | null {
  switch (action.type) {
    case "flag":
      return "flag";
    case "mark_read":
      return "mark read";
    case "move":
      return action.folder === null ? "move" : `move to ${AI_FOLDER_NAMES[action.folder]}`;
    case "save_summary":
      return null;
  }
}

// The "what the system does or would do" line of a digest or notice.
export function describeActions(actions: readonly ActionView[]): string {
  const groups = new Map<string, string[]>();
  for (const action of actions) {
    const tense = TENSES[action.status];
    const text = phrase(action);
    if (tense === undefined || text === null) continue;
    groups.set(tense, [...(groups.get(tense) ?? []), text]);
  }
  if (groups.size === 0) return "stays in INBOX";
  return [...groups].map(([tense, phrases]) => `${tense} ${phrases.join(", ")}`).join("; ");
}
