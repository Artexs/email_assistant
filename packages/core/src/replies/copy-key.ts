import { normalizeDraftText } from "./text";

// The copy of a draft as the mail server holds it: what the committer reads back after APPEND and again before the
// send (F115 stage 08). `draftCopyKey` gives the canonical string of it; the hash of that string (`draftCopyHash`, module
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

function addressKey(addresses: readonly string[]): string[] {
  return addresses.map((address) => address.trim().toLowerCase()).sort();
}

/**
 * A canonical JSON string. The text goes through `normalizeDraftText` (line ends, trailing spaces and blank lines);
 * the Subject has its white space collapsed; the addresses are lower case and sorted; each attachment is
 * `name|type|size`, with the type in lower case.
 */
export function draftCopyKey(copy: DraftCopy): string {
  return JSON.stringify({
    text: copy.text === null ? null : normalizeDraftText(copy.text),
    subject: copy.subject.replace(/\s+/g, " ").trim(),
    to: addressKey(copy.to),
    cc: addressKey(copy.cc),
    attachmentCount: copy.attachmentCount,
    attachments: copy.attachments.map((part) => `${part.name ?? ""}|${part.type.toLowerCase()}|${part.size}`),
  });
}
