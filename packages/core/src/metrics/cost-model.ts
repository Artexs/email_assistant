// Reference numbers of the cost per mailbox (M7), with source and date, like llmPrices in triage/cost.ts.
export const costModel = {
  hostingUsdPerMonth: 7.1, // Hetzner CX23 €5.99 per month, E3 notes §4 (checked 2026-11-10)
  mailboxesPerHost: 20, // assumption until the E8 load test (PD-059)
  backupUsdPerMailboxMonth: 0.05, // assumption: B2 and domain, shared; E3 notes §4 "< 0.1"
  targetUsdPerMailboxMonth: 5, // PD-059
  source: "docs/product/stage-2/epics/E03-discovery-notes.md §4",
  checked: "2026-11-13",
} as const;
