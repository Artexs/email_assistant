import type { UserLocale } from "../tenancy";
import type { Category } from "../triage/categories";

import { pluralCategory } from "./locale";

// One entry per fixed string or line of the digest; a function where the line holds values.
export interface DigestTexts {
  header: (time: string, day: string, late: boolean) => string; // the scheduled digest
  headerNow: (day: string, time: string) => string; // the digest on demand
  since: (since: string, total: number, actions: number) => string;
  noMail: (since: string) => string;
  noMailbox: string;
  never: string;
  mailbox: {
    paused: (since: string, last: string) => string;
    authError: (since: string, last: string) => string;
    neverSynced: string;
    late: (last: string) => string;
    ok: (last: string) => string;
  };
  actionTitle: string;
  otherTitle: string;
  more: (count: number, parts: string) => string;
  moreName: Record<Category, string>;
  notProcessedOld: (count: number) => string;
  notProcessedBacklog: (count: number) => string;
  waiting: (count: number) => string;
  delegations: (open: number, overdue: number) => string;
  shadow: string;
}

const PL_MAILS = { one: "wiadomość", few: "wiadomości", many: "wiadomości", other: "wiadomości" } as const;
const PL_NEED = { one: "wymaga", few: "wymagają", many: "wymaga", other: "wymaga" } as const;
const PL_WAIT = { one: "czeka", few: "czekają", many: "czeka", other: "czeka" } as const;

export const digestTexts = {
  en: {
    header: (time, day, late) => `📬 Digest ${time} · ${day}${late ? " (late)" : ""}`,
    headerNow: (day, time) => `📬 Digest now · ${day} ${time}`,
    since: (since, total, actions) =>
      `Since ${since}: ${total} ${total === 1 ? "mail" : "mails"}, ${actions} need action`,
    noMail: (since) => `No new mail since ${since}.`,
    noMailbox: "Last sync: no mailbox connected",
    never: "never",
    mailbox: {
      paused: (since, last) => `⏸ Paused since ${since} · last sync ${last}`,
      authError: (since, last) => `❌ Login error since ${since} · last sync ${last}`,
      neverSynced: "⚠️ Last sync: never",
      late: (last) => `⚠️ Last sync ${last} (late)`,
      ok: (last) => `🔄 Last sync ${last}`,
    },
    actionTitle: "NEEDS ACTION",
    otherTitle: "OTHER MAIL",
    more: (count, parts) => `+${count} more: ${parts}`,
    moreName: {
      urgent: "urgent",
      needs_reply: "reply",
      delegation: "delegate",
      unsure: "unsure",
      info: "info",
      notification: "notification",
      spam: "spam",
    },
    notProcessedOld: (count) => `📭 Not processed (older than 7 days): ${count}`,
    notProcessedBacklog: (count) => `📭 Not processed (from the account pause): ${count}`,
    waiting: (count) => `⏳ Waiting for triage: ${count}`,
    delegations: (open, overdue) => `👥 Delegations: ${open} waiting for a reply, ${overdue} overdue`,
    shadow: "Shadow mode: the system changed nothing in your mailbox.",
  },
  pl: {
    header: (time, day, late) => `📬 Podsumowanie ${time} · ${day}${late ? " (spóźnione)" : ""}`,
    headerNow: (day, time) => `📬 Podsumowanie teraz · ${day} ${time}`,
    since: (since, total, actions) =>
      `Od ${since}: ${total} ${PL_MAILS[pluralCategory("pl", total)]}, ${actions} ${PL_NEED[pluralCategory("pl", actions)]} działania`,
    noMail: (since) => `Brak nowych wiadomości od ${since}.`,
    noMailbox: "Ostatnia synchronizacja: brak połączonej skrzynki",
    never: "nigdy",
    mailbox: {
      paused: (since, last) => `⏸ Wstrzymana od ${since} · ostatnia synchronizacja ${last}`,
      authError: (since, last) => `❌ Błąd logowania od ${since} · ostatnia synchronizacja ${last}`,
      neverSynced: "⚠️ Ostatnia synchronizacja: nigdy",
      late: (last) => `⚠️ Ostatnia synchronizacja ${last} (spóźniona)`,
      ok: (last) => `🔄 Ostatnia synchronizacja ${last}`,
    },
    actionTitle: "WYMAGA DZIAŁANIA",
    otherTitle: "POZOSTAŁE",
    more: (count, parts) => `+${count} więcej: ${parts}`,
    // Each name follows a count: "5 do odpowiedzi", "2 pilne".
    moreName: {
      urgent: "pilne",
      needs_reply: "do odpowiedzi",
      delegation: "do przekazania",
      unsure: "niepewne",
      info: "info",
      notification: "powiadomienia",
      spam: "spam",
    },
    notProcessedOld: (count) => `📭 Nieprzetworzone (starsze niż 7 dni): ${count}`,
    notProcessedBacklog: (count) => `📭 Nieprzetworzone (z czasu wstrzymania konta): ${count}`,
    waiting: (count) => `⏳ Czeka na klasyfikację AI: ${count}`,
    delegations: (open, overdue) =>
      `👥 Zlecenia: ${open} ${PL_WAIT[pluralCategory("pl", open)]} na odpowiedź, ${overdue} po terminie`,
    shadow: "Tryb podglądu: system niczego nie zmienił w Twojej skrzynce.",
  },
} satisfies Record<UserLocale, DigestTexts>;
