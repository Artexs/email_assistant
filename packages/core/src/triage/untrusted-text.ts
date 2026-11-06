const EMAIL = /[^\s@<>()[\],;:"']+@[^\s@<>()[\],;:"']+\.[^\s@<>()[\],;:"']+/g;
const URL_PATTERN = /(?:https?:\/\/|www\.)\S+/gi;
const IBAN = /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]{4}){3,7}(?:[ -]?[A-Z0-9]{1,4})?\b/g;
const LONG_DIGITS = /(?<!\d)\d(?: ?\d){19,}(?!\d)/g;
const DATE_OR_PHONE = /(?<!\d)\d{4}-\d{2}-\d{2}(?!-?\d)|(?<![\d+])\+?\d(?:[ -]?\d){8,}(?!\d)/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Mail text for a chat message: links become "[link]".
export function removeLinks(text: string): string {
  return text.replace(URL_PATTERN, "[link]");
}

// LLM text is untrusted (architecture §7): remove links, account numbers, phone numbers and "@".
export function markUntrustedText(text: string): string {
  return text
    .replace(EMAIL, "[address]")
    .replace(URL_PATTERN, "[link]")
    .replace(IBAN, "[account number]")
    .replace(LONG_DIGITS, "[account number]")
    .replace(DATE_OR_PHONE, (match) => (ISO_DATE.test(match) ? match : "[phone]"))
    .replaceAll("@", "(at)");
}
