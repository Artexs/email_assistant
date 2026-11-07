import type { Category, MailboxMode } from "./categories";
import type { PlannedAction } from "./planners";
import type { ToolSwitches } from "./settings";

// Only a `send` gets `await_approval`.
export type PolicyDecision = "apply" | "await_approval" | "log_only";

export interface PolicyInput {
  mode: MailboxMode;
  toolSwitches: ToolSwitches;
  category: Category;
  // The category passed go/no-go and the user turned it on (`autoFor`). The caller computes it.
  categoryAuto: boolean;
  vip: boolean;
  // The mailbox has MOVE or UIDPLUS (architecture §6.1). The caller computes it.
  movesSupported: boolean;
}

function draftDecision({ mode, toolSwitches }: PolicyInput): PolicyDecision {
  return mode === "assist" && toolSwitches.create_draft ? "apply" : "log_only";
}

// The policy table of architecture §4.3. Each `apply` needs its own conditions; there is no default `apply`.
export function decidePolicy(action: PlannedAction, input: PolicyInput): PolicyDecision {
  const { mode, toolSwitches, category, categoryAuto, vip, movesSupported } = input;
  switch (action.type) {
    case "save_summary":
      return "apply";
    case "move": {
      if (mode !== "assist" || vip) return "log_only";
      const allowed =
        category === "unsure"
          ? toolSwitches.move_unsure && movesSupported
          : toolSwitches.move && categoryAuto && movesSupported;
      return allowed ? "apply" : "log_only";
    }
    case "mark_read":
      if (mode !== "assist" || vip) return "log_only";
      return toolSwitches.mark_read && categoryAuto ? "apply" : "log_only";
    case "flag":
      if (mode !== "assist") return "log_only";
      return toolSwitches.flag ? "apply" : "log_only";
    case "create_draft":
      return draftDecision(input);
    // The send never applies on its own: it waits for approval when the draft of the same input applies.
    case "send":
      return draftDecision(input) === "apply" ? "await_approval" : "log_only";
    default: {
      const unknown: never = action;
      throw new Error(`unknown action type: ${String((unknown as { type: unknown }).type)}`);
    }
  }
}

export function actionStatusFor(decision: PolicyDecision): "ready" | "awaiting_approval" | "logged" {
  switch (decision) {
    case "apply":
      return "ready";
    case "await_approval":
      return "awaiting_approval";
    case "log_only":
      return "logged";
    default: {
      const unknown: never = decision;
      throw new Error(`unknown policy decision: ${String(unknown)}`);
    }
  }
}
