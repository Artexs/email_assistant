// The suggestions card of the Rules page (flag sender_suggestions). A reason holds counts only.
export const enSuggestions = {
  sg_title: "Suggestions",
  sg_help:
    "Rules that your mail points to. Nothing changes until an owner accepts a suggestion. A dismissed suggestion stays hidden for 90 days.",
  sg_mailbox_label: "Mailbox",
  sg_empty: "No suggestions now. They appear when your mail shows a clear pattern; at most 3 a week.",
  sg_load_error: "Could not load the suggestions.",
  sg_member_note: "Only an owner can accept suggestions.",
  sg_accept: "Accept",
  sg_accept_for: "Accept the suggestion for {pattern}",
  sg_dismiss: "Dismiss",
  sg_dismiss_for: "Dismiss the suggestion for {pattern}",
  sg_dismissed_toast: "Hidden for 90 days",
  sg_not_available: "This suggestion is no longer valid.",
  // The reason of a suggestion: counts of the mailbox, never mail text
  sg_reason_vip_answered: "You answered {answered} of {received} mails in 30 days.",
  sg_reason_vip_flagged: "You flagged {flagged} mails in 30 days.",
  sg_reason_whitelist: "You moved back or corrected {rescued} mails from spam or notifications in 90 days.",
  sg_reason_blocklist: "You marked {corrected} mails as spam in 90 days and never wrote to this sender.",
  sg_reason_whitelist_domain:
    "You moved back or corrected {rescued} mails from spam or notifications in 90 days, from {senders} senders of this domain.",
  sg_reason_blocklist_domain:
    "You marked {corrected} mails as spam in 90 days, from {senders} senders of this domain, and never wrote to any of them.",
} as const;
