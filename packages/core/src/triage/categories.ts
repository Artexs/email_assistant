import { z } from "zod";

export const categories = ["urgent", "needs_reply", "delegation", "info", "notification", "spam", "unsure"] as const;
export type Category = (typeof categories)[number];
export const categorySchema = z.enum(categories);

// The categories the LLM may pick in S1b. `delegation` waits for S4; `unsure` never comes from the LLM.
export const classifierCategories: readonly Category[] = ["urgent", "needs_reply", "info", "notification", "spam"];

export const mailboxModes = ["shadow", "assist"] as const;
export type MailboxMode = (typeof mailboxModes)[number];

export const reasonCodes = [
  "deadline_today",
  "direct_request",
  "question",
  "meeting_request",
  "automated_system",
  "newsletter",
  "marketing",
  "phishing_or_scam",
  "fyi",
  "other",
] as const;
export type ReasonCode = (typeof reasonCodes)[number];

// `triage_results.reason_code` of a row without an LLM answer.
export const ruleReasonCodes = ["blocklist", "triage_error", "llm_blocked"] as const;

export const feedbackSources = ["cli", "telegram", "undo", "imap_move", "web"] as const;
export type FeedbackSource = (typeof feedbackSources)[number];

export const feedbackVerdicts = ["right", "wrong"] as const;
export type FeedbackVerdict = (typeof feedbackVerdicts)[number];

// Only the `reason_code` of the `email.triaged` audit row when the threshold made the category `unsure`.
export const BELOW_THRESHOLD_REASON = "below_threshold";
