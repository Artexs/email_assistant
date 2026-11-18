import {
  reviewLabelResultSchema,
  reviewSampleSchema,
  type PanelReviewLabelBody,
  type PanelReviewLabelResult,
  type PanelReviewSample,
} from "@ea/core/web";

import { api } from "./api";

// The panel review (F110 stage 15, flag `panel_review`).
export function reviewSamplePath(mailboxId: string): string {
  return `/api/review/sample?mailboxId=${encodeURIComponent(mailboxId)}`;
}

// The page of the review of one mailbox: the optional link of the report page leads here.
export function reviewPath(mailboxId: string): string {
  return `/review?mailbox=${encodeURIComponent(mailboxId)}`;
}

export function fetchReviewSample(mailboxId: string): Promise<PanelReviewSample> {
  return api(reviewSamplePath(mailboxId), reviewSampleSchema);
}

export function postReviewLabel(body: PanelReviewLabelBody): Promise<PanelReviewLabelResult> {
  return api("/api/review/label", reviewLabelResultSchema, { method: "POST", body });
}
