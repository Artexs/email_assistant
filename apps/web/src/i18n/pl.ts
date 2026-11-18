import type { PluralKey, TextKey } from "./en";
import { plAuth } from "./texts/pl-auth";
import { plMailboxes } from "./texts/pl-mailboxes";
import { plSettings } from "./texts/pl-settings";
import { plActivity } from "./texts/pl-activity";
import { plApprovals } from "./texts/pl-approvals";
import { plReply } from "./texts/pl-reply";

// Polish texts. The key order and the section comments follow `en.ts` and `texts/en-*.ts`, so the files read side by side.
// Register and glossary: spec/features/active/F098-e7-t1-polish-ui-i18n-frame-first/plan.md (P6).
export const pl: Record<TextKey, string> = {
  ...plAuth,
  ...plMailboxes,
  ...plSettings,
  ...plActivity,
  ...plApprovals,
  ...plReply,
};

// Polish has three forms: one (1), few (2–4, 22–24 …), many (0, 5–21, 25–31 …).
export const plPlurals: Record<PluralKey, { one: string; few: string; many: string }> = {
  auth_error_banner: {
    one: "1 skrzynka ma błąd logowania.",
    few: "{count} skrzynki mają błąd logowania.",
    many: "{count} skrzynek ma błąd logowania.",
  },
  ob_mailbox_done: {
    one: "Połączono 1 skrzynkę.",
    few: "Połączono {count} skrzynki.",
    many: "Połączono {count} skrzynek.",
  },
  ob_rules: { one: "1 reguła", few: "{count} reguły", many: "{count} reguł" },
  op_sso_linked: {
    one: "{count} połączona osoba",
    few: "{count} połączone osoby",
    many: "{count} połączonych osób",
  },
  expired_suffix: {
    one: "Anulowano 1 zaplanowaną akcję.",
    few: "Anulowano {count} zaplanowane akcje.",
    many: "Anulowano {count} zaplanowanych akcji.",
  },
  // F116 stage 21: the wait of an open loop
  lp_working_days: { one: "1 dzień roboczy", few: "{count} dni robocze", many: "{count} dni roboczych" },
  // F116 stage 22
  lset_wait_days: { one: "1 dzień roboczy", few: "{count} dni robocze", many: "{count} dni roboczych" },
  // F110 stage 23: mails of a newsletter sender
  nl_count: {
    one: "1 e-mail w ciągu 30 dni",
    few: "{count} e-maile w ciągu 30 dni",
    many: "{count} e-maili w ciągu 30 dni",
  },
};
