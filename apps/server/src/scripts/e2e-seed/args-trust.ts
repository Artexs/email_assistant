import { greenMailAddress, type E2eProject } from "./args-core";

// One organization per project for the autonomy card spec. The flag `trust_ladder` is on and the server reads the gate
// fixture folder (`GATE_EVIDENCE_DIR`, see `apps/web/e2e/env.ts`). One mailbox with a done history check and one trip: see `e2e-trust-rows.ts`.
// The spec turns `spam` on with "Set anyway", so each project needs its own organization.
export const E2E_TRUST_OWNER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-trust-owner-mobile@x.test",
  desktop: "e2e-trust-owner-desktop@x.test",
};
export const E2E_TRUST_MEMBER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-trust-member-mobile@x.test",
  desktop: "e2e-trust-member-desktop@x.test",
};
export const e2eTrustOrgName = (project: E2eProject): string => `E2E Trust ${project}`;
export const e2eTrustMailbox = (project: E2eProject): string => greenMailAddress(`e2e-trust-${project}@e2e.test`);
// Three more mailboxes of the same organization for the report page spec, one per state of the page. They are created
// after the card mailbox, so the Settings page (first mailbox) is unchanged. `done`: a done check, `notification` recommended, `spam`
// failed, `info` paused, mode shadow. `running`: a check that classifies. `noResult`: a `no_result` check (`no_history`), no trip.
export const E2E_REPORT_KINDS = ["done", "running", "noResult"] as const;
export type E2eReportKind = (typeof E2E_REPORT_KINDS)[number];
export const e2eReportMailbox = (project: E2eProject, kind: E2eReportKind): string =>
  greenMailAddress(`e2e-report-${kind.toLowerCase()}-${project}@e2e.test`);
