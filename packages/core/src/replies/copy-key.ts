import { normalizeDraftText } from "./text";

// The copy of a draft as the mail server holds it: what the committer reads back after APPEND and again before the
// send. `draftCopyKey` gives the canonical string of it; the hash of that string (`draftCopyHash`, module
// `actions`) is the baseline of the edit check. A server may re-encode the text or fold a header, so the key holds only
// what a person can change: the text, the Subject, the To and Cc addresses and the attachment list. Pure code.
export interface DraftCopy {
  /** The plain text of the copy. Null when it cannot be read: the key then never equals the key of a real text. */
  text: string | null;
  subject: string;
  to: readonly string[];
  cc: readonly string[];
  attachmentCount: number;
  /** In part order. */
  attachments: readonly { name: string | null; type: string; size: number }[];
}

// A set: lower case, trimmed, no duplicate, sorted.
function addressKey(addresses: readonly string[]): string[] {
  return [...new Set(addresses.map((address) => address.trim().toLowerCase()))].sort();
}

// A text with its length in front: `a|b` and `c` never give the same string as `a` and `b|c`.
function lengthPrefixed(text: string): string {
  return `${text.length}:${text}`;
}

// `name|type|size` with the name and the type length-prefixed. No name is `-`: it differs from the empty name `0:`.
function attachmentKey(part: { name: string | null; type: string; size: number }): string {
  const name = part.name === null ? "-" : lengthPrefixed(part.name);
  return `${name}|${lengthPrefixed(part.type.toLowerCase())}|${part.size}`;
}

/**
 * A canonical JSON string. The text goes through `normalizeDraftText` (line ends, trailing spaces and blank lines);
 * the Subject has its white space collapsed; To and Cc are sets (lower case, no duplicate, sorted); each attachment is
 * `name|type|size` with the name and the type length-prefixed and the type in lower case; no name is `-`.
 */
export function draftCopyKey(copy: DraftCopy): string {
  return JSON.stringify({
    text: copy.text === null ? null : normalizeDraftText(copy.text),
    subject: copy.subject.replace(/\s+/g, " ").trim(),
    to: addressKey(copy.to),
    cc: addressKey(copy.cc),
    attachmentCount: copy.attachmentCount,
    attachments: copy.attachments.map(attachmentKey),
  });
}
