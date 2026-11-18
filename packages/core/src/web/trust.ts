// The trust view of one mailbox: the one read model of the autonomy card, the report page and M8.
// Counts, codes, dates and the examples only. The examples hold a sender name and a subject: the panel is behind login and the
// view never goes to Telegram.
import { mailboxModes } from "../triage/categories";
import { barCategories, type BarCategory } from "../triage/metrics";
import { categoryGrantBy } from "../triage/settings";
import { evidenceBlocks } from "../trust/evidence";
import { evidenceKeySchema, movingCategories, type MovingCategory } from "../trust/key";
import { tripReasons } from "../trust/tripwire";

import { gateDecisions } from "./settings";
import { z } from "./zod";

const count = z.number().int().min(0);

export const historyCheckStatuses = [
  "queued",
  "backfilling",
  "waiting_flags",
  "classifying",
  "done",
  "no_result",
] as const;
export const historyCheckReasons = ["connect", "cli", "web", "model_switch", "flag_on"] as const;
export const noResultReasons = [
  "no_history",
  "uidvalidity",
  "cost_unknown",
  "stopped",
  "key_changed",
  "auth_refused",
  "model_failing",
] as const;
export const historyOutcomes = ["pass", "fail", "inconclusive", "no_result"] as const;

/** Examples per moving category in the view. */
export const TRUST_EXAMPLES_PER_CATEGORY = 3;

export const trustCheckSchema = z.strictObject({
  status: z.enum(historyCheckStatuses),
  reason: z.enum(historyCheckReasons),
  noResultReason: z.enum(noResultReasons).nullable(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  /** Mails the check classified so far. */
  checked: count,
  capped: z.boolean(),
});
export type TrustCheck = z.infer<typeof trustCheckSchema>;

export const trustGlobalSchema = z.strictObject({
  decision: z.enum(["go", "no-go", "too-few", "none"]),
  provisional: z.boolean(),
  precision: z.number().nullable(),
  wilsonLower: z.number().nullable(),
  threshold: z.number().nullable(),
  cases: count,
  file: z.string().nullable(),
});

export const trustHistorySchema = z.strictObject({
  outcome: z.enum(historyOutcomes),
  acted: count,
  moved: count,
  upper: z.number().min(0).max(1).nullable(),
  total: count,
  wouldMove: count,
});

export const trustTripSchema = z.strictObject({
  tripped: z.boolean(),
  reason: z.enum(tripReasons).nullable(),
  at: z.iso.datetime().nullable(),
});

export const trustCategorySchema = z.strictObject({
  /** `auto` as triage reads it now: on, and its grant (when there is one) was made under the running key. */
  auto: z.boolean(),
  grantBy: z.enum(categoryGrantBy).nullable(),
  global: trustGlobalSchema,
  /** The newest `done` check; null: none, or its result has no entry for this category (only the moving categories have one). */
  history: trustHistorySchema.nullable(),
  trip: trustTripSchema,
  realLabels: z.strictObject({
    kept: count,
    precision: z.number().nullable(),
    decision: z.enum(gateDecisions),
  }),
  evidence: z.strictObject({
    eligible: z.boolean(),
    recommended: z.boolean(),
    blocks: z.array(z.enum(evidenceBlocks)),
  }),
});
export type TrustCategory = z.infer<typeof trustCategorySchema>;

export const trustExampleSchema = z.strictObject({
  emailId: z.uuid(),
  receivedAt: z.iso.datetime(),
  /** null after the retention cleared the texts of the mail. */
  fromName: z.string().nullable(),
  subject: z.string().nullable(),
});
export type TrustExample = z.infer<typeof trustExampleSchema>;

function perCategory<T extends z.ZodType>(
  categories: readonly string[],
  schema: T
): z.ZodObject<Record<string, T>, z.core.$strict> {
  return z.strictObject(Object.fromEntries(categories.map((category) => [category, schema])));
}

export const trustViewSchema = z.strictObject({
  mailboxId: z.uuid(),
  /** The organization flag `trust_ladder`. */
  flag: z.boolean(),
  /** The model setup that runs now. */
  key: evidenceKeySchema,
  mode: z.enum(mailboxModes),
  /** The newest check of any status; null: none yet. */
  check: trustCheckSchema.nullable(),
  categories: perCategory(barCategories, trustCategorySchema) as unknown as z.ZodType<
    Record<BarCategory, TrustCategory>
  >,
  /** Up to 3 acted-on mails per moving category that the category would move, newest first. */
  examples: perCategory(
    movingCategories,
    z.array(trustExampleSchema).max(TRUST_EXAMPLES_PER_CATEGORY)
  ) as unknown as z.ZodType<Record<MovingCategory, TrustExample[]>>,
});
export type TrustView = z.infer<typeof trustViewSchema>;

export const trustRecommendedAnswerSchema = z.strictObject({
  turnedOn: z.array(z.enum(barCategories)),
  mode: z.enum(mailboxModes),
  view: trustViewSchema,
});
export type TrustRecommendedAnswer = z.infer<typeof trustRecommendedAnswerSchema>;

export const trustHistoryCheckAnswerSchema = z.strictObject({ check: trustCheckSchema });
export type TrustHistoryCheckAnswer = z.infer<typeof trustHistoryCheckAnswerSchema>;
