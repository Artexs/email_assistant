// Pure close rules of the open loops. A later mail from a person who is not the user ends a wait for a reply.
// No I/O: the server reads the rows and calls these functions. A wrong "match" hides a slip, so every doubt is "no match".

const DAY_MS = 86_400_000;
// The reach of the subject rule: a mail that is not in the thread counts only this long after the wait began.
export const SUBJECT_MATCH_DAYS = 30;
// Longest text that the rules read. The loop copy of a subject is at most 300 characters; a mail may carry more.
const MAX_SUBJECT = 500;
const MAX_HEADER = 20_000;

// `Re:`, `Odp:`, `Fwd:`, `FW:`, `PD:` in any case and with any spacing, repeated. Run after the spaces are collapsed:
// one space at most on each side of the colon, so the repeat cannot backtrack.
const SUBJECT_PREFIXES = /^(?:(?:re|odp|fwd|fw|pd) ?: ?)+/;

// Text that looks like a space or a mark but is none: NFKC turns a full-width colon and a no-break space into the plain
// character, and `\p{Cf}` / `\p{Cc}` drop zero-width, bidi and control characters. A look-alike letter (a Cyrillic "е" in
// "Rе:") stays as it is: the prefix is not stripped and the subject rule does not match (safe direction).
function plainText(text: string): string {
  return text
    .slice(0, MAX_SUBJECT * 4)
    .normalize("NFKC")
    .replace(/[\p{Cf}]/gu, "")
    .replace(/[\p{Cc}\p{Z}]+/gu, " ")
    .slice(0, MAX_SUBJECT);
}

// The subject without reply prefixes, spaces collapsed, lower case. An empty result never matches.
export function normalizeSubject(subject: string | null | undefined): string {
  const collapsed = plainText(subject ?? "")
    .replace(/ +/g, " ")
    .trim()
    .toLowerCase();
  return collapsed.replace(SUBJECT_PREFIXES, "").trim();
}

// The Message-ID tokens of an In-Reply-To or References value. `<id>` tokens when there are any (a comment next to them
// is ignored); else the bare words. An id is compared whole: `<x<id>>` or an id with a suffix is another id.
function messageIdsOf(value: string | null | undefined): string[] {
  if (value === null || value === undefined) return [];
  const text = value.slice(0, MAX_HEADER);
  const bracketed = [...text.matchAll(/<([^<>\s]+)>/g)].map((match) => match[1] as string);
  if (bracketed.length > 0) return bracketed;
  return text.split(/\s+/).filter((word) => word !== "" && !/[<>]/.test(word));
}

function bareMessageId(value: string | null): string | null {
  if (value === null) return null;
  const ids = messageIdsOf(value);
  return ids.length === 1 ? (ids[0] as string) : null;
}

const NO_REPLY_LOCAL_PARTS = new Set([
  "mailer-daemon",
  "postmaster",
  "no-reply",
  "noreply",
  "do-not-reply",
  "donotreply",
]);
const AUTO_PRECEDENCE = new Set(["bulk", "junk", "list", "auto-reply", "auto_reply"]);

function localPartOf(address: string): string {
  const at = address.lastIndexOf("@");
  const local = at < 0 ? address : address.slice(0, at);
  // `mailer-daemon+tag@` is the same sender; a dot or an underscore is the same word break.
  return (local.split("+")[0] ?? "").replace(/[._]/g, "-");
}

// An automatic answer never closes a loop. RFC 3834: any `Auto-Submitted` value except `no` marks an automatic mail;
// `Precedence` bulk, junk, list or auto_reply too; the system senders (`mailer-daemon`, `postmaster`, `noreply`) too.
export function isAutoReply(input: {
  autoSubmitted: string | null;
  precedence: string | null;
  fromAddress: string | null;
}): boolean {
  const autoSubmitted = (input.autoSubmitted ?? "").trim().toLowerCase();
  if (autoSubmitted !== "") {
    const token = autoSubmitted.split(/[\s;(]/)[0] ?? "";
    if (token !== "no") return true;
  }
  const precedence = (input.precedence ?? "").trim().toLowerCase();
  if (AUTO_PRECEDENCE.has(precedence)) return true;
  const from = (input.fromAddress ?? "").trim().toLowerCase();
  return from !== "" && NO_REPLY_LOCAL_PARTS.has(localPartOf(from));
}

export interface ReplyLoop {
  threadKey: string;
  messageId: string | null;
  toAddresses: readonly string[];
  ccAddresses: readonly string[];
  subject: string | null;
  waitFromAt: Date;
}

export interface ReplyMail {
  threadKey: string;
  receivedAt: Date;
  fromAddress: string | null;
  subject: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  autoSubmitted: string | null;
  precedence: string | null;
}

export type ReplyMatch = "thread" | "subject" | "auto";

const lower = (address: string): string => address.trim().toLowerCase();

// Does the mail answer the loop, and how? A mail counts only when it came after the wait began and its sender is not an
// own address. `auto`: an automatic mail that would match by thread or subject; it never closes.
export function replyMatch(
  loop: ReplyLoop,
  mail: ReplyMail,
  opts: { ownAddresses: readonly string[] }
): ReplyMatch | null {
  if (mail.fromAddress === null) return null;
  const from = lower(mail.fromAddress);
  if (from === "" || opts.ownAddresses.some((own) => lower(own) === from)) return null;
  const waitFrom = loop.waitFromAt.getTime();
  const received = mail.receivedAt.getTime();
  if (Number.isNaN(waitFrom) || Number.isNaN(received) || received <= waitFrom) return null;

  const loopId = bareMessageId(loop.messageId);
  const inThread =
    mail.threadKey === loop.threadKey ||
    (loopId !== null &&
      (messageIdsOf(mail.inReplyTo).includes(loopId) || messageIdsOf(mail.referencesHeader).includes(loopId)));

  let bySubject = false;
  if (!inThread && received <= waitFrom + SUBJECT_MATCH_DAYS * DAY_MS) {
    const subject = normalizeSubject(loop.subject);
    const recipients = [...loop.toAddresses, ...loop.ccAddresses].map(lower);
    bySubject = subject !== "" && normalizeSubject(mail.subject) === subject && recipients.includes(from);
  }
  if (!inThread && !bySubject) return null;
  if (isAutoReply({ autoSubmitted: mail.autoSubmitted, precedence: mail.precedence, fromAddress: from })) return "auto";
  return inThread ? "thread" : "subject";
}
