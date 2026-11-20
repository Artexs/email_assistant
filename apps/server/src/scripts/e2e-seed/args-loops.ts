import { greenMailAddress, type E2eProject } from "./args-core";

// One organization per project for the loops spec (the Delegate action, the loop settings and the new Telegram
// terms). The flags `open_loops`, `delegate_button`, `delegation_pages`, `sent_sync` and `approvals_page` are on. The mailbox is in assist mode with
// drafts on and tracks Sent. One active delegate (Anna Nowak). The owner is linked to Telegram with a consent of an old version.
export const E2E_LOOPS_OWNER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-loops-owner-mobile@x.test",
  desktop: "e2e-loops-owner-desktop@x.test",
};
export const E2E_LOOPS_MEMBER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-loops-member-mobile@x.test",
  desktop: "e2e-loops-member-desktop@x.test",
};
export const e2eLoopsOrgName = (project: E2eProject): string => `E2E Loops ${project}`;
export const e2eLoopsMailbox = (project: E2eProject): string => greenMailAddress(`e2e-loops-${project}@e2e.test`);
// A consent version older than the current text: the loops spec confirms the new terms.
export const E2E_LOOPS_OLD_CONSENT = "2026-11-14";
export const E2E_LOOPS_CHAT_IDS: Record<E2eProject, number> = { mobile: 9_100_001, desktop: 9_100_002 };
export const E2E_LOOPS_SUBJECTS = {
  reply: "E2E loops reply",
  unsure: "E2E loops unsure",
  newsletter: "E2E loops newsletter",
} as const;
