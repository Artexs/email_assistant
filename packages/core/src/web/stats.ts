// The numbers of one week (M1–M5, M7, M8). Counts and numbers only: no address, no subject, no mail id.
import { EVIDENCE_MIN_LABELS } from "../metrics/m8";
import { barCategories } from "../triage/metrics";
import { tripReasons } from "../trust/tripwire";

import { historyOutcomes } from "./trust";
import { z } from "./zod";

// The evidence of a category shows its precision only from this many real labels (PD-066).
export { EVIDENCE_MIN_LABELS };

const count = z.number().int().min(0);
const rate = z.number().min(0).max(1).nullable();

/** The kinds of loop (`open_loops.kind`). */
export const LOOP_KINDS = ["waiting", "promised", "delegated"] as const;
export type LoopKind = (typeof LOOP_KINDS)[number];
/** The kinds of the M2 split: the delegations of F4 and the three kinds of loop. */
export const M2_KINDS = ["delegation", ...LOOP_KINDS] as const;
export type M2Kind = (typeof M2_KINDS)[number];

const m2Tally = z.strictObject({ due: count, closedOnTime: count, surfacedOnTime: count, pending: count });

export const weekStatsSchema = z.strictObject({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mailboxId: z.uuid().nullable(), // null = all mailboxes of the organization
  m1: z.strictObject({
    important: count,
    misses: count,
    missesBySource: z.strictObject({ correction: count, review: count, moved_back: count, answered_check: count }),
    sample: z.strictObject({ labelled: count, important: count, misses: count, missRateUpper: rate }),
  }),
  m2: m2Tally.extend({
    // The split by kind. Present only when the organization has the flag `open_loops` on: the totals then hold the loops.
    byKind: z.strictObject({ delegation: m2Tally, waiting: m2Tally, promised: m2Tally, delegated: m2Tally }).optional(),
  }),
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
        // The three sources of ADR 0028 (F110). Null: the flag `trust_ladder` is off for the organization, or the caller has no trust reader.
        // A stored view of a report queued before F110 has no key: it reads null (the default).
        global: z
          .strictObject({
            decision: z.enum(["go", "no-go", "too-few", "none"]),
            provisional: z.boolean(),
            wilsonLower: rate,
            cases: count,
          })
          .nullable()
          .default(null),
        // The newest `done` history check; null: none yet, no result for this category, or no trust data.
        history: z
          .strictObject({ outcome: z.enum(historyOutcomes), acted: count, moved: count })
          .nullable()
          .default(null),
        trip: z
          .strictObject({ tripped: z.boolean(), reason: z.enum(tripReasons).nullable() })
          .nullable()
          .default(null),
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
