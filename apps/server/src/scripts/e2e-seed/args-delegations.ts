import { greenMailAddress, type E2eProject } from "./args-core";

// One organization per project for the delegations spec (it reminds, closes and cancels, so each project needs its own).
// The flags `delegation_pages`, `approvals_page` and `stats_page` are on, so the phone tab bar is full. The mailbox is in assist mode with
// drafts on, which "Remind now" needs. One delegation for each case of the page; the delegates are distinct people.
export const E2E_DELEGATIONS_OWNER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-delegations-owner-mobile@x.test",
  desktop: "e2e-delegations-owner-desktop@x.test",
};
export const E2E_DELEGATIONS_MEMBER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-delegations-member-mobile@x.test",
  desktop: "e2e-delegations-member-desktop@x.test",
};
export const e2eDelegationsOrgName = (project: E2eProject): string => `E2E Delegations ${project}`;
export const e2eDelegationsMailbox = (project: E2eProject): string =>
  greenMailAddress(`e2e-delegations-${project}@e2e.test`);
export const e2eDelegatesMailbox = (project: E2eProject): string =>
  greenMailAddress(`e2e-delegates-${project}@e2e.test`);
// The order is the order of the page (newest first). `dueInDays` is counted from the seed time.
export const E2E_DELEGATIONS = {
  // Open: the draft waits for an approval.
  drafted: {
    status: "drafted",
    delegateName: "Dorota Drafted",
    delegateEmail: "dorota@example.com",
    delegateActive: true,
    subject: "E2E drafted task",
    task: "Prepare the drafted report",
    dueInDays: 3,
    remindersSent: 0,
  },
  // Open: the cancel test removes it.
  sent: {
    status: "sent",
    delegateName: "Piotr Sent",
    delegateEmail: "piotr@example.com",
    delegateActive: true,
    subject: "E2E sent task",
    task: "Send the sent numbers",
    dueInDays: 2,
    remindersSent: 0,
  },
  // Overdue: the remind test plans a reminder for it.
  overdue: {
    status: "overdue",
    delegateName: "Ewa Overdue",
    delegateEmail: "ewa@example.com",
    delegateActive: true,
    subject: "E2E overdue task",
    task: "Finish the overdue offer",
    dueInDays: -1,
    remindersSent: 0,
  },
  // Overdue with both reminders sent: Remind now is off (limit).
  limit: {
    status: "overdue",
    delegateName: "Marek Limit",
    delegateEmail: "marek@example.com",
    delegateActive: true,
    subject: "E2E limit task",
    task: "Answer the limit question",
    dueInDays: -5,
    remindersSent: 2,
  },
  // Overdue with a delegate who is off: Remind now is off (inactive).
  inactive: {
    status: "overdue",
    delegateName: "Ola Inactive",
    delegateEmail: "ola@example.com",
    delegateActive: false,
    subject: "E2E inactive task",
    task: "Check the inactive plan",
    dueInDays: -2,
    remindersSent: 0,
  },
  // Answered: the owner marks it done.
  answered: {
    status: "answered",
    delegateName: "Olga Answered",
    delegateEmail: "olga@example.com",
    delegateActive: true,
    subject: "E2E answered task",
    task: "Review the answered contract",
    dueInDays: 1,
    remindersSent: 0,
  },
  // Answered: the member sees Done on it and does not press it.
  answeredMember: {
    status: "answered",
    delegateName: "Jan Answered",
    delegateEmail: "jan@example.com",
    delegateActive: true,
    subject: "E2E member task",
    task: "Read the member note",
    dueInDays: 1,
    remindersSent: 0,
  },
  // Closed: one done and one cancelled (its task text was removed by retention).
  done: {
    status: "done",
    delegateName: "Dawid Done",
    delegateEmail: "dawid@example.com",
    delegateActive: true,
    subject: "E2E done task",
    task: "Archive the done file",
    dueInDays: -9,
    remindersSent: 1,
  },
  cancelled: {
    status: "cancelled",
    delegateName: "Celina Cancelled",
    delegateEmail: "celina@example.com",
    delegateActive: true,
    subject: "E2E cancelled task",
    // The marker of retention: the page shows a dash for it.
    task: "[removed]",
    dueInDays: -9,
    remindersSent: 0,
  },
} as const;
export interface DelegationsSeedIds {
  // The send of the `drafted` delegation: the row links to `/approvals?id=`.
  draftedSendId: string;
}
