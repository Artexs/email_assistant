import type { E2eProject } from "./args-core";

export const E2E_ACTIVITY_MEMBER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-activity-mobile@x.test",
  desktop: "e2e-activity-desktop@x.test",
};
// The mails of the activity rows. The Playwright runner imports these; this file imports only `pg`.
export const ACTIVITY_SUBJECTS = {
  moved: "E2E moved notification",
  reply: "E2E reply needed",
  unsure: "E2E unsure mail",
  delegated: "E2E delegated task",
} as const;
export const activityFillerSubject = (n: number): string => `E2E filler ${n}`;
export const ACTIVITY_FILLERS = 52;
