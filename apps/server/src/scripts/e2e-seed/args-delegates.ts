import type { E2eProject } from "./args-core";

// One organization per project for the delegates spec (it adds, edits and turns delegates off, so each project needs its
// own). The flag `delegation_pages` is on. It holds one delegate and a mailbox (its address is no delegate); the member is an assistant.
export const E2E_DELEGATES_OWNER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-delegates-owner-mobile@x.test",
  desktop: "e2e-delegates-owner-desktop@x.test",
};
export const E2E_DELEGATES_MEMBER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-delegates-member-mobile@x.test",
  desktop: "e2e-delegates-member-desktop@x.test",
};
export const e2eDelegatesOrgName = (project: E2eProject): string => `E2E Delegates ${project}`;
export const E2E_DELEGATES_ANNA = { name: "Anna Nowak", email: "anna@example.com", tags: ["finance"] } as const;
