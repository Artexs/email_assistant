import { formatDay, localDateTime } from "../digest/local-time";
import { cutText } from "../digest/text";

import type { OriginalMail } from "./message";

export const QUOTE_MAX_CHARS = 8000;
export const QUOTE_PREVIEW_CHARS = 1500;

const FROM_MAX_CHARS = 320;

function polishDay(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("pl-PL", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).formatToParts(at);
  const text = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${text("weekday")} ${text("day")} ${text("month")}`;
}

export function formatDateLabel(at: Date, timezone: string, language: "pl" | "en"): string {
  const day = language === "pl" ? polishDay(at, timezone) : formatDay(at, timezone, "en");
  return `${day} ${localDateTime(at, timezone).time}`;
}

// The sender address goes into a header line and a template line: one line, no control or bidi characters.
export function cleanFromAddress(fromAddress: string | null): string {
  const clean = fromAddress === null ? "" : cutText(fromAddress, FROM_MAX_CHARS);
  return clean === "" ? "(unknown sender)" : clean;
}

// The body is sender text: it is quoted as it is (the delegate must see the original). The header values are cleaned.
export function quoteOriginal(original: OriginalMail, language: "pl" | "en", timezone: string): string {
  const from = cleanFromAddress(original.fromAddress);
  const subject = cutText(original.subject ?? "", 200);
  const date = formatDateLabel(original.receivedAt, timezone, language);
  const header =
    language === "pl"
      ? `--- Oryginalna wiadomość ---\nOd: ${from}\nData: ${date}\nTemat: ${subject}\n\n`
      : `--- Original message ---\nFrom: ${from}\nDate: ${date}\nSubject: ${subject}\n\n`;
  const normalized = (original.bodyText ?? "").replace(/\r\n?/g, "\n");
  let body = "(no text)";
  if (normalized.trim() !== "") {
    const points = Array.from(normalized);
    body = points.length > QUOTE_MAX_CHARS ? `${points.slice(0, QUOTE_MAX_CHARS).join("")} […]` : normalized;
  }
  const quoted = body
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `${header}${quoted}`;
}

// Cuts on a line end when possible, for the approval message. Counts code points: no lone surrogate.
export function quoteCut(quote: string, max: number = QUOTE_PREVIEW_CHARS): { text: string; cut: boolean } {
  const points = Array.from(quote);
  if (points.length <= max) return { text: quote, cut: false };
  const head = points.slice(0, max).join("");
  const lineEnd = head.lastIndexOf("\n");
  return { text: lineEnd > 0 ? head.slice(0, lineEnd) : head, cut: true };
}
