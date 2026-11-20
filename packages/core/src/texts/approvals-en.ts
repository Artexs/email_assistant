import type { ApprovalTexts } from "./approvals";

export const approvalsEn: ApprovalTexts = {
  title: {
    delegation: (to) => `📤 Send? Delegation to ${to}`,
    clarification: (address) => `📤 Send? Question to the sender ${address}`,
    reminder: (to) => `📤 Send? Reminder to ${to}`,
    reply: (address) => `✍️ Reply to ${address}`,
  },
  followUp: {
    title: "📝 Follow-up",
    to: "To:",
    cc: "Cc:",
    number: (n) => `Follow-up ${n} of 2`,
    sent: (to) => `✅ Follow-up sent to ${to}`,
    rejected: (byName) => `✖️ Follow-up rejected${byName === null ? "" : ` (${byName})`}`,
    expired: {
      timeout: "⌛ Follow-up not sent: the approval expired (48 h).",
      draft_missing:
        "❌ Follow-up not sent: the draft is not in your Drafts folder (it was not created, or you deleted, moved or sent it in your mail client).",
      not_notified: "⌛ Follow-up not sent: no approval request could be sent within 7 days.",
      not_seen: "⌛ Follow-up not sent: the approval request did not reach you.",
      held_timeout: "⌛ Follow-up not sent: it waited 48 h after your approval and did not go out.",
      delegation_closed: "⌛ Follow-up not sent: the delegation was closed.",
      policy_changed: "⌛ Follow-up not sent: the setting was changed.",
      loop_closed: "⌛ Follow-up not sent: the open loop was closed.",
      draft_changed: "✏️ Follow-up not sent: you edited this draft in your mail client. Send it from there.",
    },
  },
  reply: {
    to: "To:",
    cc: "Cc:",
    replyTo: "Reply-To:",
    fill: (gaps) => `⚠️ Fill these: ${gaps}. Fill them in the panel; you cannot send this draft until then.`,
    sentHidden: "I cannot see your sent mail; check you did not answer already.",
    skip: "⏭ Skip",
    noMore: "No more replies waiting.",
    redraft: "✍️ Redraft",
    replyAll: "👥 Reply all",
    useReplyTo: "↩️ Use Reply-To",
  },
  inactive: "(inactive)",
  externalSender: "⚠️ external sender",
  due: "Due",
  draft: "Draft:",
  bodyCut: "(draft text cut; the full text is in the draft)",
  quoted: "Quoted original:",
  linksHidden: "(links shown as [link]; the draft has them)",
  quoteCut: "(quote cut; the draft has the full text)",
  sendLine: "The system sends it after your tap. Do not send the draft from your mail client.",
  sendLineEditable: "The system sends it after your tap. Edit here, or edit and send in your mail client.",
  versionLine: (version) => `✏️ Version ${version}.`,
  panelLine: (url) => `Open in panel: ${url}`,
  buttons: {
    send: "📤 Send",
    reject: "✖️ Reject",
    sendAll: "📤 Send all",
    skipAll: "✖️ Skip all",
    sendAgain: "📤 Send again",
    wentOut: "✅ It went out",
    done: "✅ Done",
    reasonWrongPerson: "✖️ Wrong person",
    reasonWrongContent: "✖️ Wrong content",
    reasonNotNeeded: "Not needed",
    mistake: "⚠️ This was a mistake",
  },
  reasons: { wrong_person: "wrong person", wrong_content: "wrong content", not_needed: "not needed" },
  set: {
    header: (count) => (count === 1 ? "📤 Send 1 reminder?" : `📤 Send ${count} reminders?`),
    dueDay: (day) => `due ${day}, `,
    reminderOf: (reminder) => `reminder ${reminder} of 2`,
    task: "Task:",
    footerTemplate: "Each reminder is the fixed reminder template with this task; it quotes nothing.",
    footerSends: "The system sends them after your tap.",
  },
  closings: {
    delegation: "The delegation was cancelled.",
    reminder: "The delegation stays open.",
  },
  draftRemoved: "The draft was removed.",
  followUpRemoved: "↩️ Follow-up removed: tracking of your sent mail is off.",
  draftStays: "The draft stays in Drafts.",
  causes: {
    tries: (tries, code) => `The send failed ${tries} times${code === "" ? "" : ` (${code})`}`,
    contentSoft: (code) =>
      `The mail server refused the content for now (code ${code === "" ? "unknown" : code}); the system never retries after the content`,
    softCap: (code) =>
      `The mail server did not accept the mail for 6 hours${code === "" ? "" : ` (${code})`}; nothing was sent`,
    copyCheck: (code) =>
      `The system could not read the draft in your mailbox${code === "" ? "" : ` (${code})`}; nothing was sent`,
    compose: (tries) => `The mail could not be built ${tries} times`,
    badPayload: "The stored send data is not valid; nothing was sent",
    hasGaps: "The reply still has a gap marked with [[ ]] that nobody filled; nothing was sent",
  },
  sendResult: {
    sent: (to, subject) => `✅ Sent to ${to} · ${subject}`,
    copyFailed: "No copy in Sent: the server refused the copy.",
    draftStaysNoUid: "The draft stays in Drafts (no UIDPLUS on this server).",
    notSent: (to, subject) => `❌ Not sent to ${to} · ${subject}`,
    refused: (stage, responseCode) =>
      `The mail server refused it (${stage}${responseCode === null ? "" : `, code ${responseCode}`}). The draft stays in Drafts.`,
    failedStays: (cause) => `${cause}. The draft stays in Drafts.`,
    unknown: (to, subject) => `⚠️ Unknown whether the mail to ${to} went out · ${subject}`,
    unknownRest:
      "The connection broke after the content was sent. Check Sent or ask the recipient before you send again.",
    expired: {
      timeout: (subject) => `⌛ Not sent: the approval expired (48 h) · ${subject}`,
      timeoutReply: (subject) => `⌛ Not sent: nobody approved the draft in 7 days · ${subject}`,
      // Two causes: the draft was never made, or the copy in Drafts is gone (deleted, moved or sent from the mail client).
      draft_missing: (subject) =>
        `❌ Not sent: the draft is not in your Drafts folder (it was not created, or you deleted, moved or sent it in your mail client) · ${subject}`,
      not_notified: (subject) =>
        `⌛ Not sent: no approval request could go out within 7 days (no linked owner, or the draft was not created) · ${subject}`,
      not_seen: (subject) =>
        `⌛ Not sent: you did not receive the approval request (the account was paused, or it did not go out) · ${subject}`,
      held_timeout: (subject) =>
        `⌛ Not sent: it waited 48 h after your approval and was not sent (held by SEND_SCOPE, the send limit or the mailbox state) · ${subject}`,
      delegation_closed: (subject) => `⌛ Not sent: the delegation was closed · ${subject}`,
      policy_changed: (subject) => `⌛ Not sent: the setting was changed · ${subject}`,
      loop_closed: (subject) => `⌛ Not sent: the open loop was closed · ${subject}`,
      draft_changed: (subject) => `✏️ You edited this draft in your mail client. Send it from there. · ${subject}`,
      answered: (subject) => `⌛ You already answered this mail. The system sent nothing. · ${subject}`,
      sent_by_user: (subject) =>
        `⌛ It looks like you sent it from your mail client. The system sent nothing. · ${subject}`,
      newer_mail: (subject) =>
        `⌛ A newer mail arrived in this thread. Nothing was sent. Read the newer mail; a new draft may follow. · ${subject}`,
      original_moved: (subject) =>
        `⌛ The mail was moved to another folder. Nothing was sent. Answer it from its new place if you still want to. · ${subject}`,
      suspicious: (subject) =>
        `⌛ The mail was marked as suspicious after the draft was made. Nothing was sent. Read the mail with care; a new draft may follow. · ${subject}`,
    },
    rejected: (byName, subject) => `✖️ Rejected${byName === null ? "" : ` by ${byName}`} · ${subject}`,
  },
  held: {
    scope: "Sending is held by SEND_SCOPE on the server",
    paused: "The mailbox is paused, so the send waits",
    auth_error: "The mailbox login fails, so the send waits",
    host_blocked: "The mail server is not allowed, so the send waits",
  },
  edit: {
    approved: (time) => `⏳ Approved ${time}, sending.`,
    approvedHeld: (time, held) =>
      `⏳ Approved ${time}. ${held}; /status shows it. It expires 48 h after the tap if it is still held.`,
    rejected: (time) => `✖️ Rejected ${time}.`,
    expired: (time) => `⌛ Expired ${time}. The mail was not sent.`,
    approvedSet: (time, done, skipped) => `⏳ Approved ${time}: ${done} sending, ${skipped} skipped.`,
    rejectedSet: (time, done, skipped) => `✖️ Skipped ${time}: ${done} rejected, ${skipped} skipped.`,
    wentOut: (time) => `✅ Marked as sent ${time}.`,
    done: (time) => `✅ Done ${time}.`,
    rejectedReason: (reason) => `✖️ Rejected. Reason: ${reason}.`,
    markedMistake: (time) => `⚠️ Marked as a mistake ${time}.`,
    changed: (time) => `✏️ Changed ${time}. The new version comes as a new message.`,
    skipped: (time) => `⏭ Skipped ${time}. The draft stays in the panel.`,
  },
  answered: {
    title: (name, subject) => `📩 ${name} answered · ${subject}`,
    tapDone: "Tap Done when the task is closed.",
  },
  feedbackTaps: {
    noted: (reason) => `Noted: ${reason}.`,
    notRejected: "This send is not rejected.",
    off: "This button is off now.",
    markedMistake: "⚠️ Noted as a mistake.",
    alreadyMarked: "Already marked.",
    tooLate: "Too late: a mistake can be marked within 7 days of the send.",
    notSent: "This mail was not sent.",
  },
};
