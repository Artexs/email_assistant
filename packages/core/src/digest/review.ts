import type { CoreTexts } from "../texts";
import type { Category } from "../triage/categories";

import { encodeCallback, isReviewLabelCategory } from "./callback";
import { categoryTag } from "./labels";
import { formatClock } from "./local-time";
import { MESSAGE_MAX_CHARS, type OutButton, type OutMessage } from "./message";
import { cleanSubject, cutText, senderLabel } from "./text";

// One mail of the /review page. No body field: the page shows the AI summary only (ADR 0005).
export interface ReviewItem {
  emailId: string;
  category: Category;
  from: string | null;
  subject: string | null;
  receivedAt: Date;
  aiText: string | null;
}

// The page of F097 D4, D6: a numbered block and a row of ✅ / ✏️ buttons per item. The review kinds of the callbacks record the source `review`.
export function renderReviewPage(
  input: { items: readonly ReviewItem[]; now: Date; timeZone: string },
  texts: CoreTexts
): OutMessage {
  const listed = [...input.items];
  if (listed.length === 0) return { text: texts.review.empty, buttons: [] };
  for (;;) {
    const message = renderListed(listed, input, texts);
    if (message.text.length <= MESSAGE_MAX_CHARS) return message;
    listed.pop();
  }
}

function renderListed(
  listed: readonly ReviewItem[],
  input: { now: Date; timeZone: string },
  texts: CoreTexts
): OutMessage {
  const lines = [texts.review.header(listed.length)];
  const buttons: OutButton[][] = [];
  listed.forEach((item, index) => {
    const n = index + 1;
    const clock = formatClock(item.receivedAt, input.timeZone, input.now, texts.locale);
    lines.push(
      "",
      `${n}. ${categoryTag(item.category, texts)} · ${senderLabel(item.from, texts)} · ${clock}`,
      cleanSubject(item.subject, texts)
    );
    if (item.aiText !== null && item.aiText !== "") lines.push(`💬 ${cutText(item.aiText, 120)}`);
    const edit = { text: `✏️ ${n}`, data: encodeCallback({ kind: "review_edit", emailId: item.emailId }) };
    const { category, emailId } = item;
    buttons.push(
      isReviewLabelCategory(category)
        ? [{ text: `✅ ${n}`, data: encodeCallback({ kind: "review_right", category, emailId }) }, edit]
        : [edit]
    );
  });
  return { text: lines.join("\n"), buttons };
}
