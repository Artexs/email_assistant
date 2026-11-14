// M3: serious mistakes. Four kinds count; a rejected draft that was not needed, or has no reason, is only shown.
import type { Category } from "../triage/categories";
import type { MoveTarget } from "../triage/planners";

export const rejectReasons = ["wrong_person", "wrong_content", "not_needed"] as const;
export type RejectReason = (typeof rejectReasons)[number];

export interface HiddenMoveRow {
  emailId: string;
  appliedAt: Date;
  folder: MoveTarget; // the move target of the original action
  truth: Category | null; // as MailTruthRow.truth
  vip: boolean; // triage_results.vip
  whitelisted: boolean; // the sender matches a whitelist rule now
}
export interface RejectRow {
  actionId: string;
  rejectedAt: Date;
  reason: RejectReason | null;
}
export interface MistakeRow {
  actionId: string;
  sentAt: Date;
}

export interface SeriousMistakes {
  hiddenImportant: number;
  wrongPerson: number;
  wrongContent: number;
  sentMistake: number;
  total: number; // the four above
  notNeeded: number; // shown, not counted
  noReason: number; // shown, not counted
}

const HIDDEN_TRUTH: readonly Category[] = ["urgent", "needs_reply", "delegation"];

const inRange = (at: Date, range: { start: Date; end: Date }): boolean =>
  at.getTime() >= range.start.getTime() && at.getTime() < range.end.getTime();

function isHiddenImportant(move: HiddenMoveRow): boolean {
  if (move.folder === "inbox") return false;
  if (move.truth !== null && HIDDEN_TRUTH.includes(move.truth)) return true;
  return move.folder === "ai_spam" && (move.vip || move.whitelisted);
}

export function seriousMistakes(
  input: { moves: readonly HiddenMoveRow[]; rejects: readonly RejectRow[]; mistakes: readonly MistakeRow[] },
  range: { start: Date; end: Date }
): SeriousMistakes {
  const hiddenEmails = new Set<string>();
  for (const move of input.moves) {
    if (inRange(move.appliedAt, range) && isHiddenImportant(move)) hiddenEmails.add(move.emailId);
  }
  let wrongPerson = 0;
  let wrongContent = 0;
  let notNeeded = 0;
  let noReason = 0;
  for (const reject of input.rejects) {
    if (!inRange(reject.rejectedAt, range)) continue;
    if (reject.reason === "wrong_person") wrongPerson += 1;
    else if (reject.reason === "wrong_content") wrongContent += 1;
    else if (reject.reason === "not_needed") notNeeded += 1;
    else noReason += 1;
  }
  const mistakeActions = new Set<string>();
  for (const mistake of input.mistakes) {
    if (inRange(mistake.sentAt, range)) mistakeActions.add(mistake.actionId);
  }
  const hiddenImportant = hiddenEmails.size;
  const sentMistake = mistakeActions.size;
  return {
    hiddenImportant,
    wrongPerson,
    wrongContent,
    sentMistake,
    total: hiddenImportant + wrongPerson + wrongContent + sentMistake,
    notNeeded,
    noReason,
  };
}
