import { dateLocale } from "../i18n";

// The end of a trial as a date in the organization's time zone ("1 December 2026").
export function trialDateText(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(dateLocale(), { timeZone, day: "numeric", month: "long", year: "numeric" }).format(
    new Date(iso)
  );
}
