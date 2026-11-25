// The user-visible strings of every default-off feature flag: a page under `src/content/docs` must not hold one,
// because a reader cannot know whether their organization has the flag on. `flagged-text.test.ts` scans the pages.
// The in-place operator sources are out of scope (operator text). A stage that meets a new flagged string adds it here.
import { featureFlags, type FeatureKey, type UserLocale } from "@ea/core";
import { en, type TextKey } from "@ea/web/i18n/en";
import { pl } from "@ea/web/i18n/pl";

export interface FlaggedText {
  flag: string;
  text: string;
}

// Panel keys: the English and the Polish text of each key are both flagged. A page reaches them as text or as `<UiText k />`.
export const FLAGGED_PANEL_KEYS: Partial<Record<FeatureKey, readonly TextKey[]>> = {
  stats_page: ["stats_caption", "stats_m4", "stats_note"],
  approvals_page: ["appr_list_label", "appr_detail_label", "appr_empty"],
  delegation_pages: ["dgn_remind", "dgn_keep", "dgn_none_title"],
  sent_sync: ["sent_switch", "sent_line", "sent_off_note"],
  security_log: ["sec_title", "sec_empty"],
  org_delete: ["del_title", "del_submit", "del_confirm_label"],
  sso_sign_in: ["login_sso_button", "login_sso_hint"],
  mail_oauth_microsoft: ["oauth_btn_microsoft"],
  mail_oauth_google: ["oauth_btn_google", "oauth_google_hint"],
  docs_links: ["help_link", "whats_new_title", "whats_new_all", "whats_new_dismiss"],
  user_quiet_hours: ["notify_quiet_title", "notify_quiet_use_default"],
  report_mail: ["notify_channel_title", "notify_channel_both"],
  urgency_editor: ["urg_title", "urg_topic_add"],
  bulk_unsubscribe: ["nl_open_link", "nl_none"],
  panel_review: ["title_review", "rv_thanks"],
  sender_context: ["sender_rel_bulk", "sender_wrote"],
  sender_suggestions: ["sg_help", "sg_member_note"],
  contact_wait: ["lp_usual_reply", "lp_usual_reply_one"],
  delegate_button: ["dla_title", "dla_select_placeholder"],
  trust_ladder: ["rep_intro", "rep_recommended"],
  reply_drafts: ["switch_reply_drafts"],
  web_push: ["push_title", "push_devices_title"],
};

// Telegram texts and lines of the digest: literal parts of `packages/core/src/texts` and `digest`, English and Polish.
// `flagged-text.test.ts` checks that each one still stands in those folders. A literal holds no quote or backslash.
export const FLAGGED_BOT_TEXT: Partial<Record<FeatureKey, readonly string[]>> = {
  review_command: ["/review", "Label a sample of recent mail", "Oznacz próbkę ostatnich wiadomości"],
  answered_check: ["that the assistant did not mark", "nie oznaczył jako"],
  mistake_capture: ["⚠️ This was a mistake", "⚠️ To był błąd", "✖️ Wrong person", "✖️ Zła osoba"],
  llm_pause_line: ["LLM paused since", "Klasyfikacja AI wstrzymana od"],
  weekly_report: ["📈 Week", "📈 Tydzień", "Random review sample"],
  handled_share: [
    "Handled in the last 7 days",
    "Would handle in the last 7 days",
    "Załatwione w ostatnich 7 dniach",
    "Załatwiłbym w ostatnich 7 dniach",
  ],
  suspicious_mail: [
    "⚠ Suspicious:",
    "⚠ Podejrzana wiadomość:",
    "no draft: suspicious mail",
    "bez szkicu: podejrzana wiadomość",
  ],
  attachment_line: ["📎"],
  spam_review_line: [
    "went to spam",
    "would have gone to spam",
    "wiadomość trafiła",
    "wiadomości trafiły",
    "wiadomości trafiło",
    "wiadomość trafiłaby",
    "wiadomości trafiłyby",
    "wiadomości trafiłoby",
  ],
  why_lines: [
    "rule: VIP sender",
    "rule: whitelisted sender",
    "rule: blocked sender",
    "reguła: nadawca VIP",
    "reguła: nadawca z listy dozwolonych",
    "reguła: nadawca z listy blokowanych",
  ],
  degraded_notice: [
    "is not triaged yet: the AI service is paused",
    "nie jest jeszcze posortowana: usługa AI ma przerwę",
  ],
  open_loops: ["📝 Follow-up", "Open loops on time", "A follow-up waits for your approval in the panel."],
  sent_sync: ["No sent mail seen for"],
  telegram_minimal: [
    "The review is in the panel",
    "Przegląd jest w panelu",
    "Your reply request has a result",
    "Jest wynik Twojej prośby o odpowiedź",
  ],
  sender_suggestions: ["suggestion waits", "suggestions wait", "Sugestie reguł do przejrzenia"],
  contact_wait: ["usual reply:", "zwykle odpowiada w"],
  // `sendLineEditable` of `digest/approvals.ts` shows for a reply and when the view sets `copyCheck`: each flag lists it.
  reply_drafts: ["edit and send in your mail client", "edytuj i wyślij w programie pocztowym"],
  draft_copy_check: ["edit and send in your mail client", "edytuj i wyślij w programie pocztowym"],
  report_mail: [
    "[Email assistant]",
    "[Asystent poczty]",
    "Mailbox check ready",
    "Sprawdzenie poczty gotowe",
    "Automatic moves paused",
    "Automatyczne przenoszenie wstrzymane",
  ],
};

