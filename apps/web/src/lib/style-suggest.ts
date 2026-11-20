import { styleSuggestionAnswerSchema, styleSuggestionConflictSchema, type SentTracking } from "@ea/core/web";

import type { TextKey } from "../i18n";

import { api, ApiError } from "./api";
import { profilePath, previewFailureKey } from "./reply-style";

// The button "Suggest my style from my sent mail" on the style card: when it shows, and the texts of each answer of
// `POST /api/mailboxes/:id/profile/style-suggestion`. The suggestion is text for the owner to edit; nothing is saved by it.

export interface SuggestGate {
  isOwner: boolean;
  // The flags `reply_drafts` and `style_from_sent` of the organization (`/api/me` `features`).
  replyDraftsOn: boolean;
  styleFromSentOn: boolean;
  // The "Track my sent mail" state of this mailbox, from its settings view.
  sentTracking: SentTracking;
  // An OAuth mailbox has no reply drafts yet, as the reply drafts switch says.
  oauth: boolean;
}

// `hidden`: a member, or a flag is off. `off`: the button is not usable and the line says why.
export type SuggestButton = { kind: "hidden" } | { kind: "active" } | { kind: "off"; key: TextKey };

export function suggestButton(gate: SuggestGate): SuggestButton {
  if (!gate.isOwner || !gate.replyDraftsOn || !gate.styleFromSentOn) return { kind: "hidden" };
  if (gate.oauth) return { kind: "off", key: "rs_switch_oauth" };
  if (gate.sentTracking !== "on") return { kind: "off", key: "rs_suggest_sent_off" };
  return { kind: "active" };
}

// `suggestion`: the text and the number of sent mails that it read. `note`: an answer without a suggestion; `count` fills
// `rs_suggest_too_few`.
export type SuggestAnswer =
  | { kind: "suggestion"; text: string; count: number }
  | { kind: "note"; key: TextKey; count?: number };

// A 429 is an answer, as a 409 is: the code says which.
const limitKeys: Record<string, TextKey> = {
  suggest_limit: "rs_suggest_limit",
  suggest_busy: "rs_suggest_busy",
};

// The reason of a failed suggestion is a code of the server: the texts of the preview serve `llm_off` and `llm_cap`; the others
// ask the owner to try later.
export function suggestFailureKey(reason: string): TextKey {
  const key = previewFailureKey(reason);
  return key === "rs_preview_failed" ? "rs_suggest_failed" : key;
}

function refusal(error: unknown): SuggestAnswer | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 429 && Object.hasOwn(limitKeys, error.code)) {
    return { kind: "note", key: limitKeys[error.code] ?? "rs_suggest_failed" };
  }
  if (error.status !== 409) return null;
  const conflict = styleSuggestionConflictSchema.safeParse(error.raw);
  if (!conflict.success) return null;
  switch (conflict.data.error) {
    case "sent_off":
      return { kind: "note", key: "rs_suggest_sent_off" };
    case "too_few":
      return { kind: "note", key: "rs_suggest_too_few", count: conflict.data.count };
    case "blocked":
      return { kind: "note", key: "rs_switch_oauth" };
  }
}

// Asks once. Any error that is not an answer (a 500, a lost connection) is thrown.
export async function suggestStyle(mailboxId: string, request: typeof api = api): Promise<SuggestAnswer> {
  try {
    const answer = await request(profilePath(mailboxId, "/style-suggestion"), styleSuggestionAnswerSchema, {
      method: "POST",
      body: {},
    });
    return "text" in answer
      ? { kind: "suggestion", text: answer.text, count: answer.count }
      : { kind: "note", key: suggestFailureKey(answer.reason) };
  } catch (error) {
    const answer = refusal(error);
    if (answer !== null) return answer;
    throw error;
  }
}
