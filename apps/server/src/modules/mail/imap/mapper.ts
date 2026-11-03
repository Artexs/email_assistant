import { convert } from "html-to-text";
import type { FetchMessageObject, MessageAddressObject } from "imapflow";
import { simpleParser } from "mailparser";

import { HardError } from "../../../platform/errors";
import type { MessageMeta } from "../port";

const BODY_TEXT_LIMIT = 100_000;

// Postgres `text` rejects U+0000: one such mail would fail `insertEmail` on every run and block the cursor.
function stripNul(value: string): string {
  return value.replaceAll("\u0000", "");
}

function cleanOrNull(value: string | undefined): string | null {
  if (value === undefined) return null;
  const cleaned = stripNul(value).trim();
  return cleaned === "" ? null : cleaned;
}

function addresses(list: MessageAddressObject[] | undefined): string[] {
  const out: string[] = [];
  for (const entry of list ?? []) {
    const address = cleanOrNull(entry.address);
    if (address !== null) out.push(address);
  }
  return out;
}

function validDate(value: Date | string | undefined): Date | null {
  if (value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Parses a raw header block (as fetched with `headers: [...]`): lower-case names, folded lines unfolded. */
export function parseHeaderBlock(raw: Buffer | undefined): Map<string, string> {
  const headers = new Map<string, string>();
  if (!raw) return headers;
  const unfolded = raw.toString("utf8").replace(/\r?\n(?=[ \t])/g, "");
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!headers.has(name)) headers.set(name, line.slice(colon + 1).trim());
  }
  return headers;
}

export function toMessageMeta(msg: FetchMessageObject): MessageMeta {
  const internalDate = validDate(msg.internalDate);
  if (internalDate === null) {
    throw new HardError(`IMAP message uid ${msg.uid} has no valid INTERNALDATE`);
  }
  const envelope = msg.envelope;
  const headers = parseHeaderBlock(msg.headers);
  const references = stripNul(headers.get("references") ?? "")
    .split(/\s+/)
    .filter((id) => id !== "");
  return {
    uid: msg.uid,
    size: msg.size ?? 0,
    internalDate,
    date: validDate(envelope?.date),
    messageId: cleanOrNull(envelope?.messageId),
    inReplyTo: cleanOrNull(envelope?.inReplyTo),
    references,
    from: addresses(envelope?.from)[0] ?? null,
    to: addresses(envelope?.to),
    cc: addresses(envelope?.cc),
    subject: envelope?.subject === undefined ? null : stripNul(envelope.subject),
    actionId: cleanOrNull(headers.get("x-ea-action-id")),
  };
}

/** Plain text of a full RFC 822 source: the text part, else the html part as text. Null on a parse error or no text. */
export async function bodyTextFromSource(source: Buffer): Promise<string | null> {
  let text: string;
  try {
    const parsed = await simpleParser(source);
    if (parsed.text !== undefined && parsed.text.trim() !== "") {
      text = parsed.text;
    } else if (typeof parsed.html === "string" && parsed.html.trim() !== "") {
      text = convert(parsed.html, { wordwrap: false });
    } else {
      return null;
    }
  } catch {
    return null;
  }
  const cleaned = stripNul(text).trim();
  return cleaned === "" ? null : cleaned.slice(0, BODY_TEXT_LIMIT);
}
