import type { ReplyBlockReason } from "../replies/eligibility";
import type { UserLocale } from "../tenancy";

import type { SendScopeKind, TriageScopeKind } from "./bot-common";
import { botEn } from "./bot-en";
import { botPl } from "./bot-pl";

// The command names of the bot. The server keeps its own list (`channels/port.ts`); a test checks that both match.
export const botCommandNames = ["digest", "status", "pause", "resume", "review", "help"] as const;
export type BotCommandName = (typeof botCommandNames)[number];

// Every direct reply of the bot: the help, the link replies, /status, /pause and /resume, and the tap answers.
// One entry per sentence. A function holds the values of the text. A name or an address never gets a case ending.
export interface BotTexts {
  help: string; // the command list, with the /review line
  linked: string; // ends with `help`
  alreadyLinked: string; // ends with `help`
  linkUsed: string;
  linkExpired: string;
  error: string;
  // `operatorContact` null = "the operator".
  accountPaused: (operatorContact: string | null) => string;
  // The entries of the Telegram command menu.
  commands: Record<BotCommandName, string>;
  status: {
    title: (day: string, time: string) => string;
    noMailbox: string;
    modes: { shadow: string; assist: string };
    modeNone: string;
    mailboxLine: (mode: string, state: string) => string;
    stateActive: string;
    statePaused: (since: string) => string;
    stateAuthError: (since: string) => string;
    stateAuthErrorOAuth: (since: string) => string;
    stateHostBlocked: (since: string) => string;
    lastSync: (when: string | null, late: boolean) => string;
    llmCalls: (since: string, calls: number, cap: number) => string;
    waiting: (count: number) => string;
    triage: (scope: TriageScopeKind) => string;
    actions: (scope: TriageScopeKind, counts: { applied: number; undone: number; failed: number }) => string;
    approvals: string;
    approvalsOf: (address: string) => string;
    approvalsLine: (label: string, waiting: number, extra: { oldest: string | null; held: string | null }) => string;
    approvedPaused: (count: number) => string;
    approvedAuthError: (count: number) => string;
    approvedHostBlocked: (count: number) => string;
    approvedHeld: (count: number, scope: string) => string;
    approvedSending: (count: number) => string;
    send: (scope: SendScopeKind) => string;
    delegations: (open: number, overdue: number) => string;
    llm: (provider: string, model: string) => string;
    noDigestTimes: string;
    nextDigest: (time: string) => string;
    quietHours: (start: string, end: string) => string;
    noQuietHours: string;
  };
  switch: {
    ownerOnly: string;
    alreadyPaused: (address: string) => string;
    alreadyActive: (address: string) => string;
    loginError: (address: string) => string;
    loginErrorOAuth: (address: string) => string;
    hostBlocked: (address: string) => string;
    pausedHeader: (list: string) => string;
    pausedExplain: string;
    pausedResume: string;
    resumedHeader: (list: string) => string;
    resumedExplain: (minutes: number) => string; // minutes: the sync interval (2, 3 or 5)
    noMailbox: string;
  };
  taps: {
    invalid: string;
    cancelled: string;
    picker: { title: (subject: string, aiCategory: string) => string; cancelButton: string };
    ownerOnly: string;
    approved: string;
    approvedHeld: string;
    approvedPaused: string;
    approvedAuthError: string;
    approvedHostBlocked: string;
    alreadyApproved: (clock: string) => string;
    sending: string;
    sent: string;
    rejected: string;
    expired: string;
    failed: string;
    draftNotReady: string;
    hasGaps: string; // a reply draft that still holds a gap `[[…]]`
    featureOff: string; // the reply drafts are switched off
    rejectedNow: string;
    notFound: string;
    changed: string; // an old card of a draft that a panel edit replaced
    sendAgain: string;
    sendAgainHeld: { scope: string; paused: string; auth_error: string; host_blocked: string };
    heldNotes: { scope: string; paused: string; auth_error: string; host_blocked: string };
    sendAgainAlready: string;
    sendAgainNotFailed: string;
    sendAgainDraftGone: string;
    sendAgainDelegationClosed: string;
    setNothing: string;
    setApproved: (approved: number, skipped: number) => string;
    setApprovedHeld: (approved: number, skipped: number, note: string) => string;
    setRejected: (count: number) => string;
    done: string;
    doneAlready: string;
    doneNotClosable: string;
    wentOut: string;
    wentOutAlready: string;
    wentOutSentAgain: string;
    wentOutNotUnknown: string;
    wentOutDelegationNotOpen: string;
    // The taps and the reply text of the reply drafts (Redraft, Reply all, Use Reply-To, Draft reply).
    reply: {
      drafting: string; // the answer to "Draft reply": the card follows as a new message
      redraftAsk: string; // the answer to Redraft: the user writes one line next
      redraftQueued: string; // the message after the user's line: a new version follows
      redraftLimit: string; // the fifth redraft of one mail was made already
      instructionLength: string; // the line is empty or over 300 characters
      closed: string; // the draft does not wait any more
      recipientsDone: string;
      tooManyRecipients: string;
      noReplyTo: string;
      noOthers: string; // Reply all: the mail has no other recipient
      badRecipient: string; // an address of the mail cannot be used as a recipient
      recipientsUnchanged: string;
      // Why a draft cannot be made now: the reasons of the eligibility rule and the closed gate of the mailbox.
      blocked: Record<ReplyBlockReason | "policy_changed", string>;
    };
  };
}

export const botTexts = { en: botEn, pl: botPl } satisfies Record<UserLocale, BotTexts>;
