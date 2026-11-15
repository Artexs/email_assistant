import type { UserLocale } from "../tenancy";
import { textsFor } from "../texts";
import { removeLinks } from "../triage/untrusted-text";

import { cutText } from "./text";

// The attachment line of a notice (F109 stage 06, D8): names, types and sizes of captured parts. Never the file or its content.
export interface AttachmentPart {
  name: string | null;
  type: string;
  size: number;
  inline: boolean;
}

export interface AttachmentLineInput {
  attachments: readonly AttachmentPart[];
  // The count of all parts of the mail. After retention the list is `[]` and the count stays.
  count: number;
}

export interface AttachmentFact extends AttachmentLineInput {
  attachments: AttachmentPart[];
}

export const ATTACHMENT_LINE_NAMES = 3;
export const ATTACHMENT_NAME_MAX = 40;

const KIB = 1024;
const MIB = 1024 * 1024;

// A signature image or a calendar part is not an attachment for the user (the calendar case has its own signal).
function isListed(part: AttachmentPart): boolean {
  return !part.inline && !part.type.toLowerCase().startsWith("text/calendar");
}

function sizeText(size: number, decimal: string): string {
  if (size < KIB) return `${Math.max(0, Math.round(size))} B`;
  const kilobytes = Math.round(size / KIB);
  if (kilobytes < KIB) return `${kilobytes} kB`;
  return `${(size / MIB).toFixed(1).replace(".", decimal)} MB`;
}

// The parts to show and how many there are. The list is cut at capture (20 parts), so the count of the mail may be larger.
function listed(input: AttachmentLineInput): { parts: AttachmentPart[]; total: number } {
  const parts = input.attachments.filter(isListed);
  const left = input.attachments.length - parts.length;
  return { parts, total: Math.max(parts.length, input.count - left) };
}

// What a notice stores (the fact): only the parts that the line may show, at most the names of the line, clean names, and the
// count. Null when the line would be empty, so a mail without an attachment adds no field to the view.
export function attachmentFact(input: AttachmentLineInput): AttachmentFact | null {
  const { parts, total } = listed(input);
  if (total <= 0) return null;
  return {
    attachments: parts.slice(0, ATTACHMENT_LINE_NAMES).map((part) => ({
      name: part.name === null ? null : cutText(removeLinks(part.name), ATTACHMENT_NAME_MAX),
      type: cutText(part.type, ATTACHMENT_NAME_MAX * 2),
      size: part.size,
      inline: false,
    })),
    count: total,
  };
}

// `📎 <n>: <name> (<size>), <name> (<size>), +<k> more`. No attachment: null.
export function attachmentLine(input: AttachmentLineInput, lang: UserLocale): string | null {
  const texts = textsFor(lang);
  const { parts, total } = listed(input);
  if (total <= 0) return null;
  const shown = parts.slice(0, ATTACHMENT_LINE_NAMES);
  const items = shown.map((part) => {
    const name = cutText(removeLinks(part.name ?? part.type), ATTACHMENT_NAME_MAX);
    return `${name === "" ? cutText(part.type, ATTACHMENT_NAME_MAX) : name} (${sizeText(part.size, texts.attachments.decimal)})`;
  });
  if (total > shown.length && shown.length > 0) items.push(texts.attachments.more(total - shown.length));
  return items.length === 0 ? `📎 ${total}` : `📎 ${total}: ${items.join(", ")}`;
}
