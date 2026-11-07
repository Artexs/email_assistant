import { formatDay, localDateTime } from "../digest/local-time";
import { cutText } from "../digest/text";

import type { OriginalMail } from "./message";

export const QUOTE_MAX_CHARS = 8000;
export const QUOTE_PREVIEW_CHARS = 1500;

export function formatDateLabel(at: Date, timezone: string): string {
  return `${formatDay(at, timezone)} ${localDateTime(at, timezone).time}`;
}

// The quote is sender text: it is quoted as it is, not cleaned (the delegate must see the original).
export function quoteOriginal(original: OriginalMail, language: "pl" | "en", timezone: string): string {
  const from = original.fromAddress ?? "(unknown sender)";
  const subject = cutText(original.subject ?? "", 200);
  const date = formatDateLabel(original.receivedAt, timezone);
  const header =
    language === "pl"
      ? `--- Oryginalna wiadomość ---\nOd: ${from}\nData: ${date}\nTemat: ${subject}\n\n`
      : `--- Original message ---\nFrom: ${from}\nDate: ${date}\nSubject: ${subject}\n\n`;
  const normalized = (original.bodyText ?? "").replace(/\r\n?/g, "\n");
  let body = "(no text)";
  if (normalized.trim() !== "") {
    body = normalized.length > QUOTE_MAX_CHARS ? `${normalized.slice(0, QUOTE_MAX_CHARS)} […]` : normalized;
  }
  const quoted = body
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `${header}${quoted}`;
}

// Cuts on a line end when possible, for the approval message.
export function quoteCut(quote: string, max: number = QUOTE_PREVIEW_CHARS): { text: string; cut: boolean } {
  if (quote.length <= max) return { text: quote, cut: false };
  const head = quote.slice(0, max);
  const lineEnd = head.lastIndexOf("\n");
  return { text: lineEnd > 0 ? head.slice(0, lineEnd) : head, cut: true };
}
