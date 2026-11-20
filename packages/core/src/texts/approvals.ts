import type { RejectReason } from "../metrics/m3";
import type { UserLocale } from "../tenancy";

import { approvalsEn } from "./approvals-en";
import { approvalsPl } from "./approvals-pl";

// One entry per fixed string or line of the approval cards, the send results, the answered-delegation card and the
// status line after a tap. A function holds the values of the line. A name or an address never gets a case ending.
export interface ApprovalTexts {
  title: {
    delegation: (to: string) => string; // `to` = "<name> <address>" or "<address>"
    clarification: (address: string) => string;
    reminder: (to: string) => string;
    reply: (address: string) => string; // a reply draft: the sender's address
  };
  // The card, the result lines and the closing lines of a follow-up (open loops). A follow-up goes to other people, so the card
  // spells out every address; no text here names the loop or its ask.
  followUp: {
    title: string;
    to: string; // "To:"
    cc: string; // "Cc:"
    number: (n: number) => string; // "Follow-up 1 of 2"
    sent: (to: string) => string;
    rejected: (byName: string | null) => string;
    expired: Record<
      | "timeout"
      | "draft_missing"
      | "not_notified"
      | "not_seen"
      | "held_timeout"
      | "delegation_closed"
      | "policy_changed"
      | "loop_closed"
      | "draft_changed",
      string
    >;
  };
  // The review card of a reply draft: the lines that only a reply has, and its Skip button.
  reply: {
    to: string; // "To:"
    cc: string; // "Cc:"
    replyTo: string; // "Reply-To:" (the Reply-To of the original, when it differs from its From)
    fill: (gaps: string) => string; // the gaps that nobody filled; no Send button while there is one
    sentHidden: string; // the Sent mail is not read: only `\Answered` shows an answer
    skip: string; // the button
    noMore: string; // the review is at its end
    redraft: string; // the button: write a new version from one line of instruction
    replyAll: string; // the button: the other recipients of the mail go to Cc
    useReplyTo: string; // the button: the Reply-To of the mail becomes the recipient
  };
  inactive: string; // "(inactive)"
  externalSender: string; // "⚠️ external sender"
  due: string; // "Due"
  draft: string; // "Draft:"
  bodyCut: string;
  quoted: string; // "Quoted original:"
  linksHidden: string;
  quoteCut: string;
  sendLine: string;
  // The line for a reply, and for any kind while the org flag `draft_copy_check` is on: the system stops a send whose Drafts copy
  // the user changed, so an edit in the mail client is safe. Otherwise `sendLine` says not to send from the mail client.
  sendLineEditable: string;
  versionLine: (version: number) => string; // below the title, from version 2 on
  panelLine: (url: string) => string; // directly above `sendLine`
  buttons: {
    send: string;
    reject: string;
    sendAll: string;
    skipAll: string;
    sendAgain: string;
    wentOut: string;
    done: string;
    reasonWrongPerson: string; // after a reject: "✖️ Wrong person"
    reasonWrongContent: string;
    reasonNotNeeded: string;
    mistake: string; // on a sent mail: "⚠️ This was a mistake"
  };
  reasons: Record<RejectReason, string>; // inside a sentence, after "Reason: "
  set: {
    header: (count: number) => string;
    dueDay: (day: string) => string; // ends with ", " : it sits before the reminder number
    reminderOf: (reminder: number) => string;
    task: string; // "Task:"
    footerTemplate: string;
    footerSends: string;
  };
  closings: { delegation: string; reminder: string }; // a clarification has no closing line
  draftRemoved: string;
  // The whole text that replaces a follow-up card after "Track my sent mail" went off: no quote, no address, no subject.
  followUpRemoved: string;
  draftStays: string;
  causes: {
    tries: (tries: number, code: string) => string; // code "" = none
    contentSoft: (code: string) => string; // code "" = unknown
    softCap: (code: string) => string;
    copyCheck: (code: string) => string; // the Drafts copy could not be read before the send
    compose: (tries: number) => string;
    badPayload: string;
    hasGaps: string;
  };
  sendResult: {
    sent: (to: string, subject: string) => string;
    copyFailed: string;
    draftStaysNoUid: string;
    notSent: (to: string, subject: string) => string;
    refused: (stage: string, responseCode: number | null) => string; // includes "the draft stays" line
    failedStays: (cause: string) => string; // `cause` + "the draft stays"
    unknown: (to: string, subject: string) => string;
    unknownRest: string;
    expired: {
      timeout: (subject: string) => string;
      // A reply lives 7 days, another send 48 h: the `timeout` of a reply names no hours of the other rule.
      timeoutReply: (subject: string) => string;
      draft_missing: (subject: string) => string;
      not_notified: (subject: string) => string;
      not_seen: (subject: string) => string;
      held_timeout: (subject: string) => string;
      delegation_closed: (subject: string) => string;
      policy_changed: (subject: string) => string;
      loop_closed: (subject: string) => string;
      draft_changed: (subject: string) => string;
      // The reasons of the reply drafts: each says that nothing was sent.
      answered: (subject: string) => string;
      sent_by_user: (subject: string) => string;
      newer_mail: (subject: string) => string;
      original_moved: (subject: string) => string;
      suspicious: (subject: string) => string;
    };
    rejected: (byName: string | null, subject: string) => string;
  };
  held: { scope: string; paused: string; auth_error: string; host_blocked: string };
  edit: {
    approved: (time: string) => string;
    approvedHeld: (time: string, held: string) => string;
    rejected: (time: string) => string;
    expired: (time: string) => string;
    approvedSet: (time: string, done: number, skipped: number) => string;
    rejectedSet: (time: string, done: number, skipped: number) => string;
    wentOut: (time: string) => string;
    done: (time: string) => string;
    rejectedReason: (reason: string) => string; // no clock: the tap time is not the reject time
    markedMistake: (time: string) => string;
    changed: (time: string) => string; // a panel edit replaced the draft; the new version is a new message
    skipped: (time: string) => string; // a reply card that the owner skipped in the review
  };
  answered: {
    title: (name: string, subject: string) => string;
    tapDone: string;
  };
  // The answers to the reason and mistake taps.
  feedbackTaps: {
    noted: (reason: string) => string; // `reason` = an entry of `reasons`
    notRejected: string;
    off: string;
    markedMistake: string;
    alreadyMarked: string;
    tooLate: string;
    notSent: string;
  };
}

export const approvalTexts = { en: approvalsEn, pl: approvalsPl } satisfies Record<UserLocale, ApprovalTexts>;
