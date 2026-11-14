import { z } from "zod";

import { categories } from "./categories";

export const senderRelations = ["delegate", "vip", "bulk", "known", "new"] as const;
export type SenderRelation = (typeof senderRelations)[number];
export const bulkSignals = ["list_id", "list_unsubscribe", "noreply", "auto_submitted"] as const;

const count = z.number().int().min(0);

// Counts and flags only: this type has no text field (ADR 0034).
export const senderHistorySchema = z
  .object({
    days: z.number().int().positive().max(365),
    received: count,
    byCategory: z.partialRecord(z.enum(categories), count),
    corrections: z.partialRecord(z.enum(categories), count),
    movedBack: count,
    answered: count,
    flagged: count,
    unseen7d: count,
    userMailsTo: count,
    lastUserMailDaysAgo: count.nullable(),
    delegationsTo: count,
    bulkSignals: z.array(z.enum(bulkSignals)),
    firstSeenDaysAgo: count.nullable(),
    lastSeenDaysAgo: count.nullable(),
    // The user's reply delay to the sender; null below 5 samples.
    medianUserReplyHours: z.number().min(0).nullable(),
    // The sender's reply delay to the user; null below 5 samples.
    medianTheirReplyHours: z.number().min(0).nullable(),
    relation: z.enum(senderRelations),
  })
  .strict();
export type SenderHistory = z.infer<typeof senderHistorySchema>;

// The order is delegate, vip, bulk (bulk signals on more than half of the mail), known (answered or wrote at least once), new.
export function relationOf(input: {
  isDelegate: boolean;
  isVip: boolean;
  received: number;
  bulkMails: number;
  answered: number;
  userMailsTo: number;
}): SenderRelation {
  if (input.isDelegate) return "delegate";
  if (input.isVip) return "vip";
  if (input.bulkMails * 2 > input.received) return "bulk";
  if (input.answered > 0 || input.userMailsTo > 0) return "known";
  return "new";
}
