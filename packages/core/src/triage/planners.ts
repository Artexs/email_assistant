import { CLARIFICATION_MAX_CHARS, TASK_MAX_CHARS, type TriageAnalysis } from "./analysis";
import type { Category } from "./categories";
import { ADDRESS_PATTERN, sendPayloadFor, type DraftPayload, type SendPayload } from "./payloads";
import { isNoreplyAddress } from "./rules";

export const actionTypes = ["move", "mark_read", "flag", "save_summary", "create_draft", "send"] as const;
export type ActionType = (typeof actionTypes)[number];

// The types that change the mailbox (`save_summary` is DB only).
export const MAILBOX_ACTION_TYPES = ["move", "mark_read", "flag"] as const;
export type MailboxActionType = (typeof MAILBOX_ACTION_TYPES)[number];

// The committer turns a key into a folder name through `mailboxes.folder_map`.
export const folderKeys = ["ai_info", "ai_notifications", "ai_spam", "ai_manual"] as const;
export type FolderKey = (typeof folderKeys)[number];

// The default folder names: `mailbox:connect` writes them into `folder_map`; the digest texts show them.
export const AI_FOLDER_NAMES: Record<FolderKey, string> = {
  ai_info: "AI/Info",
  ai_notifications: "AI/Notifications",
  ai_spam: "AI/Spam",
  ai_manual: "AI/Manual",
};

// A move goes to an app folder or back to INBOX (D11, D12).
export const moveTargets = [...folderKeys, "inbox"] as const;
export type MoveTarget = (typeof moveTargets)[number];

export function isMoveTarget(value: unknown): value is MoveTarget {
  return typeof value === "string" && (moveTargets as readonly string[]).includes(value);
}

export const MOVE_TARGET_NAMES: Record<MoveTarget, string> = { ...AI_FOLDER_NAMES, inbox: "INBOX" };

// What the classifier and the delegates list give the planner for a `delegation` mail (D4).
export interface DelegationInput {
  delegateId: string | null;
  delegateName: string | null;
  // The delegate's address from the delegates row.
  to: string | null;
  task: string | null;
  clarification: string | null;
  // YYYY-MM-DD
  dueDate: string | null;
  language: "pl" | "en" | "other";
  senderAddress: string | null;
}

// Move payloads hold only folder keys or `inbox`. Draft and send payloads hold the delegate's address from the delegates row
// or the sender's address, never an address from the LLM text.
export type PlannedAction =
  | { type: "move"; folder: MoveTarget }
  | { type: "mark_read" }
  | { type: "flag" }
  | { type: "save_summary"; summary: string }
  | { type: "create_draft"; draft: DraftPayload }
  | { type: "send"; send: SendPayload; dependsOn: "create_draft" };

function draftAndSend(draft: DraftPayload): PlannedAction[] {
  return [
    { type: "create_draft", draft },
    { type: "send", send: sendPayloadFor(draft), dependsOn: "create_draft" },
  ];
}

// The planner input of a mail that the model called `delegation`; null for any other category. The service and the eval
// build it here, so both plan from the same fields. `delegates` holds the delegates rows (the address of the row).
export function delegationInputOf(
  analysis: Pick<TriageAnalysis, "category" | "fields">,
  delegates: readonly { id: string; name: string; email: string }[],
  senderAddress: string | null
): DelegationInput | null {
  if (analysis.category !== "delegation") return null;
  const delegate = delegates.find((candidate) => candidate.id === analysis.fields.delegate_id);
  return {
    delegateId: delegate?.id ?? null,
    delegateName: delegate?.name ?? null,
    to: delegate?.email ?? null,
    task: analysis.fields.task,
    clarification: analysis.fields.clarification,
    dueDate: analysis.fields.due_date,
    language: analysis.fields.language,
    senderAddress,
  };
}

function planDelegation(input: DelegationInput | undefined): PlannedAction[] {
  if (input === undefined) return [];
  const language = input.language === "other" ? "en" : input.language;
  const { delegateId, delegateName, to, task, clarification, senderAddress } = input;
  if (delegateId && delegateName && to && task) {
    return draftAndSend({
      kind: "delegation",
      delegate_id: delegateId,
      delegate_name: delegateName,
      to: [to],
      task: task.slice(0, TASK_MAX_CHARS),
      due_date: input.dueDate ?? "",
      language,
    });
  }
  if (clarification && senderAddress && ADDRESS_PATTERN.test(senderAddress) && !isNoreplyAddress(senderAddress)) {
    return draftAndSend({
      kind: "clarification",
      to: [senderAddress],
      question: clarification.slice(0, CLARIFICATION_MAX_CHARS),
      language,
    });
  }
  return [];
}

export interface PlanSource {
  // The mail's source_folder is the path of the mailbox's junk row (D11).
  fromJunk: boolean;
}

// The plan for a mail from the spam folder (D11): the normal move gate decides; no flag, no VIP exception.
// A `delegation` mail only moves into INBOX: no draft, no send, no approval (U10).
function planFromJunk(category: Category, summary: string | null): PlannedAction[] {
  switch (category) {
    case "spam":
      return [];
    case "urgent":
    case "needs_reply":
    case "delegation":
      return [{ type: "move", folder: "inbox" }];
    case "info":
      return [
        { type: "save_summary", summary: summary ?? "" },
        { type: "move", folder: "ai_info" },
      ];
    case "notification":
      return [{ type: "mark_read" }, { type: "move", folder: "ai_notifications" }];
    case "unsure":
      return [{ type: "move", folder: "ai_manual" }];
    default: {
      const unknown: never = category;
      throw new Error(`unknown category: ${String(unknown)}`);
    }
  }
}

// The plan in `assist` mode (architecture §4.2). The caller marks the summary with `markUntrustedText` first.
export function planActions(
  category: Category,
  summary: string | null,
  delegation?: DelegationInput,
  source?: PlanSource
): PlannedAction[] {
  if (source?.fromJunk) return planFromJunk(category, summary);
  switch (category) {
    case "urgent":
      return [{ type: "flag" }];
    case "needs_reply":
      return [];
    case "info":
      return [
        { type: "save_summary", summary: summary ?? "" },
        { type: "move", folder: "ai_info" },
      ];
    case "notification":
      return [{ type: "mark_read" }, { type: "move", folder: "ai_notifications" }];
    case "spam":
      return [{ type: "move", folder: "ai_spam" }];
    case "unsure":
      return [{ type: "move", folder: "ai_manual" }];
    case "delegation":
      return planDelegation(delegation);
    default: {
      const unknown: never = category;
      throw new Error(`unknown category: ${String(unknown)}`);
    }
  }
}
