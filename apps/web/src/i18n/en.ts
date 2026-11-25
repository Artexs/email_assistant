import { enAuth } from "./texts/en-auth";
import { enMailboxes } from "./texts/en-mailboxes";
import { enSettings } from "./texts/en-settings";
import { enActivity } from "./texts/en-activity";
import { enApprovals } from "./texts/en-approvals";
import { enReply } from "./texts/en-reply";
import { enReplyPanel } from "./texts/en-reply-panel";
import { enPhone } from "./texts/en-phone";
import { enDetail } from "./texts/en-detail";
import { enSuggestions } from "./texts/en-suggestions";

// The texts are in `texts/en-<group>.ts`, one group per page area; the keys of two groups never repeat (`texts/groups.test.ts`).
export const en = {
  ...enAuth,
  ...enMailboxes,
  ...enSettings,
  ...enActivity,
  ...enApprovals,
  ...enReply,
  ...enReplyPanel,
  ...enPhone,
  ...enSuggestions,
  ...enDetail,
} as const;

export type TextKey = keyof typeof en;

// A count with one form per plural category: `tp` in `./index` picks the form.
export const enPlurals = {
  auth_error_banner: { one: "1 mailbox has a login error.", other: "{count} mailboxes have a login error." },
  ob_mailbox_done: { one: "1 mailbox connected.", other: "{count} mailboxes connected." },
  ob_rules: { one: "1 rule", other: "{count} rules" },
  op_sso_linked: { one: "{count} linked member", other: "{count} linked members" },
  expired_suffix: { one: "1 planned action was cancelled.", other: "{count} planned actions were cancelled." },
  // The wait of an open loop
  lp_working_days: { one: "1 working day", other: "{count} working days" },
  // Loop settings
  lset_wait_days: { one: "1 working day", other: "{count} working days" },
  // The lead of the approvals page
  appr_lead: { one: "1 draft waits for you", other: "{count} drafts wait for you" },
  // Mails of a newsletter sender
  nl_count: { one: "1 mail in 30 days", other: "{count} mails in 30 days" },
  // The push device card: the test notice
  push_test_sent: { one: "Test notice sent to 1 device.", other: "Test notice sent to {count} devices." },
  // The result of a style suggestion
  rs_suggest_result: { one: "Based on 1 sent mail", other: "Based on {count} sent mails" },
} as const;

export type PluralKey = keyof typeof enPlurals;
