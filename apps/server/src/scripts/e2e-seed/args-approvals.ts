import { greenMailAddress, type E2eProject } from "./args-core";

// One organization per project for the approvals spec (it approves and rejects, so each project needs its own). The
// flags `approvals_page`, `stats_page` and `mistake_capture` are on. The organization holds a waiting send (draft applied) to the
// first delegate and a held send to the second one: the e2e server has SEND_SCOPE=self with the first address only, so the first
// send goes out through the GreenMail of the dev stack after the approval and the second stays held by the scope.
export const E2E_APPROVALS_OWNER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-approvals-owner-mobile@x.test",
  desktop: "e2e-approvals-owner-desktop@x.test",
};
export const E2E_APPROVALS_MEMBER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-approvals-member-mobile@x.test",
  desktop: "e2e-approvals-member-desktop@x.test",
};
export const e2eApprovalsOrgName = (project: E2eProject): string => `E2E Approvals ${project}`;
export const e2eApprovalsMailbox = (project: E2eProject): string =>
  greenMailAddress(`e2e-approvals-${project}@e2e.test`);
// The only address that SEND_SCOPE=self lets through in the e2e server (the first delegate of the approvals organizations).
export const E2E_SEND_TEST_ADDRESS = "anna@example.com";
export const E2E_APPROVALS = {
  waiting: {
    delegateName: "Anna Nowak",
    delegateEmail: E2E_SEND_TEST_ADDRESS,
    subject: "E2E budget plan",
    from: "boss@example.net",
    body: "E2E original request: please review the budget plan.",
    task: "Review the budget plan",
  },
  held: {
    delegateName: "Piotr Lis",
    delegateEmail: "piotr@example.com",
    subject: "E2E vendor contract",
    from: "vendor@example.net",
    body: "E2E original request: please check the vendor contract.",
    task: "Check the vendor contract",
  },
  // A second waiting send to the first delegate, for the edit that is approved.
  edit: {
    delegateName: "Anna Nowak",
    delegateEmail: E2E_SEND_TEST_ADDRESS,
    subject: "E2E weekly report",
    from: "boss@example.net",
    body: "E2E original request: please send the weekly report.",
    task: "Send the weekly report",
  },
  // A third waiting send for the closed-send test: another browser rejects it while the dialog is open.
  closed: {
    delegateName: "Anna Nowak",
    delegateEmail: E2E_SEND_TEST_ADDRESS,
    subject: "E2E closed case",
    from: "boss@example.net",
    body: "E2E original request: please answer the closed case.",
    task: "Answer the closed case",
  },
  // A fourth waiting send for the poll test: another browser replaces its version while a dialog is open.
  race: {
    delegateName: "Anna Nowak",
    delegateEmail: E2E_SEND_TEST_ADDRESS,
    subject: "E2E race case",
    from: "boss@example.net",
    body: "E2E original request: please answer the race case.",
    task: "Answer the race case",
  },
  // A waiting reminder (no Edit button).
  reminder: {
    delegateName: "Anna Nowak",
    delegateEmail: E2E_SEND_TEST_ADDRESS,
    subject: "E2E open task",
    from: "boss@example.net",
    body: "E2E original request: please finish the open task.",
    task: "Finish the open task",
  },
} as const;
// The number of sends in the list of an approvals organization at the start: waiting, held, edit, closed, race and reminder.
export const E2E_APPROVALS_COUNT = 6;
// How many of them wait for an approval (the nav badge): all but the held one.
export const E2E_APPROVALS_WAITING = 5;
