import type { UserLocale } from "../tenancy";

import { pluralCategory } from "./locale";

// The "needs you today" block of the first digest of the day (open loops feature). One entry per fixed
// line; a function where the line holds values. Loop texts are in the language of the loop, these lines in the user's.
export interface BriefTexts {
  title: string;
  // "🔴 Jan Kowalski · Offer · 2 h": a mail that waits for the user's answer. `age` is `ageHours` or `ageDays`.
  urgentLine: (from: string, subject: string, age: string) => string;
  replyLine: (from: string, subject: string, age: string) => string;
  ageUnderHour: string;
  ageHours: (hours: number) => string;
  ageDays: (days: number) => string;
  // `who` is null when the loop holds no address any more. `what` is the loop text, else the subject.
  waitingLine: (who: string | null, since: string, what: string) => string;
  waitingMarker: { autoReply: string; wouldDraft: string; approval: string };
  promisedLine: (who: string | null, what: string, due: string) => string;
  staleLine: (subject: string) => string;
  more: (count: number, url: string | null) => string;
  // The lines of a user whose consent does not cover loop data: a count and no mail data.
  waitingCount: (count: number) => string;
  promisedCount: (count: number) => string;
  staleCount: (count: number) => string;
  consentAsk: string;
  // The count line of a later digest of the day: "Open loops: 3 waiting, 1 promise due".
  openLoops: (waiting: number, promised: number) => string;
}

const polish = (count: number, one: string, few: string, many: string): string =>
  ({ one, few, many, other: many })[pluralCategory("pl", count)];

export const briefTexts = {
  en: {
    title: "📌 NEEDS YOU TODAY",
    urgentLine: (from, subject, age) => `🔴 ${from} · ${subject} · ${age}`,
    replyLine: (from, subject, age) => `✍️ ${from} · ${subject} · ${age}`,
    ageUnderHour: "<1 h",
    ageHours: (hours) => `${hours} h`,
    ageDays: (days) => `${days} d`,
    waitingLine: (who, since, what) =>
      who === null ? `⏳ No answer since ${since} · ${what}` : `⏳ No answer from ${who} since ${since} · ${what}`,
    waitingMarker: {
      autoReply: "auto-reply only",
      wouldDraft: "would draft a follow-up",
      approval: "follow-up waits for your approval",
    },
    promisedLine: (who, what, due) =>
      who === null ? `🤝 You promised: ${what} · due ${due}` : `🤝 You promised ${who}: ${what} · due ${due}`,
    staleLine: (subject) => `⌛ Closed without an answer: ${subject}`,
    more: (count, url) => (url === null ? `+${count} more in the panel` : `+${count} more in the panel: ${url}`),
    waitingCount: (count) => `⏳ Waiting on others: ${count}`,
    promisedCount: (count) => `🤝 Promised: ${count}`,
    staleCount: (count) => `⌛ Closed without an answer: ${count}`,
    consentAsk: "Confirm the new Telegram terms in the panel to see them here.",
    openLoops: (waiting, promised) => {
      const parts = [
        ...(waiting > 0 ? [`${waiting} waiting`] : []),
        ...(promised > 0 ? [`${promised} ${promised === 1 ? "promise" : "promises"} due`] : []),
      ];
      return `🔁 Open loops: ${parts.join(", ")}`;
    },
  },
  pl: {
    title: "📌 DO ZAŁATWIENIA DZIŚ",
    urgentLine: (from, subject, age) => `🔴 ${from} · ${subject} · ${age}`,
    replyLine: (from, subject, age) => `✍️ ${from} · ${subject} · ${age}`,
    ageUnderHour: "<1 godz.",
    ageHours: (hours) => `${hours} godz.`,
    ageDays: (days) => `${days} ${polish(days, "dzień", "dni", "dni")}`,
    waitingLine: (who, since, what) =>
      who === null ? `⏳ Brak odpowiedzi od ${since} · ${what}` : `⏳ ${who} nie odpowiada od ${since} · ${what}`,
    waitingMarker: {
      autoReply: "tylko automatyczna odpowiedź",
      wouldDraft: "przygotowałbym przypomnienie o odpowiedzi",
      approval: "przypomnienie czeka na Twoje zatwierdzenie",
    },
    promisedLine: (who, what, due) =>
      who === null ? `🤝 Obietnica: ${what} · termin ${due}` : `🤝 Obietnica dla ${who}: ${what} · termin ${due}`,
    staleLine: (subject) => `⌛ Zamknięte bez odpowiedzi: ${subject}`,
    more: (count, url) => (url === null ? `+${count} więcej w panelu` : `+${count} więcej w panelu: ${url}`),
    waitingCount: (count) => `⏳ Czekasz na odpowiedź: ${count}`,
    promisedCount: (count) => `🤝 Obietnice: ${count}`,
    staleCount: (count) => `⌛ Zamknięte bez odpowiedzi: ${count}`,
    consentAsk: "Potwierdź nowe zasady Telegrama w panelu, aby zobaczyć je tutaj.",
    openLoops: (waiting, promised) => {
      const parts = [
        ...(waiting > 0 ? [`${waiting} ${polish(waiting, "oczekująca", "oczekujące", "oczekujących")}`] : []),
        ...(promised > 0
          ? [`${promised} ${polish(promised, "obietnica", "obietnice", "obietnic")} z terminem na dziś`]
          : []),
      ];
      return `🔁 Otwarte sprawy: ${parts.join(", ")}`;
    },
  },
} satisfies Record<UserLocale, BriefTexts>;
