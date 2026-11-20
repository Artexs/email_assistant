// Feature flag registry (ADR 0027, docs/decisions/0027-operator-role-and-feature-flags.md). Pure: no process.env, no Date.now() inside the functions.
// Every new behaviour that a user can see ships behind a flag listed here: default off, owner epic, remove-by date.

export interface FeatureFlag {
  default: boolean;
  /** One English line: what a user sees when the flag is on. */
  description: string;
  /** Owner epic, e.g. "E3a", "E4-A". */
  epic: string;
  /** YYYY-MM-DD. After this day the flag is a cleanup ticket. */
  removeBy: string;
}

export const featureFlags = {
  stats_page: { default: false, description: "The stats page in the panel.", epic: "E3a", removeBy: "2027-03-01" },
  approvals_page: {
    default: false,
    description: "The approvals page in the panel.",
    epic: "E4-A",
    removeBy: "2027-03-01",
  },
  delegation_pages: {
    default: false,
    description: "The delegates and delegations pages in the panel.",
    epic: "E4-A",
    removeBy: "2027-03-01",
  },
  sent_sync: {
    default: false,
    description: "Read the Sent folder of a mailbox (read only).",
    epic: "E5a",
    removeBy: "2027-03-01",
  },
  security_log: {
    default: false,
    description: "The security log in the Account card (owners).",
    epic: "E7-T2",
    removeBy: "2027-03-01",
  },
  review_command: {
    default: false,
    description: "The /review command in Telegram: label a random sample of recent mail.",
    epic: "E2a",
    removeBy: "2027-03-01",
  },
  mistake_capture: {
    default: false,
    description: "Reason buttons after a reject and a 'this was a mistake' button on a sent mail.",
    epic: "E3a",
    removeBy: "2027-03-01",
  },
  llm_pause_line: {
    default: false,
    description: "/status and the digest name an LLM pause and its cause.",
    epic: "E3a",
    removeBy: "2027-03-01",
  },
  weekly_report: {
    default: false,
    description: "The weekly report message on Monday.",
    epic: "E3a",
    removeBy: "2027-03-01",
  },
  handled_share: {
    default: false,
    description: "The handled-share line in the daily digest.",
    epic: "E3a",
    removeBy: "2027-03-01",
  },
  answered_check: {
    default: false,
    description: "In /review: mails you replied to that the assistant did not mark 'needs reply'.",
    epic: "E3a",
    removeBy: "2027-03-01",
  },
  org_delete: {
    default: false,
    description: "Delete the organization in the Account card (owners).",
    epic: "E7-T3",
    removeBy: "2027-03-01",
  },
  sso_sign_in: {
    default: false,
    description: "Sign in with the company account (SSO).",
    epic: "E7-T7",
    removeBy: "2027-06-01",
  },
  suspicious_mail: {
    default: false,
    description: "Suspicious mail gets a warning and no delegation draft.",
    epic: "E3b",
    removeBy: "2027-03-01",
  },
  attachment_line: {
    default: false,
    description: "Notices list the attachments of a mail (name, size).",
    epic: "E3b",
    removeBy: "2027-03-01",
  },
  degraded_notice: {
    default: false,
    description: "During an AI pause, mail from VIP and whitelisted senders gets a 'not triaged yet' notice.",
    epic: "E3b",
    removeBy: "2027-03-01",
  },
  mail_oauth_microsoft: {
    default: false,
    description: "Connect a Microsoft 365 or Outlook mailbox with Microsoft sign-in.",
    epic: "E9a",
    removeBy: "2027-06-01",
  },
  mail_oauth_google: {
    default: false,
    description: "Connect a Gmail mailbox with Google sign-in.",
    epic: "E9a",
    removeBy: "2027-06-01",
  },
  open_loops: {
    default: false,
    description: "Open loops: replies you wait for, promises and hand forwards, in the brief, Telegram and the panel.",
    epic: "E5b",
    removeBy: "2027-06-01",
  },
  delegate_button: {
    default: false,
    description: "A Delegate button and delegate picker on digest rows in Telegram and the panel.",
    epic: "E5b",
    removeBy: "2027-06-01",
  },
  trust_ladder: {
    default: false,
    description: "Automatic moves follow the evidence of the model setup: global holdout, history check, tripwire.",
    epic: "E4-B",
    removeBy: "2027-03-01",
  },
  panel_review: {
    default: false,
    description: "An optional page in the panel where you check a sample of 10 decisions of the assistant.",
    epic: "E4-B",
    removeBy: "2027-03-01",
  },
  why_lines: {
    default: false,
    description:
      "The digest, the urgent notice and the Activity page show how sure the system was and which sender rule hit.",
    epic: "E4-B",
    removeBy: "2027-03-01",
  },
  docs_links: {
    default: false,
    description: "The Help link and the What is new card in the panel.",
    epic: "E10a",
    removeBy: "2027-06-01",
  },
  user_quiet_hours: {
    default: false,
    description: "Each member sets their own quiet hours: their notices wait until those hours end.",
    epic: "E4-B",
    removeBy: "2027-03-01",
  },
  report_mail: {
    default: false,
    description: "A member can get the digest and the trust reports by mail in their own inbox.",
    epic: "E4-B",
    removeBy: "2027-03-01",
  },
  urgency_editor: {
    default: false,
    description: 'The "What is urgent for me" card on the Rules page: topics and deadlines per mailbox.',
    epic: "E4-B",
    removeBy: "2027-03-01",
  },
  spam_review_line: {
    default: false,
    description: "The digest names how many mails went to spam since the last digest and links to the list to review.",
    epic: "E4-B",
    removeBy: "2027-03-01",
  },
  bulk_unsubscribe: {
    default: false,
    description:
      "A Newsletters list in the panel: the senders with their unsubscribe method, and one tap to unsubscribe.",
    epic: "E4-B",
    removeBy: "2027-03-01",
  },
  reply_drafts: {
    default: false,
    description: "Reply drafts: the assistant writes a reply for mail that needs one and asks you to approve it.",
    epic: "E6a",
    removeBy: "2027-06-01",
  },
  draft_copy_check: {
    default: false,
    description:
      "Before a send, the system compares the Drafts copy with the one it made and stops when you changed it (reply drafts always check).",
    epic: "E6a",
    removeBy: "2027-06-01",
  },
  style_from_sent: {
    default: false,
    description:
      "An owner can ask the assistant to suggest a writing style from the sent mail of the last 14 days (needs reply_drafts and sent_sync).",
    epic: "E6b",
    removeBy: "2027-03-01",
  },
  sender_context: {
    default: false,
    description:
      "The assistant keeps a count-only profile of each sender (no mail text, no plain address) and shows one line about the sender in Activity and Approvals.",
    epic: "E11a",
    removeBy: "2027-06-01",
  },
  contact_wait: {
    default: false,
    description:
      "An open loop waits as long as its contact usually takes to reply. It counts as off unless sender_context is on.",
    epic: "E11a",
    removeBy: "2027-06-01",
  },
  sender_suggestions: {
    default: false,
    description:
      "The Rules page suggests VIP, whitelist and blocklist rules from the sender profiles, with a reason. It counts as off unless sender_context is on.",
    epic: "E11a",
    removeBy: "2027-06-01",
  },
  web_push: {
    default: false,
    description:
      "Notices as push messages on the phone or the computer where you installed the panel (kind, count and a link, no mail text).",
    epic: "E9",
    removeBy: "2027-06-01",
  },
  telegram_minimal: {
    default: false,
    description:
      "The Telegram detail level per member: a member on minimal gets counts and panel links, no mail text and no buttons.",
    epic: "E9",
    removeBy: "2027-06-01",
  },
} as const satisfies Record<string, FeatureFlag>;

