// The publication hold of the docs site (spec/features/active/F121-e10b-public-pages-and-demo): English page ids that the owner has not read.
// While the list is not empty, a pushed release tag does not deploy the docs, and a manual run deploys only with the
// dispatch input `publish_held_pages` (the owner's own act, also the rollback path).
// The list is a constant in a commit: no env value and no CLI flag lifts the hold. The close-out stage checks that each id is a page.
export const OWNER_REVIEW_PENDING: readonly string[] = [
  "index",
  "security",
  "pricing",
  "reference/api",
  "reference/autonomy-evidence",
];

/** `owner_review_pending <ids>` while the list is not empty, else null. */
export function publishHoldReason(pending: readonly string[]): string | null {
  return pending.length === 0 ? null : `owner_review_pending ${pending.join(" ")}`;
}
