import { parseToolSwitches, type Category } from "@ea/core";

import type { TenantContext } from "../../platform/db";
import { listDelegates } from "../delegation";
import { isFeatureOn } from "../tenancy";

import type { DbOrTrx } from "./repo";

// Where the Delegate button shows (questions.md 6). The button is a hint: `delegateMail` checks every rule again
// when the user picks a delegate.

// The categories of the action section of the digest that a user may hand to a delegate. `delegation` has its delegate already.
const DELEGABLE_CATEGORIES: readonly Category[] = ["urgent", "needs_reply", "unsure"];

export function delegableCategory(category: Category): boolean {
  return DELEGABLE_CATEGORIES.includes(category);
}

// The mailbox plans a draft for a tap: it is in `assist` and its `create_draft` switch is on. No settings row: no drafts.
export function draftsAvailable(settings: { mode: string; tool_switches: unknown } | undefined): boolean {
  return settings !== undefined && settings.mode === "assist" && parseToolSwitches(settings.tool_switches).create_draft;
}

// The organization part of the rule: the flag `delegate_button` is on and an active delegate exists.
export async function delegateButtonOn(db: DbOrTrx, ctx: TenantContext): Promise<boolean> {
  if (!(await isFeatureOn(db, ctx, "delegate_button"))) return false;
  return (await listDelegates(db, ctx, { activeOnly: true, limit: 1 })).length > 0;
}
