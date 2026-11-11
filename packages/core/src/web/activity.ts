import { labelCategories } from "../digest/callback";
import { categories, feedbackSources, feedbackVerdicts } from "../triage/categories";

import { z } from "./zod";

export { categories, type Category, type FeedbackSource, type FeedbackVerdict } from "../triage/categories";

export const ACTIVITY_PAGE_SIZE = 50;
export const ACTIVITY_MAX_LIMIT = 100;
export const ACTIVITY_MAX_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export const activityRanges = ["24h", "7d", "30d", "90d"] as const;
export type ActivityRange = (typeof activityRanges)[number];
export const ACTIVITY_DEFAULT_RANGE: ActivityRange = "7d";
export const activityRangeMs: Record<ActivityRange, number> = {
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
  "90d": 90 * DAY_MS,
};

export const NEEDS_ACTION_CATEGORIES = [
  "urgent",
  "needs_reply",
  "unsure",
] as const satisfies readonly (typeof categories)[number][];

export const activityDelegationStatuses = ["drafted", "sent", "answered", "overdue", "done", "cancelled"] as const;
export type ActivityDelegationStatus = (typeof activityDelegationStatuses)[number];

const categoryListSchema = z
  .string()
  .max(200)
  .transform((text) => text.split(","))
  .pipe(
    z
      .array(z.enum(categories))
      .min(1)
      .max(categories.length)
      .refine((list) => new Set(list).size === list.length)
  );

export const activityQuerySchema = z.object({
  mailboxId: z.uuid().optional(),
  categories: categoryListSchema.optional(),
  since: z.iso.datetime({ offset: true }).optional(),
  before: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(ACTIVITY_MAX_LIMIT).optional(),
  notRated: z.enum(["true", "false"]).optional(),
});
export type ActivityWebQuery = z.infer<typeof activityQuerySchema>;

export const activityActionSchema = z.object({
  type: z.string(),
  status: z.string(),
  phrase: z.string(),
  appliedAt: z.iso.datetime().nullable(),
});

export const activityFeedbackSchema = z.object({
  verdict: z.enum(feedbackVerdicts),
  trueCategory: z.enum(categories).nullable(),
  source: z.enum(feedbackSources),
  at: z.iso.datetime(),
});

export const activityDelegationSchema = z.object({
  delegateName: z.string().nullable(),
  status: z.enum(activityDelegationStatuses),
  dueAt: z.iso.datetime().nullable(),
});

export const activityItemSchema = z.object({
  emailId: z.uuid(),
  mailboxId: z.uuid(),
  receivedAt: z.iso.datetime(),
  triagedAt: z.iso.datetime(),
  from: z.string().nullable(),
  subject: z.string().nullable(),
  category: z.enum(categories),
  confidence: z.number().min(0).max(1),
  modelCategory: z.enum(categories).nullable(),
  aiText: z.string().nullable(),
  phrase: z.string(),
  actions: z.array(activityActionSchema),
  undoable: z.boolean(),
  undoPending: z.boolean(),
  feedback: activityFeedbackSchema.nullable(),
  delegation: activityDelegationSchema.nullable(),
});
export type ActivityItem = z.infer<typeof activityItemSchema>;

export const activityPageSchema = z.object({
  items: z.array(activityItemSchema),
  nextBefore: z.string().nullable(),
});
export type ActivityWebPage = z.infer<typeof activityPageSchema>;

export const feedbackBodySchema = z.object({ emailId: z.uuid(), trueCategory: z.enum(labelCategories) });
export type FeedbackBody = z.infer<typeof feedbackBodySchema>;

export const feedbackResultSchema = z.object({
  saved: z.boolean(),
  verdict: z.enum(feedbackVerdicts),
  aiCategory: z.enum(categories),
});
export type FeedbackResult = z.infer<typeof feedbackResultSchema>;

export const undoBodySchema = z.object({ emailId: z.uuid() });
export type UndoBody = z.infer<typeof undoBodySchema>;

export const undoResultSchema = z.object({
  kind: z.enum(["started", "already", "nothing", "too_old", "held"]),
  created: z.number().int().min(0).optional(),
});
export type UndoWebResult = z.infer<typeof undoResultSchema>;
