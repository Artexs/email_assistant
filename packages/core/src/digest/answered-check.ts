import type { CoreTexts } from "../texts";
import type { Category } from "../triage/categories";

import { encodeCallback } from "./callback";
import { categoryTag } from "./labels";
import { MESSAGE_MAX_CHARS, type OutButton, type OutMessage } from "./message";
import { cleanSubject, senderLabel } from "./text";

// The block at the end of the /review page: mails the user answered that the assistant did not mark "needs reply".
export const ANSWERED_CHECK_LIMIT = 5;

export interface AnsweredItem {
  emailId: string;
  category: Category;
  from: string | null;
  subject: string | null;
  receivedAt: Date;
}

// `now` and `timeZone` stay in the options for the callers that print a time; the block shows none today.
export interface AnsweredCheckOptions {
  now: Date;
  timeZone: string;
}

/** The block appended to the /review page. No items → null (no block). */
export function renderAnsweredCheck(
  items: readonly AnsweredItem[],
  _opts: AnsweredCheckOptions,
  texts: CoreTexts
): OutMessage | null {
  if (items.length === 0) return null;
  const lines = [texts.review.answered.block(items.length)];
  const buttons: OutButton[][] = [];
  items.forEach((item, index) => {
    const n = index + 1;
    lines.push(
      "",
      `${n}. ${categoryTag(item.category, texts)} · ${senderLabel(item.from, texts)}`,
      cleanSubject(item.subject, texts)
    );
    buttons.push([
      {
        text: texts.review.answered.yesButton(n),
        data: encodeCallback({ kind: "answered_yes", emailId: item.emailId }),
      },
      { text: texts.review.answered.noButton(n), data: encodeCallback({ kind: "answered_no", emailId: item.emailId }) },
    ]);
  });
  return { text: lines.join("\n"), buttons };
}

/** The page and the block in one message of at most MESSAGE_MAX_CHARS: block items go from the end until it fits; none left → the page alone. */
export function withAnsweredCheck(
  page: OutMessage,
  items: readonly AnsweredItem[],
  opts: AnsweredCheckOptions,
  texts: CoreTexts
): OutMessage {
  const kept = [...items];
  while (kept.length > 0) {
    const block = renderAnsweredCheck(kept, opts, texts);
    if (block === null) break;
    const text = `${page.text}\n\n${block.text}`;
    if (text.length <= MESSAGE_MAX_CHARS) return { text, buttons: [...page.buttons, ...block.buttons] };
    kept.pop();
  }
  return page;
}
