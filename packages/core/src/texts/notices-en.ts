import type { NoticeTexts } from "./notices";

export const noticesEn: NoticeTexts = {
  urgentTitle: "🔴 Urgent mail",
  received: (clock) => `Received ${clock}`,
  authError: {
    first: (address, since) => `❌ Login to ${address} failed at ${since}.`,
    noRead: "The system does not read this mailbox now. No mail is lost: it stays on the mail server.",
    fix: (mailboxId) =>
      `To fix it: check the password, then run mailbox:password for mailbox ${mailboxId} (runbook: deploy/README.md).`,
    fixOAuth: (provider, reason) => {
      switch (reason) {
        case "oauth_expired":
          return `The sign-in to ${provider} expired. Open the panel, Mailboxes, and tap Reconnect.`;
        case "oauth_revoked":
          return `Access to the mailbox was withdrawn at ${provider}. Open the panel, Mailboxes, and tap Reconnect.`;
        case "admin_consent_required":
          return `This app needs approval at ${provider}, from you or from your administrator. Open the panel, Mailboxes: tap Reconnect, or use the approval link there.`;
        case "protocol_disabled":
          return "Your administrator turned off IMAP or SMTP for this mailbox. Ask them to turn it on, then tap Reconnect in the panel.";
        case null:
          return `The sign-in to ${provider} fails. Open the panel, Mailboxes, and tap Reconnect.`;
      }
    },
  },
  hostBlocked: {
    first: (address, since) => `⛔ The system stopped connecting to the mail server of ${address} at ${since}.`,
    why: "The server name points to a private or local network address, and the system never connects there.",
    noRead: "The system does not read or send mail of this mailbox now. No mail is lost: it stays on the mail server.",
    recheck:
      "The system checks the server again at each sync and starts the mailbox again by itself. /status shows the state.",
  },
  sentMissing: {
    first: (address, since) => `📭 No sent mail seen for ${address} since ${since}.`,
    ask: "Does your mail app keep a copy in Sent? The assistant needs it to see what you wait for.",
  },
  syncStale: {
    first: (address) => `⚠️ Mail sync is late for ${address}.`,
    last: (last) => `Last good sync: ${last}. The system keeps trying.`,
    status: "/status shows the state.",
    never: "never",
  },
  syncOk: (address, last) => `✅ Mail sync works again for ${address}. Last sync ${last}.`,
  actionFailed: {
    first: {
      move: { original: "Could not move a mail", reverse: "Undo failed: could not move a mail back to" },
      flag: { original: "Could not flag a mail", reverse: "Undo failed: could not remove the flag" },
      mark_read: { original: "Could not mark a mail read", reverse: "Undo failed: could not mark a mail unread" },
      create_draft: { original: "Could not create a draft", reverse: "Could not remove the draft for a mail" },
    },
    toFolder: (folder) => ` to ${folder}`,
    tried: (count) => `Tried ${count} ${count === 1 ? "time" : "times"}.`,
    notFound: "The mail was not found: it was moved or deleted in the mail client.",
    badPayload: (folder) => `The plan had an unknown folder. The mail stays in ${folder}.`,
    staysIn: (folder) => `The mail stays in ${folder}.`,
    staysInAiFolder: (folder) => `The mail stays in ${folder ?? "its AI folder"}: move it by hand.`,
    draftStays: "The draft stays in Drafts: delete it by hand.",
    status: "/status shows the mailbox state.",
  },
  mailboxRemoved: "Mailbox removed. Change its password in your mail provider's settings now.",
  mailboxRemovedAccess: {
    googleRevoked: "Mailbox removed. Its Google access is withdrawn.",
    googleFailed: "Mailbox removed. Withdraw its access at myaccount.google.com/permissions now.",
    microsoftWork: "Mailbox removed. Withdraw the app's access at myapps.microsoft.com now.",
    microsoftPersonal: "Mailbox removed. Withdraw the app's access at account.live.com/consent/Manage now.",
  },
  notTriaged: (sender) =>
    `📭 Mail from ${sender} is not triaged yet: the AI service is paused. It is triaged when the service is back.`,
  followUp: {
    failed: "⚠️ A follow-up could not be sent. Nothing went out.",
    unknown:
      "⚠️ A follow-up may have been sent: the connection broke after the text went out. Check your Sent folder before you write another.",
    held: (limit) => `⏸ A follow-up waits: ${limit}.`,
  },
  loopConsent: {
    approval: "A follow-up waits for your approval in the panel.",
    result: "A follow-up has a new result in the panel.",
  },
  replyDrafts: {
    ready: (count, clock) => `✍️ ${count} reply ${count === 1 ? "draft is" : "drafts are"} ready (${clock}).`,
    prompt: "✍️ Write one line: what should the reply say?",
    results: {
      needs_facts: "✍️ No draft: the reply needs facts that are not in the mail. Write it yourself.",
      not_a_reply: "✍️ No draft: this mail does not need a reply.",
      unsafe_request: "✍️ No draft: this mail asks for something that needs your own decision.",
      no_text: "✍️ No draft: the text of the mail is not stored any more.",
      timeout: "✍️ The draft took too long. Try once more.",
      llm_cap: "✍️ The daily limit of AI calls for this mailbox is reached. Try again tomorrow.",
      llm_error: "✍️ The AI service failed. Try again later.",
      checks: "✍️ The draft did not pass the safety checks. Try again or write the reply yourself.",
      output: "✍️ The AI gave no usable answer. Try again.",
      internal: "✍️ Something went wrong. Try again later.",
      closed: "✍️ This draft was closed; nothing changed.",
      changed: "✍️ Another version replaced this draft meanwhile. Use the newest message.",
      off: "✍️ Reply drafts are off for this mailbox. Turn them on in the panel.",
      mail_gone: "✍️ The mail is not available any more.",
      generic: "✍️ No draft was made.",
    },
    review: "📝 Review",
    consent: "Confirm the new Telegram terms in the panel to review here.",
    draft: "✍️ Draft reply",
    draftRow: (n) => `✍️ ${n}`,
  },
  trustReady: {
    first: (checked) =>
      `📋 Your check is ready: I looked at ${checked} ${checked === 1 ? "mail" : "mails"} from the last 30 days.`,
    recommended: (categories) => `Recommended: ${categories}`,
    none: "Nothing to turn on yet.",
    link: (url) => `Report: ${url}`,
  },
  autonomyPaused: {
    corrections: (category, count) =>
      `⏸ Automatic moves for ${category} are off: you corrected ${count} of them in 7 days.`,
    importantHidden: (category) => `⏸ Automatic moves for ${category} are off: one of them hid a mail you needed.`,
    modelSwitch: (category) =>
      `⏸ Automatic moves for ${category} are off: the AI model changed and has no proof yet for this category.`,
    evidenceChanged: (category) =>
      `⏸ Automatic moves for ${category} are off: new test results no longer support them.`,
    historyFail: (category) =>
      `⏸ Automatic moves for ${category} are off: the check of your last 30 days found mail you needed among them.`,
    again: "Turn them on again in Settings.",
    link: (url) => `Settings: ${url}`,
  },
  sendHeld: {
    first: (address, limit) => `⏸ Sends from ${address} wait: ${limit}.`,
    limit: {
      mailbox_hour: "the hourly send limit of this mailbox is reached",
      mailbox_day: "the daily send limit of this mailbox is reached",
      recipient_day: "the daily limit for one recipient is reached",
    },
    waiting: (count, clock) => `${count} waiting; the next one goes out at about ${clock}.`,
  },
  weekly: {
    title: (from, to) => `📈 Week ${from} – ${to}`,
    noMail: "No mail this week.",
    missed: (rate) => `Missed important mail (lower bound): ${rate}`,
    sample: (missed, important) => `Random review sample: ${missed} missed of ${important}`,
    loopsClosed: (percent, counts) => `${percent} closed ${counts}`,
    loopsSurfaced: (percent, counts) => `${percent} surfaced ${counts}`,
    loops: (closed, surfaced, pending) =>
      `Open loops on time: ${closed}, ${surfaced}${pending > 0 ? `, ${pending} still open` : ""}`,
    loopsOf: (closed, surfaced) => `Of which loops: ${closed}, ${surfaced}`,
    loopsNone: (pending) => `Open loops on time: no delegation was due${pending > 0 ? `, ${pending} still open` : ""}`,
    mistakes: {
      total: (count) => `Serious mistakes: ${count}`,
      hiddenImportant: (count) => `hidden important ${count}`,
      wrongPerson: (count) => `wrong person ${count}`,
      wrongContent: (count) => `wrong content ${count}`,
      sentByMistake: (count) => `sent by mistake ${count}`,
    },
    handled: (rate) => `Handled for you: ${rate}`,
    wouldHandle: (rate) => `Would handle (shadow mode): ${rate}`,
    urgent: (p90, noticed, withoutNotice) =>
      `Urgent notice time: p90 ${p90 === null ? "–" : `${p90} min`} (${noticed} ${noticed === 1 ? "notice" : "notices"}${withoutNotice > 0 ? `, ${withoutNotice} without a notice` : ""})`,
    urgentNone: "Urgent notice time: no urgent mail",
    cost: (perMailbox, target, unpricedCalls) =>
      `Cost: $${perMailbox} per mailbox per month (target ≤ $${target})${unpricedCalls > 0 ? `, ${unpricedCalls} ${unpricedCalls === 1 ? "call" : "calls"} without a price` : ""}`,
    category: { urgent: "urgent", needs_reply: "reply", info: "info", notification: "notification", spam: "spam" },
    autoEnough: (category, percent, labels) => `${category} ${percent}% of ${labels} labels`,
    autoLower: (percent) => `(lower bound ${percent}%)`,
    autoFew: (category, labels, minimum) => `${category} fewer than ${minimum} labels (${labels})`,
    auto: (items) => `Auto: ${items}`,
    autoNone: "Auto: no category on auto",
    autoOn: (category, proof, check) => `${category}: auto on · proof ${proof} · check ${check}`,
    autoPaused: (category, reason) => `${category}: paused (${reason})`,
    proof: { go: "go", noGo: "no-go", none: "none" },
    check: { pass: "pass", fail: "fail", inconclusive: "inconclusive", noResult: "no result", none: "none" },
    pauseReason: {
      corrections: "you corrected its moves",
      important_hidden: "it hid a mail you needed",
      model_switch: "the AI model changed",
      evidence_changed: "new test results",
      history_fail: "the check of your last 30 days failed",
    },
    review: (count) => `/review: ${count} replied ${count === 1 ? "mail waits" : "mails wait"} for a check.`,
    suggestions: {
      line: (open, link) =>
        `💡 ${open} rule ${open === 1 ? "suggestion waits" : "suggestions wait"} for you · ${link ?? (open === 1 ? "check it in the panel" : "check them in the panel")}`,
    },
    replyDrafts: {
      line: (c) =>
        `✍️ Reply drafts: ${c.made} made · ${c.sentByTap} sent by tap · ${c.sentByUser} sent by you · ${c.rejected} rejected · ${c.expired} expired · ${c.closed} closed`,
    },
  },
};
