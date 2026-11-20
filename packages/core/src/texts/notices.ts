import type { SendLimitKind } from "../send-limits";
import type { UserLocale } from "../tenancy";
import type { BarCategory } from "../triage/metrics";
import type { TripReason } from "../trust/tripwire";
import type { AuthErrorReason } from "../web/mail-oauth";

import { noticesEn } from "./notices-en";
import { noticesPl } from "./notices-pl";

type FailedAction = "move" | "flag" | "mark_read" | "create_draft";

// The result lines of a reply request that a user waited for in Telegram (one text for each group of reason codes; the eligibility
// reasons use `bot.taps.reply.blocked`). `off`: a gate of the mailbox is closed. `generic`: a code with no own text.
export const replyResultKeys = [
  "needs_facts",
  "not_a_reply",
  "unsafe_request",
  "no_text",
  "timeout",
  "llm_cap",
  "llm_error",
  "checks",
  "output",
  "internal",
  "closed",
  "changed",
  "off",
  "mail_gone",
  "generic",
] as const;
export type ReplyResultKey = (typeof replyResultKeys)[number];

// One entry per line that a notice prints; a function where the line holds values.
export interface NoticeTexts {
  urgentTitle: string;
  received: (clock: string) => string;
  authError: {
    first: (address: string, since: string) => string;
    noRead: string;
    fix: (mailboxId: string) => string;
    // For an OAuth mailbox: replaces `fix`. `provider` is the display name; `reason` null is a refusal with no known cause.
    fixOAuth: (provider: string, reason: AuthErrorReason | null) => string;
  };
  hostBlocked: { first: (address: string, since: string) => string; why: string; noRead: string; recheck: string };
  sentMissing: { first: (address: string, since: string) => string; ask: string };
  syncStale: { first: (address: string) => string; last: (last: string) => string; status: string; never: string };
  syncOk: (address: string, last: string) => string;
  actionFailed: {
    first: Record<FailedAction, { original: string; reverse: string }>;
    toFolder: (folder: string) => string; // appended to the first line of a failed move
    tried: (count: number) => string;
    notFound: string;
    badPayload: (folder: string) => string;
    staysIn: (folder: string) => string;
    staysInAiFolder: (folder: string | null) => string;
    draftStays: string;
    status: string;
  };
  mailboxRemoved: string;
  // For an OAuth mailbox: replaces `mailboxRemoved`. What the owner does at the provider depends on the secret kind.
  mailboxRemovedAccess: {
    googleRevoked: string;
    googleFailed: string;
    microsoftWork: string;
    microsoftPersonal: string;
  };
  // Mail of a VIP or whitelisted sender waits while the AI service is paused.
  notTriaged: (sender: string) => string;
  // Open loops. A follow-up notice names no address and no text: the owner reads the details in the panel.
  followUp: {
    failed: string; // the send failed and nothing went out
    unknown: string; // the connection broke after the text went out: the mail may have been sent
    held: (limit: string) => string; // `limit` = an entry of `sendHeld.limit`
  };
  // The one line for an owner whose consent does not cover open-loop data (replaces a follow-up card or result).
  loopConsent: { approval: string; result: string };
  // Reply drafts: one fixed line per kind, no button. A count and a clock only: no mail text. The
  // Telegram review stages replace these lines and keep the kind names.
  // `review` is the button of the ready notice; `consent` is the line for an owner whose Telegram consent does not cover reply
  // drafts (the count only, no button).
  replyDrafts: {
    ready: (count: number, clock: string) => string;
    prompt: string; // the ForceReply message after a Redraft tap
    results: Record<ReplyResultKey, string>; // the result of a tap or a redraft that ended with no new card
    review: string;
    consent: string;
    draft: string; // the "Draft reply" button of an urgent notice
    draftRow: (n: number) => string; // the same button on a digest row
  };
  // Counts, category names and fixed phrases only. `link` is a text line, not a button.
  trustReady: {
    first: (checked: number) => string;
    recommended: (categories: string) => string;
    none: string;
    link: (url: string) => string;
  };
  autonomyPaused: {
    corrections: (category: string, count: number) => string;
    importantHidden: (category: string) => string;
    modelSwitch: (category: string) => string;
    evidenceChanged: (category: string) => string;
    historyFail: (category: string) => string;
    again: string;
    link: (url: string) => string;
  };
  sendHeld: {
    first: (address: string, limit: string) => string;
    limit: Record<SendLimitKind, string>;
    waiting: (count: number, clock: string) => string;
  };
  // The weekly report: one function per line; `rate` is a text like "33% (3 of 9)".
  weekly: {
    title: (from: string, to: string) => string; // the two days are formatted by the caller
    noMail: string;
    missed: (rate: string) => string;
    sample: (missed: number, important: number) => string;
    loopsClosed: (percent: string, counts: string) => string;
    loopsSurfaced: (percent: string, counts: string) => string;
    loops: (closed: string, surfaced: string, pending: number) => string;
    loopsNone: (pending: number) => string;
    loopsOf: (closed: string, surfaced: string) => string;
    mistakes: {
      total: (count: number) => string;
      hiddenImportant: (count: number) => string;
      wrongPerson: (count: number) => string;
      wrongContent: (count: number) => string;
      sentByMistake: (count: number) => string;
    };
    handled: (rate: string) => string;
    wouldHandle: (rate: string) => string;
    urgent: (p90: number | null, noticed: number, withoutNotice: number) => string;
    urgentNone: string;
    cost: (perMailbox: string, target: number, unpricedCalls: number) => string;
    category: Record<BarCategory, string>;
    autoEnough: (category: string, percent: number, labels: number) => string;
    autoLower: (percent: number) => string;
    autoFew: (category: string, labels: number, minimum: number) => string;
    auto: (items: string) => string;
    autoNone: string;
    // Fixed phrases only: the evidence line of a category on `auto`, and the line of a paused one.
    autoOn: (category: string, proof: string, check: string) => string;
    autoPaused: (category: string, reason: string) => string;
    proof: { go: string; noGo: string; none: string };
    check: { pass: string; fail: string; inconclusive: string; noResult: string; none: string };
    pauseReason: Record<TripReason, string>;
    review: (count: number) => string;
    // The line of the rule suggestions that wait: a count and the link to the Rules page (null: no link, a fixed phrase instead).
    suggestions: { line: (open: number, link: string | null) => string };
    // The line of the reply drafts of the week (shown only when a draft was made): the counts of the six ends.
    replyDrafts: {
      line: (counts: {
        made: number;
        sentByTap: number;
        sentByUser: number;
        rejected: number;
        expired: number;
        closed: number;
      }) => string;
    };
  };
}

export const noticeTexts = { en: noticesEn, pl: noticesPl } satisfies Record<UserLocale, NoticeTexts>;