export type FeatureKey = keyof typeof featureFlags;

/** Registry order. */
export const featureKeys = Object.keys(featureFlags) as FeatureKey[];

export function isFeatureKey(value: string): value is FeatureKey {
  return Object.hasOwn(featureFlags, value);
}

export const featureKeyPattern = /^[a-z][a-z0-9_]{0,39}$/;
export const featureEpicPattern = /^E\d{1,2}[a-z]?(-[A-Z][A-Z0-9]{0,2})?$/;

/** Keys whose `removeBy` is before `today` (YYYY-MM-DD). The day itself is not past. Registry order. */
export function expiredFlags(registry: Readonly<Record<string, FeatureFlag>>, today: string): string[] {
  return Object.entries(registry)
    .filter(([, flag]) => flag.removeBy < today)
    .map(([key]) => key);
}

export type FeatureSource = "env" | "row" | "default";

/** The read order: killed (FEATURES_OFF) → off; a row → its value; else the registry default. */
export function resolveFeature(input: { defaultOn: boolean; killed: boolean; row: boolean | undefined }): {
  enabled: boolean;
  source: FeatureSource;
} {
  if (input.killed) return { enabled: false, source: "env" };
  if (input.row !== undefined) return { enabled: input.row, source: "row" };
  return { enabled: input.defaultOn, source: "default" };
}
