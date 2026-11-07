import {
  categoryLabels,
  categoryTag,
  cleanSubject,
  encodeCallback,
  labelCategories,
  parseCallback,
  type Category,
  type OutMessage,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db } from "../../platform/db";
import { undo, type ActionsScope, type UndoResult } from "../actions";
import { getLabelTarget, recordFeedback } from "../triage";

import type { CallbackResult, LinkedChat } from "./port";

export interface CallbackDeps {
  db: Db | Transaction<DB>;
  now(): Date;
  actionsScope: ActionsScope;
}

export const UNDO_TEXTS: Record<Exclude<UndoResult["kind"], "not_found">, string> = {
  started: "↩️ Undo started: the mail goes back within a minute.",
  already: "Undo was already requested for this mail.",
  nothing: "Nothing to undo.",
  too_old: "Too old to undo (7 days).",
  held: "Undo is not possible now: mailbox changes are off or the mailbox is paused.",
};

const NOT_FOUND_TEXT = "This mail is not in your account.";

const label = (category: Category): string => categoryLabels[category].name;

export function pickerMessage(emailId: string, subject: string | null, current: Category): OutMessage {
  const pick = (category: (typeof labelCategories)[number]) => ({
    text: categoryTag(category),
    data: encodeCallback({ kind: "pick", category, emailId }),
  });
  return {
    text: `✏️ Pick the right category\n${cleanSubject(subject)}\nAI said: ${categoryTag(current)}`,
    buttons: [
      [pick("urgent"), pick("needs_reply")],
      [pick("info"), pick("notification")],
      [pick("spam"), { text: "✖️ Cancel", data: encodeCallback({ kind: "cancel", emailId }) }],
    ],
  };
}

// The tenant comes from the link. An unknown mail id and a mail of another organization give the same answer.
export async function handleCallback(deps: CallbackDeps, link: LinkedChat, data: string): Promise<CallbackResult> {
  const callback = parseCallback(data);
  if (callback === null) {
    return { answer: "This button is not valid any more." };
  }
  if (callback.kind === "cancel") {
    return { answer: "", edit: { text: "✏️ Cancelled.", buttons: [] } };
  }
  const ctx = { orgId: link.orgId, userId: link.userId };
  const target = await getLabelTarget(deps.db, ctx, callback.emailId);
  if (!target) {
    return { answer: NOT_FOUND_TEXT };
  }
  if (callback.kind === "undo") {
    // One transaction: a feedback failure rolls back the reverse rows, so the user can tap again.
    const run = async (trx: Transaction<DB>) => {
      const undone = await undo(trx, ctx, callback.emailId, {
        now: deps.now(),
        userId: link.userId,
        scope: deps.actionsScope,
      });
      // keepLabel: a ✏️ label with a true category stays the latest feedback row. An unsure mail has no wrong category to record.
      if (undone.kind === "started" && target.category !== "unsure") {
        await recordFeedback(trx, ctx, {
          emailId: callback.emailId,
          verdict: "wrong",
          source: "undo",
          userId: link.userId,
          skipIfSame: true,
          keepLabel: true,
        });
      }
      return undone;
    };
    const result = await (deps.db.isTransaction ? run(deps.db as Transaction<DB>) : deps.db.transaction().execute(run));
    if (result.kind === "not_found") return { answer: NOT_FOUND_TEXT };
    return { answer: UNDO_TEXTS[result.kind] };
  }
  if (callback.kind === "edit") {
    return { answer: "", send: pickerMessage(callback.emailId, target.subject, target.category) };
  }
  const saved = await recordFeedback(deps.db, ctx, {
    emailId: callback.emailId,
    trueCategory: callback.category,
    source: "telegram",
    userId: link.userId,
    skipIfSame: true,
  });
  if (callback.kind === "right") {
    return { answer: saved.saved ? `✅ Saved: ${label(callback.category)} is right.` : "Already saved." };
  }
  return {
    answer: saved.saved ? "Saved." : "Already saved.",
    edit: { text: `✏️ Saved: ${label(callback.category)} (AI said ${label(target.category)}).`, buttons: [] },
  };
}
