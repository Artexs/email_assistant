import type { UserLocale } from "../tenancy";

// The fixed words of the report mail (F110 stage 20). The subject and the sender name hold these words only: no mail text
// reaches a header. The title names the kind of the message; the body is the text of the Telegram notice.
export interface ReportMailTexts {
  // The display name of the sender and the recipient: the mailbox is the user's own.
  sender: string;
  // The start of every subject: `<prefix> <title>`.
  prefix: string;
  title: { digest: string; weekly_report: string; trust_report_ready: string; autonomy_paused: string };
}

export const reportMailTexts = {
  en: {
    sender: "Email assistant",
    prefix: "[Email assistant]",
    title: {
      digest: "Digest",
      weekly_report: "Weekly report",
      trust_report_ready: "Mailbox check ready",
      autonomy_paused: "Automatic moves paused",
    },
  },
  pl: {
    sender: "Asystent poczty",
    prefix: "[Asystent poczty]",
    title: {
      digest: "Podsumowanie",
      weekly_report: "Raport tygodniowy",
      trust_report_ready: "Sprawdzenie poczty gotowe",
      autonomy_paused: "Automatyczne przenoszenie wstrzymane",
    },
  },
} satisfies Record<UserLocale, ReportMailTexts>;
