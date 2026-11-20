import { type CoreTexts } from "../texts";
import type { DraftPayload } from "../triage/payloads";

import { mistakeButton } from "./action-feedback";
import { FIELD_MAX_CHARS } from "./approval-text";
import { encodeCallback } from "./callback";
import { formatClock } from "./local-time";
import { type OutMessage } from "./message";
import { cleanSubject, cutText } from "./text";

function recipientLabel(recipient: { name: string | null; address: string }): string {
  const address = cutText(recipient.address, FIELD_MAX_CHARS);
  const name = recipient.name === null ? "" : cutText(recipient.name, FIELD_MAX_CHARS);
  return name === "" ? address : `${name} ${address}`;
}

export type SendResultKind =
  | { kind: "sent"; sentCopy: "appended" | "found" | "failed"; draftRemoved: boolean }
  | { kind: "rejected_by_server"; stage: string; responseCode: number | null }
  | {
      kind: "failed";
      cause: "tries" | "content_soft" | "soft_cap" | "compose" | "bad_payload" | "copy_check" | "has_gaps";
      code: string | null;
      tries: number;
    }
  | { kind: "outcome_unknown" }
  | {
      kind: "expired";
      reason:
        | "timeout"
        | "draft_missing"
        | "not_notified"
        | "not_seen"
        | "held_timeout"
        | "delegation_closed"
        | "policy_changed"
        | "loop_closed"
        | "draft_changed"
        // The reasons that only a reply send has: the mail was answered, a newer mail came, the mail moved or turned suspicious.
        | "answered"
        | "sent_by_user"
        | "newer_mail"
        | "original_moved"
        | "suspicious";
      draftRemoved: boolean;
    }
  | { kind: "rejected"; byName: string | null; draftRemoved: boolean };

const REPLY_ONLY_REASONS: readonly string[] = [
  "answered",
  "sent_by_user",
  "newer_mail",
  "original_moved",
  "suspicious",
];

type ExpiredReason = Extract<SendResultKind, { kind: "expired" }>["reason"];
type FollowUpReason = Exclude<
  ExpiredReason,
  "answered" | "sent_by_user" | "newer_mail" | "original_moved" | "suspicious"
>;

function isFollowUpReason(reason: ExpiredReason): reason is FollowUpReason {
  return !REPLY_ONLY_REASONS.includes(reason);
}

function words(...parts: string[]): string {
  return parts.filter((part) => part !== "").join(" ");
}

function causeLine(result: Extract<SendResultKind, { kind: "failed" }>, texts: CoreTexts): string {
  const code = result.code === null ? "" : cutText(result.code, 40);
  const causes = texts.approvals.causes;
  switch (result.cause) {
    case "tries":
      return causes.tries(result.tries, code);
    case "content_soft":
      return causes.contentSoft(code);
    case "soft_cap":
      return causes.softCap(code);
    case "compose":
      return causes.compose(result.tries);
    case "copy_check":
      return causes.copyCheck(code);
    case "bad_payload":
      return causes.badPayload;
    case "has_gaps":
      return causes.hasGaps;
  }
}

// The result line of a follow-up (open loops): sent, rejected or expired. It names the first recipient (a sent mail) and no
// subject or text. A failed send is not a result line: the owner gets the fixed `action_failed` notice of a follow-up.
function renderFollowUpResult(
  input: {
    sendKind: DraftPayload["kind"];
    result: SendResultKind;
    recipient: { name: string | null; address: string };
    synthetic: boolean;
  },
  texts: CoreTexts
): OutMessage {
  const t = texts.approvals.followUp;
  const { result } = input;
  let line: string;
  switch (result.kind) {
    case "sent":
      line = t.sent(cutText(input.recipient.address, FIELD_MAX_CHARS));
      break;
    case "rejected":
      line = t.rejected(result.byName === null ? null : cutText(result.byName, FIELD_MAX_CHARS));
      break;
    case "expired":
      // A follow-up never ends with a reason of the reply drafts: no text exists for it.
      if (!isFollowUpReason(result.reason)) throw new RangeError("a follow-up has no text for this reason");
      line = t.expired[result.reason];
      break;
    default:
      throw new RangeError("a failed follow-up has no result line");
  }
  return { text: input.synthetic ? `${line} · ${texts.common.test}` : line, buttons: [] };
}

