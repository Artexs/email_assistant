import { convert } from "html-to-text";
import { simpleParser, type ParsedMail } from "mailparser";

import { CAPTURE_LIMITS } from "../port";
import type { CapturedAttachment, CapturedHeaders, CapturedLink, MailContent } from "../port";

import { stripNul } from "./clean";

const BODY_TEXT_LIMIT = 100_000;
const TOKEN = /^[a-z0-9-]{1,40}$/;
const BARE_HOST = /^[a-z0-9.-]+\.[a-z]{2,}$/;

/** Strips NUL, trims, makes well formed, cuts by code points (Postgres `char_length` counts code points). Empty → null. */
function cleanCut(value: string | undefined | null, limit: number): string | null {
  if (value === undefined || value === null) return null;
  const cleaned = stripNul(value).trim().toWellFormed();
  const cut = Array.from(cleaned).slice(0, limit).join("").trim();
  return cut === "" ? null : cut;
}

/** The value of the first (topmost) header line with this key, unfolded. */
function headerValue(parsed: ParsedMail, key: string): string | null {
  const entry = parsed.headerLines.find((header) => header.key === key);
  if (entry === undefined) return null;
  const colon = entry.line.indexOf(":");
  if (colon < 0) return null;
  const value = entry.line
    .slice(colon + 1)
    .replace(/\r?\n[ \t]+/g, " ")
    .trim();
  return value === "" ? null : value;
}

function token(value: string | null): string | null {
  if (value === null) return null;
  const word = (value.split(/[;\s,]/)[0] ?? "").toLowerCase();
  if (word === "") return null;
  return TOKEN.test(word) ? word : "other";
}

function returnPathOf(value: string | null): string | null {
  if (value === null) return null;
  const angle = /<([^>]*)>/.exec(value);
  const address = (angle === null ? value : (angle[1] ?? "")).trim().toLowerCase();
  return cleanCut(address, CAPTURE_LIMITS.returnPath);
}

function replyToOf(parsed: ParsedMail): string[] {
  const out: string[] = [];
  for (const entry of parsed.replyTo?.value ?? []) {
    const address = cleanCut(entry.address?.toLowerCase(), CAPTURE_LIMITS.returnPath);
    if (address !== null && !out.includes(address)) out.push(address);
  }
  return out.slice(0, CAPTURE_LIMITS.replyTo);
}

function hostOf(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return cleanCut(host, CAPTURE_LIMITS.host);
}

function httpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function textHostOf(innerHtml: string): string | null {
  const text = decodeEntities(innerHtml.replace(/<[^>]*>/g, "")).trim();
  const url = httpUrl(text);
  if (url !== null) return hostOf(url);
  const lower = text.toLowerCase();
  return BARE_HOST.test(lower) ? cleanCut(lower, CAPTURE_LIMITS.host) : null;
}

function linkPairs(parsed: ParsedMail): CapturedLink[] {
  const pairs: CapturedLink[] = [];
  const seen = new Set<string>();
  const add = (host: string | null, textHost: string | null): void => {
    if (host === null) return;
    const key = `${host} ${textHost}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ host, textHost });
  };
  if (typeof parsed.html === "string") {
    for (const match of parsed.html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(match[1] ?? "");
      const raw = href?.[1] ?? href?.[2] ?? href?.[3];
      if (raw === undefined) continue;
      const url = httpUrl(decodeEntities(raw).trim());
      if (url === null) continue;
      add(hostOf(url), textHostOf(match[2] ?? ""));
    }
  } else if (parsed.text !== undefined) {
    for (const match of parsed.text.matchAll(/https?:\/\/[^\s<>"')]+/g)) {
      const url = httpUrl(match[0]);
      if (url !== null) add(hostOf(url), null);
    }
  }
  return pairs;
}

function attachmentsOf(parsed: ParsedMail): CapturedAttachment[] {
  return parsed.attachments.map((part) => ({
    name: cleanCut(part.filename, CAPTURE_LIMITS.attachmentName),
    type: cleanCut(part.contentType.toLowerCase(), CAPTURE_LIMITS.attachmentType) ?? "application/octet-stream",
    size: Math.max(0, part.size ?? part.content.length),
    inline: part.contentDisposition === "inline" || (part.related === true && part.cid !== undefined),
  }));
}

function headerHasCalendar(parsed: ParsedMail): boolean {
  const type = headerValue(parsed, "content-type");
  return type !== null && type.toLowerCase().startsWith("text/calendar");
}

export function captureFromParsed(parsed: ParsedMail, opts: { partsKnown: boolean }): CapturedHeaders {
  const attachments = opts.partsKnown ? attachmentsOf(parsed) : [];
  const links = opts.partsKnown ? linkPairs(parsed) : [];
  return {
    fromName: cleanCut(parsed.from?.value[0]?.name, CAPTURE_LIMITS.fromName),
    replyTo: replyToOf(parsed),
    returnPath: returnPathOf(headerValue(parsed, "return-path")),
    authResults: cleanCut(headerValue(parsed, "authentication-results"), CAPTURE_LIMITS.authResults),
    listUnsubscribe: cleanCut(headerValue(parsed, "list-unsubscribe"), CAPTURE_LIMITS.listUnsubscribe),
    listId: cleanCut(headerValue(parsed, "list-id"), CAPTURE_LIMITS.listId),
    autoSubmitted: token(headerValue(parsed, "auto-submitted")),
    precedence: token(headerValue(parsed, "precedence")),
    hasCalendar: headerHasCalendar(parsed) || attachments.some((part) => part.type === "text/calendar"),
    attachments: attachments.slice(0, CAPTURE_LIMITS.attachments),
    attachmentCount: attachments.length,
    links: links.slice(0, CAPTURE_LIMITS.links),
    linkCount: links.length,
    partsKnown: opts.partsKnown,
  };
}

function textOf(parsed: ParsedMail): string | null {
  let text: string;
  if (parsed.text !== undefined && parsed.text.trim() !== "") {
    text = parsed.text;
  } else if (typeof parsed.html === "string" && parsed.html.trim() !== "") {
    text = convert(parsed.html, { wordwrap: false });
  } else {
    return null;
  }
  const cleaned = stripNul(text).trim();
  return cleaned === "" ? null : cleaned.slice(0, BODY_TEXT_LIMIT);
}

function safeCapture(
  parsed: ParsedMail,
  partsKnown: boolean,
  capture: typeof captureFromParsed
): CapturedHeaders | null {
  try {
    return capture(parsed, { partsKnown });
  } catch {
    return null;
  }
}

/** One `simpleParser` call: the text and the capture. Null when `simpleParser` fails. A capture error keeps the text. */
export async function contentFromSource(
  source: Buffer,
  capture: typeof captureFromParsed = captureFromParsed
): Promise<MailContent | null> {
  let parsed: ParsedMail;
  try {
    parsed = await simpleParser(source);
  } catch {
    return null;
  }
  let text: string | null;
  try {
    text = textOf(parsed);
  } catch {
    return null;
  }
  return { text, capture: safeCapture(parsed, true, capture) };
}

/** For a mail over the size limit: the header block only. `text` is null, `partsKnown` false. Null on a parse error. */
export async function contentFromHeaderBlock(headers: Buffer): Promise<MailContent | null> {
  try {
    const parsed = await simpleParser(Buffer.concat([headers, Buffer.from("\r\n\r\n")]));
    return { text: null, capture: safeCapture(parsed, false, captureFromParsed) };
  } catch {
    return null;
  }
}
