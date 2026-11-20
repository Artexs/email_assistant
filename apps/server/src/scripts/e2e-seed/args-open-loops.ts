import { greenMailAddress, type E2eProject } from "./args-core";

// One organization per project for the open loops spec (it drafts, moves, closes and untracks loops, so each project
// needs its own). The flags `open_loops`, `delegation_pages` and `approvals_page` are on; the mailbox is in assist mode with drafts on.
// One loop for each kind and state of the page, two delegations for the Delegated tab, and follow-up pairs for the waiting rows and the rows of the closing-loop test.
export const E2E_OPEN_LOOPS_OWNER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-open-loops-owner-mobile@x.test",
  desktop: "e2e-open-loops-owner-desktop@x.test",
};
export const E2E_OPEN_LOOPS_MEMBER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-open-loops-member-mobile@x.test",
  desktop: "e2e-open-loops-member-desktop@x.test",
};
export const e2eOpenLoopsOrgName = (project: E2eProject): string => `E2E Open Loops ${project}`;
export const e2eOpenLoopsMailbox = (project: E2eProject): string =>
  greenMailAddress(`e2e-open-loops-${project}@e2e.test`);
export const E2E_OPEN_LOOPS_DELEGATE = { name: "Dana Delegate", email: "dana@example.com" } as const;
// `dueInDays` is counted from the seed time; `"today"` is one hour before the end of the local day of the organization (inside "Due
// today" at any hour of the run). Open waiting loops are past due on purpose: the chaser plans a follow-up for a past-due `delegated`
// loop, so those are due later; a past-due `waiting` loop gets none while `auto_follow_up` is off. `pair` adds a follow-up `create_draft`
// (applied) and `send` (`awaiting_approval`) to the loop.
export interface E2eLoopPlan {
  kind: "waiting" | "promised" | "delegated";
  counterpart: string;
  text: string;
  subject: string;
  dueInDays: number | "today";
  closed?: "replied" | "replied_subject" | "expired" | "done";
  followUpsSent?: number;
  laterCount?: number;
  autoReply?: true;
  pair?: true;
  // The loop got its due date from the usual reply time of the counterpart (`due_source` `contact`).
  usualReplyDays?: number;
}
export const E2E_OPEN_LOOPS = {
  // Waiting: Draft follow-up and Later change them.
  waitDraft: {
    kind: "waiting",
    counterpart: "nora@client.test",
    text: "Send the signed offer",
    subject: "E2E offer",
    dueInDays: -1,
  },
  waitLater: {
    kind: "waiting",
    counterpart: "leon@client.test",
    text: "Confirm the delivery date",
    subject: "E2E delivery",
    dueInDays: -1,
  },
  // Waiting rows that no spec changes.
  waitView: {
    kind: "waiting",
    counterpart: "mia@client.test",
    text: "Review the contract draft",
    subject: "E2E contract",
    dueInDays: -2,
  },
  waitFuture: {
    kind: "waiting",
    counterpart: "ola@client.test",
    text: "Answer the schedule question",
    subject: "E2E schedule",
    dueInDays: 4,
  },
  waitLimit: {
    kind: "waiting",
    counterpart: "rafal@client.test",
    text: "Decide on the two follow-ups",
    subject: "E2E limit",
    dueInDays: -3,
    followUpsSent: 2,
  },
  // A due date from the usual reply time of the contact: the row shows "Usual reply".
  waitContact: {
    kind: "waiting",
    counterpart: "igor@client.test",
    text: "Confirm the contact reply time",
    subject: "E2E contact",
    dueInDays: 4,
    usualReplyDays: 2,
  },
  waitAuto: {
    kind: "waiting",
    counterpart: "kasia@client.test",
    text: "Confirm after the auto answer",
    subject: "E2E auto",
    dueInDays: -1,
    autoReply: true,
  },
  waitPending: {
    kind: "waiting",
    counterpart: "ewa@client.test",
    text: "Wait for the approved follow-up",
    subject: "E2E pending",
    dueInDays: -4,
    pair: true,
  },
  // A follow-up whose loop closes while Edit is open. The first loop closes in the database, the second is dropped.
  s11Closed: {
    kind: "waiting",
    counterpart: "dan@client.test",
    text: "S11 loop closed in the database",
    subject: "E2E S11 closed",
    dueInDays: -1,
    pair: true,
  },
  s11Dropped: {
    kind: "waiting",
    counterpart: "ann@client.test",
    text: "S11 loop dropped by the owner",
    subject: "E2E S11 dropped",
    dueInDays: -1,
    pair: true,
  },
  // The Drop test closes it after the confirm question.
  waitDrop: {
    kind: "waiting",
    counterpart: "zoe@client.test",
    text: "Drop this waiting loop",
    subject: "E2E drop",
    dueInDays: -2,
  },
  waitClosed: {
    kind: "waiting",
    counterpart: "bob@client.test",
    text: "Answered offer question",
    subject: "E2E answered",
    dueInDays: -5,
    closed: "replied",
  },
  waitMatched: {
    kind: "waiting",
    counterpart: "carol@client.test",
    text: "Answer in another thread",
    subject: "E2E matched",
    dueInDays: -5,
    closed: "replied_subject",
  },
  // Promised: Done moves one of them.
  promDone: {
    kind: "promised",
    counterpart: "pat@client.test",
    text: "Send the revised budget",
    subject: "E2E budget",
    dueInDays: 2,
  },
  promView: {
    kind: "promised",
    counterpart: "sam@client.test",
    text: "Share the agenda",
    subject: "E2E agenda",
    dueInDays: 3,
  },
  promToday: {
    kind: "promised",
    counterpart: "kim@client.test",
    text: "Call back before the end of the day",
    subject: "E2E call",
    dueInDays: "today",
  },
  promClosed: {
    kind: "promised",
    counterpart: "lee@client.test",
    text: "Old promise that expired",
    subject: "E2E old",
    dueInDays: -9,
    closed: "expired",
  },
  // Delegated: Untrack with confirm closes one of them.
  delUntrack: {
    kind: "delegated",
    counterpart: E2E_OPEN_LOOPS_DELEGATE.email,
    text: "Prepare the quarterly numbers",
    subject: "E2E quarterly",
    dueInDays: 3,
  },
  delView: {
    kind: "delegated",
    counterpart: E2E_OPEN_LOOPS_DELEGATE.email,
    text: "Check the supplier list",
    subject: "E2E suppliers",
    dueInDays: 4,
  },
  delClosed: {
    kind: "delegated",
    counterpart: E2E_OPEN_LOOPS_DELEGATE.email,
    text: "Finished handover",
    subject: "E2E handover",
    dueInDays: -6,
    closed: "done",
  },
} as const satisfies Record<string, E2eLoopPlan>;
// The two delegations of the Delegated tab (keys of `E2E_DELEGATIONS`).
export const E2E_OPEN_LOOPS_DELEGATIONS = ["sent", "answered"] as const;
export interface OpenLoopsSeedIds {
  loopIds: Record<keyof typeof E2E_OPEN_LOOPS, string>;
  // The follow-up sends of the rows that have a `pair`.
  pendingSendId: string;
  s11ClosedSendId: string;
  s11DroppedSendId: string;
}
