import { z } from "zod";

import { senderRelations } from "../triage/sender-history";

export const suggestionKinds = ["vip", "whitelist", "blocklist"] as const;
export type SuggestionKind = (typeof suggestionKinds)[number];
export const suggestionScopes = ["address", "domain"] as const;
export type SuggestionScope = (typeof suggestionScopes)[number];
export const suggestionStatuses = ["open", "accepted", "dismissed", "withdrawn", "expired"] as const;
export type SuggestionStatus = (typeof suggestionStatuses)[number];

const count = z.number().int().min(0);

// Counts only, stored as JSON: this type has no text field (ADR 0034).
export const suggestionReasonSchema = z
  .object({
    received: count.optional(),
    answered: count.optional(),
    flagged: count.optional(),
    corrected: count.optional(),
    rescued: count.optional(),
    senders: count.optional(),
  })
  .strict();
export type SuggestionReason = z.infer<typeof suggestionReasonSchema>;

// One per address, built in memory by the caller from the profile rows and the rule tables.
export interface SuggestionInput {
  address: string;
  domain: string;
  isFreeMailDomain: boolean;
  isOwnDomain: boolean;
  isOwn: boolean;
  isNoreply: boolean;
  relation: (typeof senderRelations)[number];
  received30: number;
  answered30: number;
  flagged30: number;
  correctedToSpam90: number;
  // Distinct mails that the user moved back or corrected away from `spam` or `notification` (one mail counts once).
  rescued90: number;
  answered90: number;
  userMailsTo90: number;
  suspicious90: number;
  isVip: boolean;
  isWhitelisted: boolean;
  isBlocklisted: boolean;
  isDelegate: boolean;
}

export interface SuggestionCandidate {
  kind: SuggestionKind;
  scope: SuggestionScope;
  // The address, or `@domain`.
  pattern: string;
  // `keyOf(pattern)`: the keyed hash, so the dedupe sets never hold a plain address.
  key: string;
  reason: SuggestionReason;
}

export interface SuggestionContext {
  // Keys of the form `kind:scope:key`.
  dismissed: ReadonlySet<string>;
  open: ReadonlySet<string>;
  createdLast7Days: number;
  sentCoverage: boolean;
  keyOf(value: string): string;
}
