import { cutText } from "../digest/text";
import type { OriginalMail } from "../outgoing/message";
import { cleanFromAddress, formatDateLabel, quotedLines } from "../outgoing/quote";
import { textTables } from "../texts";

// The display name of a sender in the quote line is read from a header that the sender controls: one line, cut.
export const QUOTE_NAME_MAX_CHARS = 100;

// The quote block of a reply: one header line ("On <date>, <name> wrote:" / "<date> <name> napisał(a):"), then the text of the
// original with `> ` on each line, at most `QUOTE_MAX_CHARS` code points. The date is in the time zone of the
// organization, as in `quoteOriginal`. `<name>` is the display name of the sender (`email_headers.from_name`), else the address.
// An original with no text gives "": a reply to an empty mail quotes nothing.
export function quoteReply(original: OriginalMail, language: "pl" | "en", timeZone: string): string {
  if ((original.bodyText ?? "").trim() === "") return "";
  const name = cutText(original.fromName ?? "", QUOTE_NAME_MAX_CHARS);
  const who = name === "" ? cleanFromAddress(original.fromAddress) : name;
  const date = formatDateLabel(original.receivedAt, timeZone, language);
  return `${textTables[language].replyMail.quoteHeader(date, who)}\n${quotedLines(original.bodyText)}`;
}
