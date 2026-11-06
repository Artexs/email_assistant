import type { Category } from "../triage/categories";

import { encodeCallback, isLabelCategory } from "./callback";
import { formatClock } from "./local-time";
import type { OutButton, OutMessage } from "./message";
import { cleanSubject, cutText, senderLabel } from "./text";

// ✅ (only for a category the user may pick) and ✏️ of one mail.
export function feedbackButtons(
  emailId: string,
  category: Category,
  texts: { right: string; edit: string }
): OutButton[] {
  const edit = { text: texts.edit, data: encodeCallback({ kind: "edit", emailId }) };
  if (!isLabelCategory(category)) return [edit];
  return [{ text: texts.right, data: encodeCallback({ kind: "right", category, emailId }) }, edit];
}

export function renderUrgentNotice(input: {
  emailId: string;
  from: string | null;
  subject: string | null;
  aiText: string | null;
  receivedAt: Date;
  synthetic: boolean;
  wouldDo: string;
  now: Date;
  timeZone: string;
}): OutMessage {
  const lines = [
    `🔴 Urgent mail${input.synthetic ? " · 🧪 test" : ""}`,
    `From: ${senderLabel(input.from)}`,
    `Subject: ${cleanSubject(input.subject)}`,
  ];
  if (input.aiText !== null) lines.push(`💬 ${cutText(input.aiText, 200)}`);
  lines.push(`Received ${formatClock(input.receivedAt, input.timeZone, input.now)}`, `→ ${input.wouldDo}`);
  return {
    text: lines.join("\n"),
    buttons: [feedbackButtons(input.emailId, "urgent", { right: "✅ Right", edit: "✏️ Change" })],
  };
}

export function renderAuthErrorNotice(input: {
  address: string;
  mailboxId: string;
  since: Date;
  now: Date;
  timeZone: string;
}): OutMessage {
  const since = formatClock(input.since, input.timeZone, input.now);
  return {
    text: [
      `❌ Login to ${cutText(input.address, 60)} failed at ${since}.`,
      "The system does not read this mailbox now. No mail is lost: it stays on the mail server.",
      `To fix it: check the password, then run mailbox:password for mailbox ${input.mailboxId} (runbook: deploy/README.md).`,
    ].join("\n"),
    buttons: [],
  };
}

export function renderSyncStaleNotice(input: {
  address: string;
  lastSyncedAt: Date | null;
  now: Date;
  timeZone: string;
}): OutMessage {
  const last = input.lastSyncedAt === null ? "never" : formatClock(input.lastSyncedAt, input.timeZone, input.now);
  return {
    text: [
      `⚠️ Mail sync is late for ${cutText(input.address, 60)}.`,
      `Last good sync: ${last}. The system tries again every 5 minutes.`,
      "/status shows the state.",
    ].join("\n"),
    buttons: [],
  };
}

export function renderSyncOkNotice(input: {
  address: string;
  lastSyncedAt: Date;
  now: Date;
  timeZone: string;
}): OutMessage {
  const last = formatClock(input.lastSyncedAt, input.timeZone, input.now);
  return { text: `✅ Mail sync works again for ${cutText(input.address, 60)}. Last sync ${last}.`, buttons: [] };
}
