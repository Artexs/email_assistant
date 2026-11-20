import { DAY_MS } from "../time";
import type { Category, Suspicion } from "../triage";
import { isNoreplyAddress } from "../triage";

// Who may get a reply draft. One pure rule: the caller reads the facts, this function decides. No I/O.

export const REPLY_BLOCK_REASONS = [
  "not_checked",
  "category",
  "junk_source",
  "not_a_person",
  "own_mailbox",
  "suspicious",
  "calendar",
  "answered",
  "too_old",
  "language",
  "open_newer",
  "oauth_mailbox",
] as const;
export type ReplyBlockReason = (typeof REPLY_BLOCK_REASONS)[number];

export type ReplyTrigger = "auto" | "tap" | "redraft" | "sample";
export type ReplyLanguage = "pl" | "en";

// An automatic draft waits for mail of the last 7 days only.
export const REPLY_AUTO_MAX_AGE_MS = 7 * DAY_MS;

export interface ReplyHeaderFacts {
  listId: string | null;
  listUnsubscribe: string | null;
  autoSubmitted: string | null;
  precedence: string | null;
  hasCalendar: boolean;
}

export interface ReplyFacts {
  /** True when a `triage_results` row exists for the mail. */
  triaged: boolean;
  /** The category of the newest result; null when `triaged` is false. */
  category: Category | null;
  /** `triage_results.fields.language` of the newest result; "other" when it is missing or unknown. */
  language: "pl" | "en" | "other";
  /** The mail came from the junk folder of its mailbox. */
  fromJunk: boolean;
  /** The stored sender address; null when the mail has none. */
  fromAddress: string | null;
  /** The addresses of every mailbox of the organization. */
  ownAddresses: readonly string[];
  /** The captured headers; null when the mail has no `email_headers` row (stored before header capture). */
  headers: ReplyHeaderFacts | null;
  suspicion: Suspicion;
  /** `email_flags.answered` or a user reply in Sent. */
  answered: boolean;
  receivedAt: Date;
  /** The locale of the owner (`users.locale`); null reads as Polish. */
  ownerLocale: ReplyLanguage | null;
}

export type ReplyEligibility = { ok: true; language: ReplyLanguage } | { ok: false; reason: ReplyBlockReason };

const blocked = (reason: ReplyBlockReason): ReplyEligibility => ({ ok: false, reason });

// A header value counts when it holds more than white space.
function isSet(value: string | null): boolean {
  return value !== null && value.trim() !== "";
}

// `Auto-Submitted` is "no" or a keyword with optional parameters (RFC 3834). Anything else set is an automatic mail.
export function isAutoSubmitted(value: string | null): boolean {
  if (value === null || !isSet(value)) return false;
  return (value.split(";")[0] ?? "").trim().toLowerCase() !== "no";
}

const BULK_PRECEDENCE = new Set(["bulk", "list", "junk"]);

function isNotAPerson(facts: ReplyFacts, headers: ReplyHeaderFacts): boolean {
  // A mail with no sender has no address for the reply.
  if (facts.fromAddress === null || facts.fromAddress.trim() === "") return true;
  if (isNoreplyAddress(facts.fromAddress)) return true;
  if (isSet(headers.listId) || isSet(headers.listUnsubscribe)) return true;
  if (isAutoSubmitted(headers.autoSubmitted)) return true;
  return headers.precedence !== null && BULK_PRECEDENCE.has(headers.precedence.trim().toLowerCase());
}

// The order of the checks is the order of the reasons: the first failure is the answer. `open_newer` and `oauth_mailbox` are
// set by the callers (the drafter job, the switch), never here. A tap, a redraft and a sample skip the category, the age and
// the language rules: a person asked for the draft. They still need a triaged mail with headers, and they never pass a
// suspicious, junk, own, automatic, calendar or answered mail.
export function replyEligibility(facts: ReplyFacts, opts: { trigger: ReplyTrigger; now: Date }): ReplyEligibility {
  const headers = facts.headers;
  // Untriaged mail and mail stored before header capture are not checked: not clean, so no draft.
  if (!facts.triaged || facts.suspicion.state === "untriaged" || headers === null) return blocked("not_checked");
  // Any reason blocks every trigger, whatever the flag `suspicious_mail` says.
  if (facts.suspicion.state === "flagged") return blocked("suspicious");
  if (facts.fromJunk) return blocked("junk_source");
  const from = facts.fromAddress?.trim().toLowerCase() ?? "";
  if (from !== "" && facts.ownAddresses.some((own) => own.trim().toLowerCase() === from)) return blocked("own_mailbox");
  if (isNotAPerson(facts, headers)) return blocked("not_a_person");
  if (headers.hasCalendar) return blocked("calendar");
  if (facts.answered) return blocked("answered");
  const ownerLanguage: ReplyLanguage = facts.ownerLocale === "en" ? "en" : "pl";
  if (opts.trigger !== "auto") {
    return { ok: true, language: facts.language === "other" ? ownerLanguage : facts.language };
  }
  if (facts.category !== "needs_reply") return blocked("category");
  if (opts.now.getTime() - facts.receivedAt.getTime() > REPLY_AUTO_MAX_AGE_MS) return blocked("too_old");
  if (facts.language === "other") return blocked("language");
  return { ok: true, language: facts.language };
}
