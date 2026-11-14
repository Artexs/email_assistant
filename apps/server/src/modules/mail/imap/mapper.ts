import type { FetchMessageObject, MessageAddressObject } from "imapflow";

import { HardError } from "../../../platform/errors";
import type { FolderMessageMeta, MessageMeta } from "../port";

import { contentFromSource } from "./capture";
import { cleanOrNull, stripNul } from "./clean";

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

export function toFolderMessageMeta(msg: FetchMessageObject): FolderMessageMeta {
  return { ...toMessageMeta(msg), flags: [...(msg.flags ?? [])].sort() };
}

/** Plain text of a full RFC 822 source: the text part, else the html part as text. Null on a parse error or no text. */
export async function bodyTextFromSource(source: Buffer): Promise<string | null> {
  return (await contentFromSource(source))?.text ?? null;
}
