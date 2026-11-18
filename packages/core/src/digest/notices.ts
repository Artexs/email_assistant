import type { SendLimitKind } from "../send-limits";
import type { CoreTexts } from "../texts";
import type { ReplyResultKey } from "../texts/notices";
import type { Category } from "../triage/categories";
import type { SenderRuleKind } from "../triage/rules";
import { suspiciousReasons, type SuspiciousReason } from "../triage/suspicious";
import type { MovingCategory, TripReason } from "../trust";
import { mailOAuthProviderNames, type AuthErrorReason, type MailOAuthProviderKey } from "../web/mail-oauth";

import { attachmentLine, type AttachmentLineInput } from "./attachment-line";
import { encodeCallback, isLabelCategory } from "./callback";
import { formatClock } from "./local-time";
import type { OutButton, OutMessage } from "./message";
import { cleanSubject, cutText, senderLabel } from "./text";
import { aiLine, whySuffix } from "./why-line";

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

// The warning line of a suspicious mail, or null when the list is empty. The names follow the order of `suspiciousReasons`.
export function suspiciousLine(reasons: readonly SuspiciousReason[] | undefined, texts: CoreTexts): string | null {
  if (reasons === undefined || reasons.length === 0) return null;
  const names = suspiciousReasons.filter((code) => reasons.includes(code)).map((code) => texts.suspicious.reason[code]);
  return texts.suspicious.line(names.join(", "));
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
    // Old views have no field: they render as before.
    suspicious?: readonly SuspiciousReason[];
    attachments?: AttachmentLineInput;
    // The `why_lines` keys: absent in a view queued with the flag off.
    confidence?: number | null | undefined;
    rule?: SenderRuleKind | null | undefined;
    // The Delegate button shows. Absent: the keyboard of today.
    delegable?: boolean;
    // The Draft reply button shows. Absent: no button.
    draftable?: boolean;
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
  const attachments = input.attachments === undefined ? null : attachmentLine(input.attachments, texts.locale);
  if (attachments !== null) lines.push(attachments);
  const ai = aiLine(
    input.aiText,
    whySuffix({ category: "urgent", confidence: input.confidence, rule: input.rule }, texts),
    200,
    { printEmpty: true }
  );
  if (ai !== null) lines.push(ai);
  const warning = suspiciousLine(input.suspicious, texts);
  if (warning !== null) lines.push(warning);
  lines.push(
    texts.notices.received(formatClock(input.receivedAt, input.timeZone, input.now, texts.locale)),
    `→ ${input.wouldDo}`
  );
  const own = feedbackButtons(input.emailId, "urgent", { right: texts.common.right, edit: texts.common.change });
  const buttons = [
    input.delegable === true
      ? [
          ...own,
          {
            text: texts.loopTaps.buttons.delegate,
            data: encodeCallback({ kind: "delegate_open", emailId: input.emailId }),
          },
        ]
      : own,
  ];
  if (input.draftable === true) {
    buttons.push([
      { text: texts.notices.replyDrafts.draft, data: encodeCallback({ kind: "reply_draft", emailId: input.emailId }) },
    ]);
  }
  return { text: lines.join("\n"), buttons };
}

export function renderAuthErrorNotice(
  input: {
    address: string;
    mailboxId: string;
    // Set for an OAuth mailbox: the fix line names the provider and its reason, not mailbox:password.
    oauth?: { provider: MailOAuthProviderKey; reason: AuthErrorReason | null } | undefined;
    since: Date;
    now: Date;
    timeZone: string;
  },
  texts: CoreTexts
): OutMessage {
  const since = formatClock(input.since, input.timeZone, input.now, texts.locale);
  const { authError } = texts.notices;
  return {
    text: [
      authError.first(cutText(input.address, 60), since),
      authError.noRead,
      input.oauth === undefined
        ? authError.fix(input.mailboxId)
        : authError.fixOAuth(mailOAuthProviderNames[input.oauth.provider], input.oauth.reason),
    ].join("\n"),
    buttons: [],
  };
}

