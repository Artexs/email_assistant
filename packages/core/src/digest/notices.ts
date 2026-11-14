import type { SendLimitKind } from "../send-limits";
import type { CoreTexts } from "../texts";
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

export function renderUrgentNotice(
  input: {
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
  },
  texts: CoreTexts
): OutMessage {
  const lines = [
    `${texts.notices.urgentTitle}${input.folderTag === null ? "" : ` · 📁 ${cutText(input.folderTag, 30)}`}${input.synthetic ? ` · ${texts.common.test}` : ""}`,
    `${texts.common.from}: ${senderLabel(input.from, texts)}`,
    `${texts.common.subject}: ${cleanSubject(input.subject, texts)}`,
  ];
  if (input.aiText !== null) lines.push(`💬 ${cutText(input.aiText, 200)}`);
  lines.push(
    texts.notices.received(formatClock(input.receivedAt, input.timeZone, input.now, texts.locale)),
    `→ ${input.wouldDo}`
  );
  return {
    text: lines.join("\n"),
    buttons: [feedbackButtons(input.emailId, "urgent", { right: texts.common.right, edit: texts.common.change })],
  };
}

export function renderAuthErrorNotice(
  input: {
    address: string;
    mailboxId: string;
    since: Date;
    now: Date;
    timeZone: string;
  },
  texts: CoreTexts
): OutMessage {
  const since = formatClock(input.since, input.timeZone, input.now, texts.locale);
  return {
    text: [
      texts.notices.authError.first(cutText(input.address, 60), since),
      texts.notices.authError.noRead,
      texts.notices.authError.fix(input.mailboxId),
    ].join("\n"),
    buttons: [],
  };
}

const SEND_HELD_LIMIT_TEXT: Record<SendLimitKind, string> = {
  mailbox_hour: "the hourly send limit of this mailbox is reached",
  mailbox_day: "the daily send limit of this mailbox is reached",
  recipient_day: "the daily limit for one recipient is reached",
};

// Sends of one mailbox wait on a send limit (PD-044). The view holds no limit number: the text names the window.
export function renderSendHeldNotice(input: {
  address: string;
  mailboxId: string;
  limit: SendLimitKind;
  waiting: number;
  nextAt: Date;
  now: Date;
  timeZone: string;
}): OutMessage {
  return {
    text: [
      `⏸ Sends from ${cutText(input.address, 60)} wait: ${SEND_HELD_LIMIT_TEXT[input.limit]}.`,
      `${input.waiting} waiting; the next one goes out at about ${formatClock(input.nextAt, input.timeZone, input.now, "en")}.`,
    ].join("\n"),
    buttons: [],
  };
}

export function renderSyncStaleNotice(
  input: {
    address: string;
    lastSyncedAt: Date | null;
    now: Date;
    timeZone: string;
  },
  texts: CoreTexts
): OutMessage {
  const last =
    input.lastSyncedAt === null
      ? texts.notices.syncStale.never
      : formatClock(input.lastSyncedAt, input.timeZone, input.now, texts.locale);
  return {
    text: [
      texts.notices.syncStale.first(cutText(input.address, 60)),
      texts.notices.syncStale.last(last),
      texts.notices.syncStale.status,
    ].join("\n"),
    buttons: [],
  };
}

export function renderSyncOkNotice(
  input: {
    address: string;
    lastSyncedAt: Date;
    now: Date;
    timeZone: string;
  },
  texts: CoreTexts
): OutMessage {
  const last = formatClock(input.lastSyncedAt, input.timeZone, input.now, texts.locale);
  return { text: texts.notices.syncOk(cutText(input.address, 60), last), buttons: [] };
}

// Plain text, no buttons. The action's mail stays where it was (an original) or where the system put it (a reverse).
export function renderActionFailedNotice(
  input: {
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
  },
  texts: CoreTexts
): OutMessage {
  const failed = texts.notices.actionFailed;
  const folder = input.folderName === null ? null : cutText(input.folderName, 60);
  let first = `⚠️ ${failed.first[input.actionType][input.reverse ? "reverse" : "original"]}`;
  if (input.reverse && input.actionType === "move") first = `${first} ${cutText(input.sourceFolder, 30)}`;
  if (!input.reverse && input.actionType === "move" && folder !== null && input.reason !== "bad_payload") {
    first = `${first}${failed.toFolder(folder)}`;
  }
  const tried = failed.tried(input.attempts);
  let last: string;
  if (input.reverse && input.reason === "mail_not_found") {
    last = failed.notFound;
  } else if (input.reason === "bad_payload") {
    last = failed.badPayload(cutText(input.currentFolder, 30));
  } else if (input.reverse) {
    let where = "";
    if (input.actionType === "move") where = failed.staysInAiFolder(folder);
    if (input.actionType === "create_draft") where = failed.draftStays;
    last = [tried, where, failed.status].filter((part) => part !== "").join(" ");
  } else {
    const where = input.actionType === "move" ? failed.staysIn(cutText(input.currentFolder, 30)) : "";
    last = [tried, where, failed.status].filter((part) => part !== "").join(" ");
  }
  const lines = [first];
  if (input.synthetic) lines.push(texts.common.test);
  lines.push(
    `${texts.common.from}: ${senderLabel(input.from, texts)}`,
    `${texts.common.subject}: ${cleanSubject(input.subject, texts)}`,
    last
  );
  return { text: lines.join("\n"), buttons: [] };
}
