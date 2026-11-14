import type { CoreTexts } from "../texts";
import type { ActionTense, SendPhraseStatus } from "../texts/would-do";
import type { DraftKind } from "../triage/payloads";
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
  kind: DraftKind | null; // from the payload of a draft or a send
  delegateId: string | null;
  waiting?: "send_limit"; // an approved send held by the send limit (F099 D11 a)
}

export type WouldDoAction = Pick<
  ActionView,
  "type" | "status" | "folder" | "reverse" | "kind" | "delegateId" | "waiting"
>;

const TENSES: Record<string, ActionTense> = {
  logged: "would",
  ready: "will",
  applying: "will",
  awaiting_approval: "will",
  approved: "will",
  applied: "done",
  undone: "undone",
  failed: "failed",
};

// A draft that was undone (a send followed) or expired is not shown: the line reads from the send.
const DRAFT_TENSES: Record<string, ActionTense> = {
  logged: "would",
  ready: "will",
  applying: "will",
  applied: "done",
  failed: "failed",
};

const SEND_STATUSES: ReadonlySet<string> = new Set<SendPhraseStatus>([
  "logged",
  "awaiting_approval",
  "approved",
  "applying",
  "applied",
  "rejected",
  "expired",
  "failed",
]);

// A send phrase has no tense.
function sendPhrase(action: WouldDoAction, texts: CoreTexts): string | undefined {
  if (action.status === "approved" && action.waiting === "send_limit") return texts.wouldDo.sendLimitWait;
  return SEND_STATUSES.has(action.status) ? texts.wouldDo.send[action.status as SendPhraseStatus] : undefined;
}

function draftPhrase(
  action: WouldDoAction,
  names: ReadonlyMap<string, string>,
  tense: ActionTense,
  texts: CoreTexts
): string {
  const name = action.delegateId === null ? null : (names.get(action.delegateId) ?? null);
  return texts.wouldDo.draft(tense, action.kind ?? "delegation", name);
}

function phrase(
  action: WouldDoAction,
  names: ReadonlyMap<string, string>,
  tense: ActionTense,
  texts: CoreTexts
): string | null {
  switch (action.type) {
    case "flag":
      return texts.wouldDo.flag(tense);
    case "mark_read":
      return texts.wouldDo.markRead(tense);
    case "move":
      return texts.wouldDo.move(tense, action.folder === null ? null : MOVE_TARGET_NAMES[action.folder]);
    case "create_draft":
      return draftPhrase(action, names, tense, texts);
    case "save_summary":
    case "send":
      return null;
  }
}

function tenseOf(action: WouldDoAction): ActionTense | undefined {
  return action.type === "create_draft" ? DRAFT_TENSES[action.status] : TENSES[action.status];
}

// The phrase of one original action, or null when it has none. Same tense rules as `describeActions`.
export function describeAction(
  action: WouldDoAction,
  names: ReadonlyMap<string, string>,
  texts: CoreTexts
): string | null {
  if (action.reverse) return null;
  if (action.type === "send") return sendPhrase(action, texts) ?? null;
  const tense = tenseOf(action);
  if (tense === undefined) return null;
  const text = phrase(action, names, tense, texts);
  return text === null ? null : `${texts.wouldDo.tense[tense]} ${text}`;
}

// The "what the system does or would do" line of a digest or notice. `names` maps delegate ids to names.
export function describeActions(
  actions: readonly WouldDoAction[],
  names: ReadonlyMap<string, string>,
  opts: { stayFolder?: string },
  texts: CoreTexts
): string {
  const groups = new Map<ActionTense, string[]>();
  const sends: string[] = [];
  for (const action of actions) {
    if (action.reverse) continue;
    if (action.type === "send") {
      const text = sendPhrase(action, texts);
      if (text !== undefined) sends.push(text);
      continue;
    }
    const tense = tenseOf(action);
    if (tense === undefined) continue;
    const text = phrase(action, names, tense, texts);
    if (text === null) continue;
    groups.set(tense, [...(groups.get(tense) ?? []), text]);
  }
  const all = [
    ...[...groups].map(([tense, phrases]) => `${texts.wouldDo.tense[tense]} ${phrases.join(", ")}`),
    ...sends,
  ];
  const parts = all.filter((part, index) => part !== all[index - 1]); // the same phrase never twice in a row
  return parts.length === 0
    ? texts.wouldDo.staysIn(opts.stayFolder === undefined ? "INBOX" : cutText(opts.stayFolder, 30))
    : parts.join("; ");
}
