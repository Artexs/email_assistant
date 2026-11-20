import type { BotTexts } from "./bot";
import type { SendScopeKind, TriageScopeKind } from "./bot-common";
import { pluralCategory } from "./locale";

// The sync interval in the /resume text: the form follows the number (pl: "za minutę", "za 2 minuty", "za 5 minut").
const EN_MINUTES = { one: "minute", few: "minutes", many: "minutes", other: "minutes" } as const;

const EN_HELP = [
  "Commands:",
  "/digest – the digest now",
  "/status – mailboxes, last sync, LLM calls",
  "/pause – stop reading and triage of your mailboxes",
  "/resume – start them again",
  "/review – label a random sample of recent mail",
  "/help – this list",
  "Tap ✅ when the AI category is right, ✏️ to correct it.",
  "↩️ under a digest line undoes what the system did to that mail (7 days).",
  "📤 under an approval sends the draft; ✖️ rejects it (the draft is removed).",
  "✅ Done under an answered delegation closes it.",
].join("\n");

const EN_TRIAGE: Record<TriageScopeKind, string> = {
  off: "off",
  synthetic: "test mail only (TRIAGE_LLM_SCOPE=synthetic)",
  all: "real mail of every active mailbox (TRIAGE_LLM_SCOPE=all)",
};
const EN_ACTIONS: Record<TriageScopeKind, string> = {
  off: "off",
  synthetic: "test mail only (ACTIONS_SCOPE=synthetic)",
  all: "real mail, by the mode of each mailbox (ACTIONS_SCOPE=all)",
};
const EN_SEND: Record<SendScopeKind, string> = {
  off: "off",
  self: "only to your test addresses (SEND_SCOPE=self)",
  all: "real recipients, after an owner's tap (SEND_SCOPE=all)",
};

