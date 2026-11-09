import type { Category } from "../triage/categories";

import { encodeCallback, isLabelCategory } from "./callback";
import { formatClock } from "./local-time";
import type { OutButton, OutMessage } from "./message";
import { cleanSubject, cutText, senderLabel } from "./text";

// ✅ (only for a category the user may pick), ✏️ and, with `undo` text, ↩️ of one mail.
export function feedbackButtons(
  emailId: string,
  category: Category,
  texts: { right: string; edit: string; undo?: string }
): OutButton[] {
  const edit = { text: texts.edit, data: encodeCallback({ kind: "edit", emailId }) };
  const undo = texts.undo === undefined ? [] : [{ text: texts.undo, data: encodeCallback({ kind: "undo", emailId }) }];
  if (!isLabelCategory(category)) return [edit, ...undo];
  return [{ text: texts.right, data: encodeCallback({ kind: "right", category, emailId }) }, edit, ...undo];
}

export function renderUrgentNotice(input: {
  emailId: string;
  from: string | null;
  subject: string | null;
  aiText: string | null;
  receivedAt: Date;
  synthetic: boolean;
  folderTag: string | null;
  wouldDo: string;
  now: Date;
  timeZone: string;
}): OutMessage {
  const lines = [
    `🔴 Urgent mail${input.folderTag === null ? "" : ` · 📁 ${cutText(input.folderTag, 30)}`}${input.synthetic ? " · 🧪 test" : ""}`,
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

const FAILED_FIRST_LINE = {
  move: { original: "Could not move a mail", reverse: "Undo failed: could not move a mail back to" },
  flag: { original: "Could not flag a mail", reverse: "Undo failed: could not remove the flag" },
  mark_read: { original: "Could not mark a mail read", reverse: "Undo failed: could not mark a mail unread" },
  create_draft: { original: "Could not create a draft", reverse: "Could not remove the draft for a mail" },
} as const;

// Plain text, no buttons. The action's mail stays where it was (an original) or where the system put it (a reverse).
export function renderActionFailedNotice(input: {
  actionType: "move" | "flag" | "mark_read" | "create_draft";
  reverse: boolean;
  reason: "mail_not_found" | "bad_payload" | "other";
  folderName: string | null;
  sourceFolder: string;
  currentFolder: string;
  from: string | null;
  subject: string | null;
  synthetic: boolean;
  attempts: number;
}): OutMessage {
  const folder = input.folderName === null ? null : cutText(input.folderName, 60);
  let first = `⚠️ ${FAILED_FIRST_LINE[input.actionType][input.reverse ? "reverse" : "original"]}`;
  if (input.reverse && input.actionType === "move") first = `${first} ${cutText(input.sourceFolder, 30)}`;
  if (!input.reverse && input.actionType === "move" && folder !== null && input.reason !== "bad_payload") {
    first = `${first} to ${folder}`;
  }
  const tried = `Tried ${input.attempts} ${input.attempts === 1 ? "time" : "times"}.`;
  let last: string;
  if (input.reverse && input.reason === "mail_not_found") {
    last = "The mail was not found: it was moved or deleted in the mail client.";
  } else if (input.reason === "bad_payload") {
    last = `The plan had an unknown folder. The mail stays in ${cutText(input.currentFolder, 30)}.`;
  } else if (input.reverse) {
    let where = "";
    if (input.actionType === "move") where = ` The mail stays in ${folder ?? "its AI folder"}: move it by hand.`;
    if (input.actionType === "create_draft") where = " The draft stays in Drafts: delete it by hand.";
    last = `${tried}${where} /status shows the mailbox state.`;
  } else {
    const where = input.actionType === "move" ? ` The mail stays in ${cutText(input.currentFolder, 30)}.` : "";
    last = `${tried}${where} /status shows the mailbox state.`;
  }
  const lines = [first];
  if (input.synthetic) lines.push("🧪 test");
  lines.push(`From: ${senderLabel(input.from)}`, `Subject: ${cleanSubject(input.subject)}`, last);
  return { text: lines.join("\n"), buttons: [] };
}