// The mail host guard refuses a host of the mailbox. The view holds no mailbox id, no host name and no network address.
export function renderHostBlockedNotice(
  input: { address: string; since: Date; now: Date; timeZone: string },
  texts: CoreTexts
): OutMessage {
  const since = formatClock(input.since, input.timeZone, input.now, texts.locale);
  return {
    text: [
      texts.notices.hostBlocked.first(cutText(input.address, 60), since),
      texts.notices.hostBlocked.why,
      texts.notices.hostBlocked.noRead,
      texts.notices.hostBlocked.recheck,
    ].join("\n"),
    buttons: [],
  };
}

// Mail of a VIP or whitelisted sender waits for triage during an LLM pause. The sender goes through the
// chat-safe text helper; the view holds no subject and no other mail text.
export function renderNotTriagedNotice(input: { sender: string }, texts: CoreTexts): OutMessage {
  return { text: texts.notices.notTriaged(senderLabel(input.sender, texts)), buttons: [] };
}

// The mailbox shows no sent mail for 7 days. The view holds no recipient and no subject.
export function renderSentMissingNotice(
  input: { address: string; since: Date; now: Date; timeZone: string },
  texts: CoreTexts
): OutMessage {
  const since = formatClock(input.since, input.timeZone, input.now, texts.locale);
  return {
    text: [texts.notices.sentMissing.first(cutText(input.address, 60), since), texts.notices.sentMissing.ask].join(
      "\n"
    ),
    buttons: [],
  };
}

// Sends of one mailbox wait on a send limit. The view holds no limit number: the text names the window.
export function renderSendHeldNotice(
  input: {
    address: string;
    mailboxId: string;
    limit: SendLimitKind;
    waiting: number;
    nextAt: Date;
    now: Date;
    timeZone: string;
    followUps?: boolean | undefined;
    panelUrl?: string | undefined;
  },
  texts: CoreTexts
): OutMessage {
  const held = texts.notices.sendHeld;
  const waiting = held.waiting(input.waiting, formatClock(input.nextAt, input.timeZone, input.now, texts.locale));
  if (input.followUps === true) {
    const lines = [texts.notices.followUp.held(held.limit[input.limit]), waiting];
    if (input.panelUrl !== undefined) lines.push(texts.approvals.panelLine(input.panelUrl));
    return { text: lines.join("\n"), buttons: [] };
  }
  return { text: [held.first(cutText(input.address, 60), held.limit[input.limit]), waiting].join("\n"), buttons: [] };
}

// The one line for an owner whose consent does not cover open-loop data: no recipient, no text, no id.
export function renderLoopConsentNotice(
  input: { about: "approval" | "result"; panelUrl?: string | undefined },
  texts: CoreTexts
): OutMessage {
  const lines = [texts.notices.loopConsent[input.about]];
  if (input.panelUrl !== undefined) lines.push(texts.approvals.panelLine(input.panelUrl));
  return { text: lines.join("\n"), buttons: [] };
}

// Reply drafts. The ready notice is a count and a clock: no mail text, no address. An owner whose consent covers reply data (`review`)
// gets the Review button; the others get the consent line only. The panel link line is added when set.
export function renderRepliesReadyNotice(
  input: { count: number; now: Date; timeZone: string; review: boolean; panelUrl?: string | undefined },
  texts: CoreTexts
): OutMessage {
  const clock = formatClock(input.now, input.timeZone, input.now, texts.locale);
  const lines = [texts.notices.replyDrafts.ready(input.count, clock)];
  if (!input.review) lines.push(texts.notices.replyDrafts.consent);
  if (input.panelUrl !== undefined) lines.push(texts.approvals.panelLine(input.panelUrl));
  return {
    text: lines.join("\n"),
    buttons: input.review
      ? [[{ text: texts.notices.replyDrafts.review, data: encodeCallback({ kind: "reply_review" }) }]]
      : [],
  };
}

