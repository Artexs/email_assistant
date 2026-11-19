// The Telegram detail level (the link step and the linked card), the owner's lock of it and the notice routes of Settings.
export const enDetail = {
  // The choice of what Telegram gets: the link step and the change dialog
  tgd_title: "What Telegram gets",
  tgd_minimal_option: "Counts and links only (recommended)",
  tgd_minimal_text: "Telegram gets how many items wait and a link to the panel. No sender, subject, summary or draft.",
  tgd_full_option: "Full",
  tgd_full_text:
    "Telegram gets the sender, subject, AI summary and drafts, with Send buttons. Telegram stores these messages on its servers.",
  tgd_locked: "Your organization allows only counts and links.",
  tgd_locked_now:
    "Your organization locks Telegram to counts and links. Your choice, Full, applies again when the lock ends.",
  tgd_minimal_short: "Counts and links only",
  tgd_full_short: "Full",
  tgd_current_label: "What Telegram gets now",
  tgd_change: "Change",
  tgd_change_title: "Change what Telegram gets",
  tgd_saved_toast: "Telegram settings saved.",

  // The owner's lock card of Settings
  tgl_title: "Telegram detail for the organization",
  tgl_label: "Telegram: counts and links only for everyone",
  tgl_help:
    "While this is on, Telegram gets counts and links only, whatever each person chose. Their own choices come back when you turn it off.",
  tgl_state_on: "Telegram gets counts and links only for everyone in your organization.",
  tgl_state_off: "Each person chooses what Telegram gets.",
  tgl_on_toast: "Telegram now gets counts and links only for everyone.",
  tgl_off_toast: "The lock is off. Each person chooses again.",

  // The notice routes card of Settings
  nr_title: "Where notices go",
  nr_help:
    "Choose for each kind of notice: Telegram, your phone or both. Digests and reports stay in Telegram and mail.",
  nr_group_urgent: "Urgent mail",
  nr_group_approvals: "Approvals",
  nr_group_updates: "Updates",
  nr_telegram: "Telegram",
  nr_phone: "Phone",
  nr_both: "Both",
  nr_default: "{value} (default)",
  nr_none_hint:
    "You have no Telegram chat and no device with notices. Link Telegram or turn on phone notices to get notices.",
  nr_use_default: "Use the defaults",
  nr_saved_toast: "Notice settings saved.",
} as const;
