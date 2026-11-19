import type { NoticeKind } from "../notices/kinds";
import type { PushKind } from "../notices/push";
import { pushKinds } from "../notices/push";
import type { UserLocale } from "../tenancy";

import { pluralCategory } from "./locale";
import { pushTexts } from "./push";

// The texts of the `minimal` Telegram render: fixed phrases and numbers, never a string of a view (a sender, a subject, an address,
// a name). The line of a push kind is the push body with an emoji in front (one source for the count phrases); a kind with no push
// has its own phrase here (its count is always 1). The kinds that use the texts of the full render (`approval_edit`, `reply_prompt`)
// and the three that are built from facts (`digest`, `weekly_report`, `loop_consent`) are not in these tables.

const emojiOf: Record<PushKind, string> = {
  urgent: "🔴",
  not_triaged: "📥",
  approval: "📝",
  approval_set: "📝",
  replies_ready: "✍️",
  send_result: "📤",
  delegation_answered: "👥",
  send_held: "⏳",
  action_failed: "⚠️",
  auth_error: "❌",
  host_blocked: "⛔",
  sync_stale: "⚠️",
  sync_ok: "🔄",
  sent_missing: "📭",
  mailbox_removed: "📮",
};

/** The kinds whose `minimal` line is a fixed phrase of this file and not a push body. */
export const minimalOwnPhraseKinds = [
  "digest",
  "weekly_report",
  "trust_report_ready",
  "autonomy_paused",
  "reply_result",
] as const satisfies readonly NoticeKind[];
export type MinimalOwnPhraseKind = (typeof minimalOwnPhraseKinds)[number];

export interface MinimalTexts {
  /** One line: an emoji and the phrase of the kind with its count. Not for `approval_edit`, `reply_prompt` and `loop_consent`. */
  line(kind: Exclude<NoticeKind, "approval_edit" | "reply_prompt" | "loop_consent">, count: number): string;
  /** The line that stands for the link when `WEB_BASE_URL` is not set. */
  openPanel: string;
  /** The weekly report: two numbers. */
  weekly(triaged: number, handled: number): string;
  /** The digest: the count of mailboxes that have a problem. */
  mailboxProblems(count: number): string;
  /** `/status` names a mailbox by its place in the list, never by its address. */
  mailboxName(n: number): string;
  /** The answer to /review: the review is in the panel. `url` null: no link. */
  reviewInPanel(url: string | null): string;
}

const ownEn: Record<MinimalOwnPhraseKind, string> = {
  digest: "📬 Your digest is ready",
  weekly_report: "📊 Your weekly report is ready",
  trust_report_ready: "📋 Your mailbox check is ready",
  autonomy_paused: "⏸ Automatic moves were turned off for one category",
  reply_result: "✍️ A reply request has a result",
};

const ownPl: Record<MinimalOwnPhraseKind, string> = {
  digest: "📬 Podsumowanie jest gotowe",
  weekly_report: "📊 Raport tygodniowy jest gotowy",
  trust_report_ready: "📋 Sprawdzanie skrzynki jest gotowe",
  autonomy_paused: "⏸ Automatyczne przenoszenie wiadomości jednej kategorii zostało wstrzymane",
  reply_result: "✍️ Prośba o odpowiedź ma wynik",
};

const isOwn = (kind: string): kind is MinimalOwnPhraseKind =>
  (minimalOwnPhraseKinds as readonly string[]).includes(kind);
const isPush = (kind: string): kind is PushKind => (pushKinds as readonly string[]).includes(kind);

function lineOf(locale: UserLocale, own: Record<MinimalOwnPhraseKind, string>) {
  const push = pushTexts(locale);
  return (kind: string, count: number): string => {
    if (isOwn(kind)) return own[kind];
    if (isPush(kind)) return `${emojiOf[kind]} ${push.body(kind, count)}`;
    throw new Error(`no minimal phrase for ${kind}`);
  };
}

export const minimalTextTables = {
  en: {
    line: lineOf("en", ownEn),
    openPanel: "Open the panel",
    weekly: (triaged, handled) => `📊 Weekly report · sorted: ${triaged} · handled: ${handled}`,
    mailboxProblems: (count) =>
      pluralCategory("en", count) === "one" ? "⚠️ 1 mailbox has a problem" : `⚠️ ${count} mailboxes have a problem`,
    mailboxName: (n) => `Mailbox ${n}`,
    reviewInPanel: (url) => `🔎 The review is in the panel${url === null ? "." : `: ${url}`}`,
  },
  pl: {
    line: lineOf("pl", ownPl),
    openPanel: "Otwórz panel",
    weekly: (triaged, handled) => `📊 Raport tygodniowy · posortowano: ${triaged} · obsłużono: ${handled}`,
    mailboxProblems: (count) => {
      const category = pluralCategory("pl", count);
      return category === "one"
        ? "⚠️ 1 skrzynka ma problem"
        : category === "few"
          ? `⚠️ ${count} skrzynki mają problem`
          : `⚠️ ${count} skrzynek ma problem`;
    },
    mailboxName: (n) => `Skrzynka ${n}`,
    reviewInPanel: (url) => `🔎 Przegląd jest w panelu${url === null ? "." : `: ${url}`}`,
  },
} satisfies Record<UserLocale, MinimalTexts>;

export function minimalTexts(locale: UserLocale): MinimalTexts {
  return minimalTextTables[locale];
}