// The question after a Redraft tap. The chat client opens the reply box (ForceReply); the user's line is the answer to this message.
export function renderReplyPromptNotice(texts: CoreTexts): OutMessage {
  return { text: texts.notices.replyDrafts.prompt, buttons: [], forceReply: true };
}

// The reasons that share one result text. A reason of the eligibility rule has its own text (`bot.taps.reply.blocked`); a code that
// has neither gets the generic line.
const RESULT_KEY_OF: Record<string, ReplyResultKey> = {
  needs_facts: "needs_facts",
  not_a_reply: "not_a_reply",
  unsafe_request: "unsafe_request",
  no_text: "no_text",
  timeout: "timeout",
  llm_cap: "llm_cap",
  llm_error: "llm_error",
  checks: "checks",
  output: "output",
  internal: "internal",
  closed: "closed",
  changed: "changed",
  feature_off: "off",
  switch_off: "off",
  not_assist: "off",
  mail_gone: "mail_gone",
};

function isBlockReason(reason: string, texts: CoreTexts): reason is keyof CoreTexts["bot"]["taps"]["reply"]["blocked"] {
  return Object.hasOwn(texts.bot.taps.reply.blocked, reason);
}

// The result of a tap or a redraft that ended with no new card: one fixed line for the reason code. No mail text, no address.
export function renderReplyResultNotice(input: { reason: string }, texts: CoreTexts): OutMessage {
  const key = Object.hasOwn(RESULT_KEY_OF, input.reason) ? RESULT_KEY_OF[input.reason] : undefined;
  const text =
    key !== undefined
      ? texts.notices.replyDrafts.results[key]
      : isBlockReason(input.reason, texts)
        ? `✍️ ${texts.bot.taps.reply.blocked[input.reason]}`
        : texts.notices.replyDrafts.results.generic;
  return { text, buttons: [] };
}

// The check of the last 30 days is ready: a count, category names and the report link. No mail data.
export function renderTrustReportReadyNotice(
  input: { checked: number; recommended: readonly MovingCategory[]; reportUrl: string | null },
  texts: CoreTexts
): OutMessage {
  const ready = texts.notices.trustReady;
  const lines = [
    ready.first(input.checked),
    input.recommended.length === 0
      ? ready.none
      : ready.recommended(input.recommended.map((category) => texts.categories[category]).join(", ")),
  ];
  if (input.reportUrl !== null) lines.push(ready.link(input.reportUrl));
  return { text: lines.join("\n"), buttons: [] };
}

// A category lost its `auto`: the category, a fixed reason phrase and the settings link. No mail data.
export function renderAutonomyPausedNotice(
  input: { category: MovingCategory; reason: TripReason; corrections: number; settingsUrl: string | null },
  texts: CoreTexts
): OutMessage {
  const paused = texts.notices.autonomyPaused;
  const category = texts.categories[input.category];
  const first = {
    corrections: () => paused.corrections(category, input.corrections),
    important_hidden: () => paused.importantHidden(category),
    model_switch: () => paused.modelSwitch(category),
    evidence_changed: () => paused.evidenceChanged(category),
    history_fail: () => paused.historyFail(category),
  }[input.reason]();
  const lines = [first, paused.again];
  if (input.settingsUrl !== null) lines.push(paused.link(input.settingsUrl));
  return { text: lines.join("\n"), buttons: [] };
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
export type ActionFailedInput =
  | {
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
    }
  | { followUp: { cause: "failed" | "unknown"; panelUrl?: string | undefined } };

export function renderActionFailedNotice(input: ActionFailedInput, texts: CoreTexts): OutMessage {
  if ("followUp" in input) {
    const lines = [texts.notices.followUp[input.followUp.cause]];
    if (input.followUp.panelUrl !== undefined) lines.push(texts.approvals.panelLine(input.followUp.panelUrl));
    return { text: lines.join("\n"), buttons: [] };
  }
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