export const botEn: BotTexts = {
  help: EN_HELP,
  linked: `✅ This chat is linked. Digests and urgent notices come here.\n${EN_HELP}`,
  alreadyLinked: `✅ This chat is linked already.\n${EN_HELP}`,
  linkUsed: "This link was used already. Ask for a new link.",
  linkExpired: "This link has expired (a link works for 15 minutes). Ask for a new link.",
  error: "Something went wrong. Try again later.",
  accountPaused: (operatorContact) => {
    const base = "⏸ This account is paused. Nothing changes now. To resume it, contact";
    return operatorContact === null ? `${base} the operator.` : `${base} ${operatorContact}.`;
  },
  commands: {
    digest: "The digest now",
    status: "Mailboxes, last sync, LLM calls",
    pause: "Stop reading and triage",
    resume: "Start reading and triage again",
    review: "Label a sample of recent mail",
    help: "The command list",
  },
  status: {
    title: (day, time) => `📊 Status · ${day} ${time}`,
    noMailbox: "No mailbox connected.",
    modes: { shadow: "shadow", assist: "assist" },
    modeNone: "none (no settings row: not triaged)",
    mailboxLine: (mode, state) => `Mode: ${mode} · Status: ${state}`,
    stateActive: "active",
    statePaused: (since) => `paused since ${since}`,
    stateAuthError: (since) => `login error since ${since} (run mailbox:password)`,
    stateAuthErrorOAuth: (since) => `sign-in error since ${since} (Reconnect in the panel)`,
    stateHostBlocked: (since) => `mail server not allowed since ${since} (checked again at each sync)`,
    lastSync: (when, late) => `Last sync: ${when === null ? "never" : `${when}${late ? " (late)" : ""}`}`,
    llmCalls: (since, calls, cap) => `LLM calls since ${since}: ${calls} of ${cap}`,
    waiting: (count) => `Waiting for triage: ${count}`,
    triage: (scope) => `Triage: ${EN_TRIAGE[scope]}`,
    actions: (scope, counts) =>
      `Actions: ${EN_ACTIONS[scope]} · last 24 h: applied ${counts.applied}, undone ${counts.undone}, failed ${counts.failed}`,
    approvals: "Approvals",
    approvalsOf: (address) => `Approvals ${address}`,
    approvalsLine: (label, waiting, extra) =>
      `${label}: ${waiting} waiting for your tap${extra.oldest === null ? "" : ` (oldest ${extra.oldest})`}${extra.held === null ? "" : ` · ${extra.held}`}`,
    approvedPaused: (count) => `${count} approved, held: the mailbox is paused`,
    approvedAuthError: (count) => `${count} approved, held: the mailbox login fails`,
    approvedHostBlocked: (count) => `${count} approved, held: the mail server is not allowed`,
    approvedHeld: (count, scope) => `${count} approved, held by SEND_SCOPE=${scope}`,
    approvedSending: (count) => `${count} approved, sending`,
    send: (scope) => `Send: ${EN_SEND[scope]}`,
    delegations: (open, overdue) => `Delegations: ${open} waiting for a reply, ${overdue} overdue`,
    llm: (provider, model) => `LLM: ${provider} · ${model}`,
    noDigestTimes: "No digest times set (bun run digest:times)",
    nextDigest: (time) => `Next digest: ${time}`,
    quietHours: (start, end) => `Quiet hours: ${start}–${end} (notices wait until ${end})`,
    noQuietHours: "Quiet hours: none (notices come at any time)",
  },
  switch: {
    ownerOnly: "Only the owner can pause or resume the mailboxes.",
    alreadyPaused: (address) => `${address} was paused already.`,
    alreadyActive: (address) => `${address} was active already.`,
    loginError: (address) => `❌ ${address} has a login error: run mailbox:password first.`,
    loginErrorOAuth: (address) => `❌ ${address} has a sign-in error: tap Reconnect in the panel first.`,
    hostBlocked: (address) => `⛔ ${address}: its mail server is not allowed; the system checks it again at each sync.`,
    pausedHeader: (list) => `⏸ Paused: ${list}`,
    pausedExplain:
      "The system does not read or triage these mailboxes now and sends no urgent notice for them. Digests still come.",
    pausedResume: "/resume starts them again.",
    resumedHeader: (list) => `▶️ Resumed: ${list}`,
    resumedExplain: (minutes) =>
      `The next sync runs within ${minutes} ${EN_MINUTES[pluralCategory("en", minutes)]}. Mail that came during the pause is read then; mail older than 7 days is not triaged.`,
    noMailbox: "No mailbox connected.",
  },
  taps: {
    invalid: "This button is not valid any more.",
    cancelled: "✏️ Cancelled.",
    picker: {
      title: (subject, aiCategory) => `✏️ Pick the right category\n${subject}\nAI said: ${aiCategory}`,
      cancelButton: "✖️ Cancel",
    },
    ownerOnly: "Only an owner can approve or reject a send.",
    approved: "⏳ Sending within a minute.",
    approvedHeld: "Approved. Sending is held by SEND_SCOPE on the server; /status shows it.",
    approvedPaused: "Approved. The mailbox is paused, so the send waits; /status shows it.",
    approvedAuthError:
      "Approved. The mailbox login fails, so the send waits until the password is fixed; /status shows it.",
    approvedHostBlocked:
      "Approved. The mail server of this mailbox is not allowed, so the send waits; /status shows it.",
    alreadyApproved: (clock) => `Already approved ${clock}.`,
    sending: "Already approved, sending now.",
    sent: "Already sent.",
    rejected: "This send was rejected.",
    expired: "This approval expired. The mail was not sent.",
    failed: "This send failed. See the result notice.",
    draftNotReady: "The draft is not in Drafts yet. Tap again in a minute.",
    hasGaps: "This draft still has a gap ([[…]]). Fill it in the panel first. Nothing was sent.",
    featureOff: "Reply drafts are switched off. Nothing was sent.",
    rejectedNow: "✖️ Rejected. The draft will be removed.",
    notFound: "This mail is not in your account.",
    changed: "This draft was changed. Use the newest message.",
    sendAgain: "⏳ A new send was approved. Sending within a minute.",
    sendAgainHeld: {
      scope: "A new send was approved. Sending is held by SEND_SCOPE on the server; /status shows it.",
      paused: "A new send was approved. The mailbox is paused, so the send waits; /status shows it.",
      auth_error: "A new send was approved. The mailbox login fails, so the send waits; /status shows it.",
      host_blocked: "A new send was approved. The mail server is not allowed, so the send waits; /status shows it.",
    },
    heldNotes: {
      scope: "Sending is held by SEND_SCOPE on the server",
      paused: "The mailbox is paused, so the sends wait",
      auth_error: "The mailbox login fails, so the sends wait",
      host_blocked: "The mail server is not allowed, so the sends wait",
    },
    sendAgainAlready: "A resend was already approved for this mail.",
    sendAgainNotFailed: "This send is not in a failed state.",
    sendAgainDraftGone: "The draft is gone: the mail must be triaged again.",
    sendAgainDelegationClosed: "The delegation is closed: no resend.",
    setNothing: "Nothing to approve: the reminders were handled already.",
    setApproved: (approved, skipped) => `⏳ ${approved} reminders go out within a minute, ${skipped} skipped.`,
    setApprovedHeld: (approved, skipped, note) =>
      `⏳ ${approved} reminders approved, ${skipped} skipped. ${note}; /status shows it.`,
    setRejected: (count) => `✖️ ${count} reminders skipped.`,
    done: "✅ Done.",
    doneAlready: "Already done.",
    doneNotClosable: "This delegation is not answered yet.",
    wentOut: "✅ The delegation is marked as sent. A reply from the delegate is matched now.",
    wentOutAlready: "Already marked as sent.",
    wentOutSentAgain: "The mail was sent again: no change.",
    wentOutNotUnknown: "This send is not in the unknown state: no change.",
    wentOutDelegationNotOpen: "The delegation is not waiting for this answer any more: no change.",
    reply: {
      drafting: "✍️ Drafting. The draft comes as a new message.",
      redraftAsk: "Write one line as a reply to the message below.",
      redraftQueued: "✍️ Writing a new version. It comes as a new message.",
      redraftLimit: "This draft has 5 new versions already. Edit it in the panel.",
      instructionLength: "Write one line of 1 to 300 characters.",
      closed: "This draft is closed. Nothing changed.",
      recipientsDone: "👥 Recipients changed. The new version comes as a new message.",
      tooManyRecipients: "Too many recipients: a reply goes to at most 10 more people. Use the panel.",
      noReplyTo: "This mail has no other Reply-To address.",
      noOthers: "This mail has no other recipients.",
      badRecipient: "An address of this mail cannot be used. Change the recipients in the panel.",
      recipientsUnchanged: "The draft already goes to these recipients.",
      blocked: {
        not_checked: "This mail is not checked yet. Try again in a few minutes.",
        category: "This mail does not need a reply.",
        junk_source: "This mail came from the spam folder. No draft.",
        not_a_person: "This mail is automatic or from a mailing list. No draft.",
        own_mailbox: "This mail is from your own mailbox. No draft.",
        suspicious: "This mail looks suspicious. No draft.",
        calendar: "This is a calendar invitation. Answer it in your calendar.",
        answered: "This mail has an answer already.",
        too_old: "This mail is too old for a draft.",
        language: "The language of this mail is not clear. No draft.",
        open_newer: "A newer mail in this thread has a draft already.",
        oauth_mailbox: "Reply drafts do not work for this kind of mailbox yet.",
        policy_changed: "Reply drafts are off for this mailbox. Turn them on in the panel.",
      },
    },
  },
};