// A default-off flag with no text that a user can see. The reason names the file that reads the flag and why no user sees text.
// Every flag has text now; a new flag with none gets its reason here.
export const NO_VISIBLE_TEXT: Partial<Record<FeatureKey, string>> = {
  style_from_sent:
    "it gates the owner route of the style suggestion, which no user can reach yet; the style-card button adds its text key when it lands",
};

export const FLAGGED_TEXT: FlaggedText[] = [
  ...Object.entries(FLAGGED_PANEL_KEYS).flatMap(([flag, keys]) =>
    (keys ?? []).flatMap((key) => [
      { flag, text: en[key] },
      { flag, text: pl[key] },
    ])
  ),
  ...Object.entries(FLAGGED_BOT_TEXT).flatMap(([flag, texts]) => (texts ?? []).map((text) => ({ flag, text }))),
];

const PLACEHOLDER = /\{[A-Za-z_][A-Za-z0-9_]*\}/;
const MIN_PART = 7;

// The searchable parts of a text: the pieces between its `{var}` placeholders. A short piece counts only when it is a pictograph
// (an emoji is the whole text of some lines).
export function literalParts(text: string): string[] {
  return text
    .split(new RegExp(PLACEHOLDER.source, "g"))
    .map((part) => normalize(part))
    .filter((part) => part.length >= MIN_PART || /\p{Extended_Pictographic}/u.test(part));
}

// Lower case, no Markdown emphasis or code marks, one space between words.
export function normalize(text: string): string {
  return text.replace(/[`*]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

const UI_TEXT_TAG = /<UiText\s+k=(?:"([^"]+)"|'([^']+)')\s*\/>/g;

// The page text that a reader could see: each `<UiText k="key" />` becomes the English and the Polish panel text of the key.
export function expandUiText(source: string): string {
  const panel = { en, pl } as Record<UserLocale, Record<string, string>>;
  return source.replace(UI_TEXT_TAG, (_tag, double: string | undefined, single: string | undefined) => {
    const key = double ?? single ?? "";
    return ` ${panel.en[key] ?? ""} ${panel.pl[key] ?? ""} `;
  });
}

// `<flag>: <text>` for every flagged string that the page holds while its flag defaults off.
export function flaggedTextProblems(
  source: string,
  entries: readonly FlaggedText[] = FLAGGED_TEXT,
  defaultOn: (flag: string) => boolean = (flag) =>
    (featureFlags as Record<string, { default: boolean }>)[flag]?.default === true
): string[] {
  const page = normalize(expandUiText(source));
  const problems: string[] = [];
  for (const { flag, text } of entries) {
    if (defaultOn(flag)) continue;
    if (literalParts(text).some((part) => page.includes(part))) problems.push(`${flag}: ${text}`);
  }
  return problems;
}
