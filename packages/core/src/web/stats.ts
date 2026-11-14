// The numbers of one week (M1–M5, M7, M8). Counts and numbers only: no address, no subject, no mail id.
import { barCategories } from "../triage/metrics";

import { z } from "./zod";

const count = z.number().int().min(0);
const rate = z.number().min(0).max(1).nullable();

export const weekStatsSchema = z.strictObject({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mailboxId: z.uuid().nullable(), // null = all mailboxes of the organization
  m1: z.strictObject({
    important: count,
    misses: count,
    missesBySource: z.strictObject({ correction: count, review: count, moved_back: count, answered_check: count }),
    sample: z.strictObject({ labelled: count, important: count, misses: count, missRateUpper: rate }),
  }),
  m2: z.strictObject({ due: count, closedOnTime: count, surfacedOnTime: count, pending: count }),
  m3: z.strictObject({
    hiddenImportant: count,
    wrongPerson: count,
    wrongContent: count,
    sentMistake: count,
    total: count,
    notNeeded: count,
    noReason: count,
  }),
  m4: z.strictObject({ triaged: count, handled: count, wouldHandle: count }),
  m5: z.strictObject({
    urgent: count,
    noticed: count,
    withoutNotice: count,
    quietHours: count,
    p90Minutes: z.number().min(0).nullable(),
  }),
  m7: z.strictObject({
    llmUsdWeek: z.number().min(0),
    llmCalls: count,
    unpricedCalls: count,
    mailboxes: count,
    hostingUsdMonth: z.number().min(0),
    backupUsdMonth: z.number().min(0),
    perMailboxMonthUsd: z.number().min(0),
    targetUsd: z.number().min(0),
  }),
  // M8 is the evidence at the time of the computation, not of the week: only the newest week carries rows.
  m8: z
    .array(
      z.strictObject({
        mailboxId: z.uuid(),
        category: z.enum(barCategories),
        auto: z.boolean(),
        kept: count,
        precision: rate,
        recall: rate,
        wilsonLower: rate,
        decision: z.enum(["go", "no-go", "no-go: too few"]),
      })
    )
    .max(1000),
});
export type WeekStats = z.infer<typeof weekStatsSchema>;

export const statsQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(12).default(8),
  mailboxId: z.uuid().optional(),
});
export const statsResponseSchema = z.object({ weeks: z.array(weekStatsSchema) });
