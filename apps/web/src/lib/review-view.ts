// The panel review page (F110 stage 15). Pure rules: which buttons an item has, what counts as answered, when the thank-you shows.
import {
  reviewLabelCategories,
  type PanelReviewItem,
  type PanelReviewSample,
  type ReviewLabelCategory,
} from "@ea/core/web";

import { reviewPath } from "./review-api";

// What the user answered for one item (this page load only).
export interface ReviewAnswer {
  saved: boolean;
  verdict: "right" | "wrong";
  // The category the user named, or the assistant's own category after `Right`.
  category: ReviewLabelCategory;
}

// `Right` confirms the category of the assistant. A mail it could not place (`unsure`) has no `Right`: the user names the category.
export function canConfirm(item: PanelReviewItem): boolean {
  return item.category !== "unsure";
}

// The categories of the select. `delegation` only when the organization has an active delegate (or the mail already is one).
export function pickCategories(sample: PanelReviewSample, item: PanelReviewItem): readonly ReviewLabelCategory[] {
  return reviewLabelCategories.filter(
    (category) => category !== "delegation" || sample.delegation || item.category === "delegation"
  );
}

// The thank-you shows after the last item is answered, or when the user taps "Done". It is never a required step.
export function reviewFinished(total: number, answered: number, doneTapped: boolean): boolean {
  return doneTapped || (total > 0 && answered >= total);
}

// The flag of the review: the page and the link of the report page read it from `me.features`.
export const PANEL_REVIEW_FLAG = "panel_review";

// The link of the report page to the review: only while the flag is on for the organization. `null`: no link.
export function reviewHrefFor(features: readonly string[], mailboxId: string): string | null {
  return features.includes(PANEL_REVIEW_FLAG) ? reviewPath(mailboxId) : null;
}
