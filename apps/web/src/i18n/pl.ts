import type { PluralKey, TextKey } from "./en";
import { plAuth } from "./texts/pl-auth";
import { plMailboxes } from "./texts/pl-mailboxes";
import { plSettings } from "./texts/pl-settings";
import { plActivity } from "./texts/pl-activity";
import { plApprovals } from "./texts/pl-approvals";
import { plReply } from "./texts/pl-reply";
import { plReplyPanel } from "./texts/pl-reply-panel";
import { plPhone } from "./texts/pl-phone";
import { plDetail } from "./texts/pl-detail";
import { plSuggestions } from "./texts/pl-suggestions";

// Polish texts. The key order and the section comments follow `en.ts` and `texts/en-*.ts`, so the files read side by side.
// Register and glossary: `docs/code-patterns.md` (Polish texts).
export const pl: Record<TextKey, string> = {
  ...plAuth,
  ...plMailboxes,
  ...plSettings,
  ...plActivity,
  ...plApprovals,
  ...plReply,
  ...plReplyPanel,
  ...plPhone,
  ...plSuggestions,
  ...plDetail,
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
  // The wait of an open loop
  lp_working_days: { one: "1 dzień roboczy", few: "{count} dni robocze", many: "{count} dni roboczych" },
  // Loop settings
  lset_wait_days: { one: "1 dzień roboczy", few: "{count} dni robocze", many: "{count} dni roboczych" },
  // Mails of a newsletter sender
  nl_count: {
    one: "1 e-mail w ciągu 30 dni",
    few: "{count} e-maile w ciągu 30 dni",
    many: "{count} e-maili w ciągu 30 dni",
  },
  // The push device card: the test notice
  push_test_sent: {
    one: "Wysłano powiadomienie testowe na 1 urządzenie.",
    few: "Wysłano powiadomienie testowe na {count} urządzenia.",
    many: "Wysłano powiadomienie testowe na {count} urządzeń.",
  },
  // The result of a style suggestion
  rs_suggest_result: {
    one: "Podstawa: 1 wysłana wiadomość",
    few: "Podstawa: {count} wysłane wiadomości",
    many: "Podstawa: {count} wysłanych wiadomości",
  },
};
