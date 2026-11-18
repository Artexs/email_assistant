// The panel review "Check 10 decisions" (flag `panel_review`): the web twin of the Telegram `/review` page.
// An item holds mail text (the sender's display name and the subject): the panel is behind login and shows it to the members of the
// organization that owns the mailbox. The text comes from the stored mail row, never from a model call, and it never goes to a log or to
// Telegram. The label only records what the user thinks: it unlocks nothing (ADR 0028).
import { reviewLabelCategories } from "../digest/callback";
import { categories, feedbackVerdicts } from "../triage/categories";

import { z } from "./zod";

export { reviewLabelCategories, type ReviewLabelCategory } from "../digest/callback";

/** Items in one sample: the size of the Telegram `/review` page. A test ties it to `REVIEW_PAGE_SIZE` of the server. */
export const PANEL_REVIEW_SIZE = 10;

export const reviewSampleQuerySchema = z.object({ mailboxId: z.uuid() });

export const panelReviewItemSchema = z.strictObject({
  emailId: z.uuid(),
  receivedAt: z.iso.datetime(),
  /** The display name of the sender (no address); null: none, or the retention cleared it. */
  fromName: z.string().nullable(),
  /** null after the retention cleared the subject. */
  subject: z.string().nullable(),
  category: z.enum(categories),
  confidence: z.number().min(0).max(1),
  /** The short AI summary that the assistant stored for the mail; null: none. */
  aiText: z.string().nullable(),
});
export type PanelReviewItem = z.infer<typeof panelReviewItemSchema>;

export const reviewSampleSchema = z.strictObject({
  items: z.array(panelReviewItemSchema).max(PANEL_REVIEW_SIZE),
  /** True when the organization has an active delegate: the page then offers `delegation` as a label. */
  delegation: z.boolean(),
});
export type PanelReviewSample = z.infer<typeof reviewSampleSchema>;

// `right`: the user agrees with the category the assistant gave. `category`: the user names the true category.
export const reviewLabelBodySchema = z.union([
  z.strictObject({ emailId: z.uuid(), verdict: z.literal("right") }),
  z.strictObject({ emailId: z.uuid(), category: z.enum(reviewLabelCategories) }),
]);
export type PanelReviewLabelBody = z.infer<typeof reviewLabelBodySchema>;

export const reviewLabelResultSchema = z.strictObject({
  /** False: the mail already had this answer as its latest label; nothing was written. */
  saved: z.boolean(),
  verdict: z.enum(feedbackVerdicts),
  aiCategory: z.enum(categories),
});
export type PanelReviewLabelResult = z.infer<typeof reviewLabelResultSchema>;
