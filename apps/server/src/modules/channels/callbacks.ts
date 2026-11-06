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
import { getLabelTarget, recordFeedback } from "../triage";

import type { CallbackResult, LinkedChat } from "./port";

export interface CallbackDeps {
  db: Db | Transaction<DB>;
  now(): Date;
}

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
    return { answer: "This mail is not in your account." };
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
