import { greenMailAddress, type E2eProject } from "./args-core";

// One organization per project for the panel review spec. The flags `panel_review` and `trust_ladder` are on; one mailbox
// with a done history check (so the report page offers the link) and 12 real mails with a triage result and no label (`e2e-review-rows.ts`).
// The spec labels mail, so it needs its own organization. No delegate: the category select has no `delegation`.
export const E2E_REVIEW_OWNER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-review-owner-mobile@x.test",
  desktop: "e2e-review-owner-desktop@x.test",
};
export const E2E_REVIEW_MEMBER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-review-member-mobile@x.test",
  desktop: "e2e-review-member-desktop@x.test",
};
export const e2eReviewOrgName = (project: E2eProject): string => `E2E Review ${project}`;
export const e2eReviewMailbox = (project: E2eProject): string => greenMailAddress(`e2e-review-${project}@e2e.test`);
// The mail of the review organization: `count` mails, the text is made up. The sender address is not in the test sender list and the
// Message-ID is not a synthetic one, so the mail counts as real.
export const E2E_REVIEW_MAIL_COUNT = 12;
export const E2E_REVIEW_SUMMARY = "E2E review summary: a made-up line.";
export const e2eReviewSubject = (n: number): string => `E2E review subject ${String(n).padStart(2, "0")}`;
export const e2eReviewSender = (n: number): string => `E2E Review Sender ${String(n).padStart(2, "0")}`;
