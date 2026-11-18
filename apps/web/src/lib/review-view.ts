// The panel review page (F110 stage 15). Pure rules: which buttons an item has, what counts as answered, when the thank-you shows.
import {
  reviewLabelCategories,
  type PanelReviewItem,
  type PanelReviewSample,
  type ReviewLabelCategory,
} from "@ea/core/web";

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
