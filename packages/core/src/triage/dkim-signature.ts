// What a `DKIM-Signature` header says it covers (RFC 6376 section 3.5). Our code never checks a signature: the trusted
// receiving server did that and wrote the result in `Authentication-Results`. This file reads only two tags of each
// signature header, the signing domain `d=` and the signed header names `h=`. The signature value `b=` and the body
// hash `bh=` are never read into the result.
//
// The reader fails closed. A mail with too many signature headers, a header that is too long, or a header that does not
// parse gets NO signature at all (an empty list), because one forged or odd signature header could be the one that the
// server verified, and we cannot tell which one it was.

import { z } from "zod";

export interface DkimSignature {
  /** The signing domain (`d=`), lower case. */
  d: string;
  /** The signed header names (`h=`), lower case, in the order of the tag, repeats kept. */
  h: string[];
}

export const DKIM_LIMITS = {
  /** More `DKIM-Signature` headers than this: no signature is kept. */
  signatures: 8,
  /** A longer raw header line (with its `b=`, `bh=` and `z=`): no signature is kept. */
  line: 16_384,
  /** Header names kept per signature; the rest are dropped (the list only gets shorter, so coverage is never invented). */
  names: 64,
  /** A longer name is not one of ours and is dropped. */
  nameLength: 40,
} as const;

/** The stored shape: what a database read must hold. A value that does not parse is not proof. */
export const dkimSignaturesSchema = z
  .array(z.object({ d: z.string(), h: z.array(z.string()) }))
  .max(DKIM_LIMITS.signatures) satisfies z.ZodType<DkimSignature[]>;

/** The two headers of RFC 8058 that the signature must cover. */
export const ONE_CLICK_HEADERS: readonly string[] = ["list-unsubscribe", "list-unsubscribe-post"];

const DOMAIN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const NAME = /^[a-z0-9-]+$/;

// Folding white space is allowed only around a tag value and around each `:` of `h=` (RFC 6376 section 3.5). Inside a
// name or a domain it makes the value invalid: it is not removed, so `list-unsub scribe` never becomes `list-unsubscribe`.
function trimFws(value: string): string {
  return value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
}

// One raw header line (`DKIM-Signature: v=1; d=...;` with its folds) to its tags. Tag names are case sensitive and
// must be unique (RFC 6376 section 3.2). null when the line does not parse.
function tagsOf(line: string): Map<string, string> | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const tags = new Map<string, string>();
  for (const part of line.slice(colon + 1).split(";")) {
    if (part.trim() === "") continue;
    const equals = part.indexOf("=");
    if (equals < 0) return null;
    const name = part.slice(0, equals).trim();
    if (name === "" || tags.has(name)) return null;
    tags.set(name, part.slice(equals + 1));
  }
  return tags;
}

function signatureOf(line: string): DkimSignature | null {
  if (line.length > DKIM_LIMITS.line) return null;
  const tags = tagsOf(line);
  const rawDomain = tags?.get("d");
  const rawNames = tags?.get("h");
  if (rawDomain === undefined || rawNames === undefined) return null;
  const d = trimFws(rawDomain).toLowerCase();
  if (!DOMAIN.test(d)) return null;
  const h: string[] = [];
  for (const raw of rawNames.split(":")) {
    const entry = trimFws(raw).toLowerCase();
    if (entry === "" || entry.length > DKIM_LIMITS.nameLength || !NAME.test(entry)) continue;
    if (h.length < DKIM_LIMITS.names) h.push(entry);
  }
  return { d, h };
}

/** The raw lines of all `DKIM-Signature` headers of one mail to what they cover. `[]` when there is no usable proof. */
export function dkimSignaturesOf(lines: readonly string[]): DkimSignature[] {
  if (lines.length > DKIM_LIMITS.signatures) return [];
  const found: DkimSignature[] = [];
  for (const line of lines) {
    const signature = signatureOf(line);
    if (signature === null) return [];
    found.push(signature);
  }
  return found;
}

/**
 * True when the `h=` list names both one-click headers. Each name in `h=` signs one instance of a header, counted from
 * the bottom (RFC 6376 section 5.4.2). The stored mail has exactly one line of each header (capture refuses a mail
 * with a repeated one), so one name each is enough.
 */
export function dkimCoversOneClickHeaders(h: readonly string[]): boolean {
  return ONE_CLICK_HEADERS.every((name) => h.includes(name));
}