export function renderSendResult(
  input: {
    actionId: string;
    sendKind: DraftPayload["kind"];
    result: SendResultKind;
    recipient: { name: string | null; address: string };
    subject: string;
    synthetic: boolean;
    mistakeButton?: boolean;
  },
  texts: CoreTexts
): OutMessage {
  const { actionId, sendKind, result, recipient } = input;
  const t = texts.approvals;
  if (sendKind === "follow_up") return renderFollowUpResult(input, texts);
  const to = recipientLabel(recipient);
  const subject = cleanSubject(input.subject, texts);
  const closing = sendKind === "clarification" || sendKind === "reply" ? "" : t.closings[sendKind];
  const sendAgain: OutMessage["buttons"] = [
    [{ text: t.buttons.sendAgain, data: encodeCallback({ kind: "send_again", actionId }) }],
  ];
  const draftText = (draftRemoved: boolean): string => (draftRemoved ? t.draftRemoved : t.draftStays);

  let first: string;
  let rest: string[] = [];
  let buttons: OutMessage["buttons"] = [];
  switch (result.kind) {
    case "sent":
      first = t.sendResult.sent(to, subject);
      if (result.sentCopy === "failed") rest.push(t.sendResult.copyFailed);
      if (!result.draftRemoved) rest.push(t.sendResult.draftStaysNoUid);
      if (input.mistakeButton === true) buttons = mistakeButton(actionId, texts);
      break;
    case "rejected_by_server":
      first = t.sendResult.notSent(to, subject);
      rest = [words(t.sendResult.refused(cutText(result.stage, 40), result.responseCode), closing)];
      break;
    case "failed":
      first = t.sendResult.notSent(to, subject);
      rest = [words(t.sendResult.failedStays(causeLine(result, texts)), closing)];
      if (result.cause !== "bad_payload" && result.cause !== "has_gaps") buttons = sendAgain;
      break;
    case "outcome_unknown":
      first = t.sendResult.unknown(to, subject);
      rest = [words(t.sendResult.unknownRest, closing)];
      // A delegation send that went out stays `cancelled` until the owner says so: only it has a delegation to restore.
      buttons =
        sendKind === "delegation"
          ? [...sendAgain, [{ text: t.buttons.wentOut, data: encodeCallback({ kind: "went_out", actionId }) }]]
          : sendAgain;
      break;
    case "expired": {
      const draft = draftText(result.draftRemoved);
      const both = [words(closing, draft)];
      first =
        sendKind === "reply" && result.reason === "timeout"
          ? t.sendResult.expired.timeoutReply(subject)
          : t.sendResult.expired[result.reason](subject);
      // These two reasons say less: no draft line for a missing draft, no closing for a closed delegation.
      // A missing copy and a send from the mail client say less too: the draft is not in Drafts, so no draft line.
      if (result.reason === "draft_missing" || result.reason === "sent_by_user") rest = [closing];
      else if (result.reason === "delegation_closed") rest = [draft];
      else rest = both;
      break;
    }
    case "rejected": {
      const by = result.byName === null ? null : cutText(result.byName, FIELD_MAX_CHARS);
      first = t.sendResult.rejected(by, subject);
      rest = [words(closing, draftText(result.draftRemoved))];
      break;
    }
  }
  const lines = [input.synthetic ? `${first} · ${texts.common.test}` : first, ...rest.filter((line) => line !== "")];
  return { text: lines.join("\n"), buttons };
}

export function renderDelegationAnswered(
  input: {
    delegationId: string;
    delegateName: string;
    subject: string | null;
    receivedAt: Date;
    now: Date;
    timeZone: string;
    synthetic: boolean;
  },
  texts: CoreTexts
): OutMessage {
  const title = texts.approvals.answered.title(
    cutText(input.delegateName, FIELD_MAX_CHARS),
    cleanSubject(input.subject, texts)
  );
  const received = formatClock(input.receivedAt, input.timeZone, input.now, texts.locale);
  return {
    text: [
      input.synthetic ? `${title} · ${texts.common.test}` : title,
      `${texts.notices.received(received)}. ${texts.approvals.answered.tapDone}`,
    ].join("\n"),
    buttons: [
      [
        {
          text: texts.approvals.buttons.done,
          data: encodeCallback({ kind: "delegation_done", delegationId: input.delegationId }),
        },
      ],
    ],
  };
}
