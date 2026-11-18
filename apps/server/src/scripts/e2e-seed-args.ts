import { DAY_MS } from "@ea/core";
import { Client } from "pg";

export const E2E_ORG_NAME = "E2E";
export const E2E_OWNER_EMAIL = "e2e-owner@x.test";
// A test value, not a secret.
export const E2E_OWNER_PASSWORD = "e2e-correct-horse-battery";
export const E2E_PROJECTS = ["mobile", "desktop"] as const;

export type E2eProject = (typeof E2E_PROJECTS)[number];

export const E2E_ASSISTANT_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-assistant-mobile@x.test",
  desktop: "e2e-assistant-desktop@x.test",
};

export const E2E_MEMBER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-member-mobile@x.test",
  desktop: "e2e-member-desktop@x.test",
};

// A test value, not a secret.
export const E2E_MEMBER_PASSWORD = "e2e-member-passphrase-one";

export const E2E_TERMS_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-terms-mobile@x.test",
  desktop: "e2e-terms-desktop@x.test",
};
export const e2eTermsOrgName = (project: E2eProject): string => `E2E Terms ${project}`;

// One owner per project whose second factor the two-factor spec turns on and off.
export const E2E_TWO_FACTOR_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-two-factor-mobile@x.test",
  desktop: "e2e-two-factor-desktop@x.test",
};
export const e2eTwoFactorOrgName = (project: E2eProject): string => `E2E Two-factor ${project}`;

// One organization per project that only the delete spec uses (it deletes the organization). The owner
// and an assistant share the member password. The mailbox address names the width, as the spec asserts it on the login page.
export const E2E_DELETE_OWNER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-delete-owner-mobile@x.test",
  desktop: "e2e-delete-owner-desktop@x.test",
};
export const E2E_DELETE_ASSISTANT_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-delete-assistant-mobile@x.test",
  desktop: "e2e-delete-assistant-desktop@x.test",
};
export const e2eDeleteOrgName = (project: E2eProject): string =>
  project === "mobile" ? "E2E Delete Phone" : "E2E Delete Desktop";
export const e2eDeleteMailbox = (project: E2eProject): string =>
  project === "mobile" ? "del-phone@x.test" : "del-desktop@x.test";

export const E2E_OTHER_ORG_NAME = "E2E Other";
export const E2E_OTHER_OWNER_EMAIL = "e2e-other-owner@x.test";

export const E2E_TRIAL_ORG_NAME = "E2E Trial";
export const E2E_TRIAL_OWNER_EMAIL = "e2e-trial-owner@x.test";
export const E2E_PAUSED_ORG_NAME = "E2E Paused";
export const E2E_PAUSED_OWNER_EMAIL = "e2e-paused-owner@x.test";
// An organization with the flag `stats_page` on, for the Stats page. The main organization stays without the flag
// (auth.spec counts its 4 phone tabs). The page reads only; no spec changes this organization.
export const E2E_STATS_ORG_NAME = "E2E Stats";
export const E2E_STATS_OWNER_EMAIL = "e2e-stats-owner@x.test";

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
export const e2eApprovalsMailbox = (project: E2eProject): string => `e2e-approvals-${project}@e2e.test`;
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
  // A second waiting send to the first delegate, for the edit that is approved (T3 of the approvals spec).
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
export const e2eDelegationsMailbox = (project: E2eProject): string => `e2e-delegations-${project}@e2e.test`;
export const e2eDelegatesMailbox = (project: E2eProject): string => `e2e-delegates-${project}@e2e.test`;
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

// One organization per project for the open loops spec (it drafts, moves, closes and untracks loops, so each project
// needs its own). The flags `open_loops`, `delegation_pages` and `approvals_page` are on; the mailbox is in assist mode with drafts on.
// One loop for each kind and state of the page, two delegations for the Delegated tab, and follow-up pairs for the waiting and S11 rows.
export const E2E_OPEN_LOOPS_OWNER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-open-loops-owner-mobile@x.test",
  desktop: "e2e-open-loops-owner-desktop@x.test",
};
export const E2E_OPEN_LOOPS_MEMBER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-open-loops-member-mobile@x.test",
  desktop: "e2e-open-loops-member-desktop@x.test",
};
export const e2eOpenLoopsOrgName = (project: E2eProject): string => `E2E Open Loops ${project}`;
export const e2eOpenLoopsMailbox = (project: E2eProject): string => `e2e-open-loops-${project}@e2e.test`;
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
  // S11 (TG-4): a follow-up whose loop closes while Edit is open. The first loop closes in the database, the second is dropped.
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
// The two F102 delegations of the Delegated tab (keys of `E2E_DELEGATIONS`).
export const E2E_OPEN_LOOPS_DELEGATIONS = ["sent", "answered"] as const;
export interface OpenLoopsSeedIds {
  loopIds: Record<keyof typeof E2E_OPEN_LOOPS, string>;
  // The follow-up sends of the rows that have a `pair`.
  pendingSendId: string;
  s11ClosedSendId: string;
  s11DroppedSendId: string;
}

// One organization per project for the urgency editor spec (it saves and clears profiles, so each project needs its
// own). The flag `urgency_editor` is on. Two mailboxes: `seeded` holds a profile with one topic, a deadline of yesterday and one in
// ten days; `empty` holds none. The two names are the labels of the deadlines the spec looks for.
export const E2E_URGENCY_OWNER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-urgency-owner-mobile@x.test",
  desktop: "e2e-urgency-owner-desktop@x.test",
};
export const E2E_URGENCY_MEMBER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-urgency-member-mobile@x.test",
  desktop: "e2e-urgency-member-desktop@x.test",
};
export const e2eUrgencyOrgName = (project: E2eProject): string => `E2E Urgency ${project}`;
export const e2eUrgencyMailbox = (project: E2eProject, which: "seeded" | "empty"): string =>
  `e2e-urgency-${which}-${project}@e2e.test`;
export const E2E_URGENCY_SEEDED = {
  topic: { label: "Annual audit", keywords: ["audit", "auditor"] },
  endedLabel: "Tax filing",
  futureLabel: "Board pack",
} as const;
// The e2e server pins the classifier setup, so the gate fixture (`apps/web/e2e/gate-fixture/`) matches the running key
// whatever a developer's `.env` says. `e2e-gate-fixture.test.ts` checks the fixture against this pin and the production prompt choice.
export const E2E_LLM_PIN = {
  LLM_PROVIDER: "openai",
  OPENAI_MODEL_CLASSIFIER: "gpt-6-luna",
  OPENAI_REASONING_EFFORT: "none",
  OPENAI_BASE_URL: "",
  OPENAI_ENDPOINT_KIND: "",
} as const;
export const E2E_GATE_FIXTURE_DIR = "apps/web/e2e/gate-fixture";

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
export const e2eTrustMailbox = (project: E2eProject): string => `e2e-trust-${project}@e2e.test`;
// Three more mailboxes of the same organization for the report page spec, one per state of the page. They are created
// after the card mailbox, so the Settings page (first mailbox) is unchanged. `done`: a done check, `notification` recommended, `spam`
// failed, `info` paused, mode shadow. `running`: a check that classifies. `noResult`: a `no_result` check (`no_history`), no trip.
export const E2E_REPORT_KINDS = ["done", "running", "noResult"] as const;
export type E2eReportKind = (typeof E2E_REPORT_KINDS)[number];
export const e2eReportMailbox = (project: E2eProject, kind: E2eReportKind): string =>
  `e2e-report-${kind.toLowerCase()}-${project}@e2e.test`;
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
export const e2eReviewMailbox = (project: E2eProject): string => `e2e-review-${project}@e2e.test`;
// The mail of the review organization: `count` mails, the text is made up. The sender address is not in the test sender list and the
// Message-ID is not a synthetic one, so the mail counts as real.
export const E2E_REVIEW_MAIL_COUNT = 12;
export const E2E_REVIEW_SUMMARY = "E2E review summary: a made-up line.";
export const e2eReviewSubject = (n: number): string => `E2E review subject ${String(n).padStart(2, "0")}`;
export const e2eReviewSender = (n: number): string => `E2E Review Sender ${String(n).padStart(2, "0")}`;
export const E2E_TIMEZONE = "Europe/Warsaw";

// The seeded profile at the seed time `now`: the ended deadline is due the day before the local date of the organization, the future one in ten days.
export function e2eUrgencyProfile(now: Date): {
  topics: { label: string; keywords: string[] }[];
  deadlines: { label: string; due: string }[];
} {
  const localDate = (at: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone: E2E_TIMEZONE }).format(at);
  return {
    topics: [{ label: E2E_URGENCY_SEEDED.topic.label, keywords: [...E2E_URGENCY_SEEDED.topic.keywords] }],
    deadlines: [
      { label: E2E_URGENCY_SEEDED.endedLabel, due: localDate(new Date(now.getTime() - DAY_MS)) },
      { label: E2E_URGENCY_SEEDED.futureLabel, due: localDate(new Date(now.getTime() + 10 * DAY_MS)) },
    ],
  };
}

// One organization per project for the newsletters spec. The flag `bulk_unsubscribe` is on; one mailbox with five
// newsletter senders (see `e2e-newsletter-rows.ts`). The addresses are the identity of the rows. The server of the e2e run trusts the
// authserv-id `E2E_AUTHSERV_ID` (`MAIL_TRUSTED_AUTHSERV_IDS`), so a `dkim=pass` of that id gives one-click.
export const E2E_AUTHSERV_ID = "mx.e2e.test";
export const E2E_NEWSLETTERS_OWNER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-newsletters-owner-mobile@x.test",
  desktop: "e2e-newsletters-owner-desktop@x.test",
};
export const E2E_NEWSLETTERS_MEMBER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-newsletters-member-mobile@x.test",
  desktop: "e2e-newsletters-member-desktop@x.test",
};
export const e2eNewslettersOrgName = (project: E2eProject): string => `E2E Newsletters ${project}`;
export const e2eNewslettersMailbox = (project: E2eProject): string => `e2e-newsletters-${project}@e2e.test`;
// `name` is the display name of the newest mail: text of the sender, shown small. The `markup` sender has hostile text in it.
export const E2E_NEWSLETTER_SENDERS = {
  oneClick: { address: "one-click@news.example", name: "One Click Weekly", count: 3 },
  link: { address: "link@news.example", name: "Link Letter", count: 2 },
  none: { address: "plain@news.example", name: "Plain Notes", count: 1 },
  failed: { address: "failed@news.example", name: "Failed Daily", count: 1 },
  markup: { address: "markup@news.example", name: "<img src=x onerror=alert(1)>", count: 1 },
} as const;
export const E2E_NEWSLETTER_LINK = "https://unsub.news.example/u?id=42";

export const E2E_ACTIVITY_MEMBER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-activity-mobile@x.test",
  desktop: "e2e-activity-desktop@x.test",
};

// The mails of the activity rows (S5d B12). The Playwright runner imports these; this file imports only `pg`.
export const ACTIVITY_SUBJECTS = {
  moved: "E2E moved notification",
  reply: "E2E reply needed",
  unsure: "E2E unsure mail",
  delegated: "E2E delegated task",
} as const;
export const activityFillerSubject = (n: number): string => `E2E filler ${n}`;
export const ACTIVITY_FILLERS = 52;

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
export const e2eLoopsMailbox = (project: E2eProject): string => `e2e-loops-${project}@e2e.test`;
// A consent version older than the current text: the loops spec confirms the new terms.
export const E2E_LOOPS_OLD_CONSENT = "2026-11-14";
export const E2E_LOOPS_CHAT_IDS: Record<E2eProject, number> = { mobile: 9_100_001, desktop: 9_100_002 };
export const E2E_LOOPS_SUBJECTS = {
  reply: "E2E loops reply",
  unsure: "E2E loops unsure",
  newsletter: "E2E loops newsletter",
} as const;

// One organization per project for the style card spec (it saves a name, a signature and a writing style, and turns the
// reply drafts switch on, so each project needs its own). The flag `reply_drafts` is on. Two mailboxes in assist mode: `box` signs in
// with a password, `oauth` has a provider set (the switch is disabled for it).
export const E2E_REPLY_STYLE_OWNER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-reply-style-owner-mobile@x.test",
  desktop: "e2e-reply-style-owner-desktop@x.test",
};
export const E2E_REPLY_STYLE_MEMBER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-reply-style-member-mobile@x.test",
  desktop: "e2e-reply-style-member-desktop@x.test",
};
export const e2eReplyStyleOrgName = (project: E2eProject): string => `E2E Reply Style ${project}`;
export const e2eReplyStyleMailbox = (project: E2eProject, which: "box" | "oauth"): string =>
  `e2e-reply-style-${which}-${project}@e2e.test`;

export interface SeedFile {
  orgId: string;
  owner: { userId: string; email: string; password: string };
  assistants: Record<E2eProject, { userId: string; email: string; setupUrl: string }>;
  members: Record<E2eProject, { userId: string; email: string; password: string }>;
  otherOrg: { orgId: string; emailId: string };
  activityMembers: Record<E2eProject, { userId: string; email: string; password: string }>;
  termsOwners: Record<E2eProject, { userId: string; email: string; password: string }>;
  twoFactorOwners: Record<E2eProject, { userId: string; orgId: string; email: string; password: string }>;
  deleteOrgs: Record<
    E2eProject,
    {
      orgId: string;
      name: string;
      mailboxAddress: string;
      owner: { userId: string; email: string; password: string };
      assistant: { userId: string; email: string; password: string };
    }
  >;
  trialOwner: { userId: string; email: string; password: string; orgId: string; trialEndsAt: string };
  pausedOwner: { userId: string; email: string; password: string; orgId: string; mailboxId: string };
  statsOwner: { userId: string; email: string; password: string; orgId: string };
  delegatesOrgs: Record<
    E2eProject,
    {
      orgId: string;
      owner: { userId: string; email: string; password: string };
      member: { userId: string; email: string; password: string };
      // The address of a mailbox of the organization: adding it as a delegate gives 400 `mailbox_address`.
      mailboxAddress: string;
    }
  >;
  delegationsOrgs: Record<
    E2eProject,
    {
      orgId: string;
      owner: { userId: string; email: string; password: string };
      member: { userId: string; email: string; password: string };
      draftedSendId: string;
    }
  >;
  loopsOrgs: Record<
    E2eProject,
    {
      orgId: string;
      owner: { userId: string; email: string; password: string };
      member: { userId: string; email: string; password: string };
      mailboxId: string;
    }
  >;
  openLoopsOrgs: Record<
    E2eProject,
    {
      orgId: string;
      owner: { userId: string; email: string; password: string };
      member: { userId: string; email: string; password: string };
    } & OpenLoopsSeedIds
  >;
  urgencyOrgs: Record<
    E2eProject,
    {
      orgId: string;
      owner: { userId: string; email: string; password: string };
      member: { userId: string; email: string; password: string };
      seeded: { id: string; address: string };
      empty: { id: string; address: string };
    }
  >;
  trustOrgs: Record<
    E2eProject,
    {
      orgId: string;
      owner: { userId: string; email: string; password: string };
      member: { userId: string; email: string; password: string };
      mailbox: { id: string; address: string };
      reportMailboxes: Record<E2eReportKind, { id: string; address: string }>;
    }
  >;
  newsletterOrgs: Record<
    E2eProject,
    {
      orgId: string;
      owner: { userId: string; email: string; password: string };
      member: { userId: string; email: string; password: string };
      mailbox: { id: string; address: string };
    }
  >;
  reviewOrgs: Record<
    E2eProject,
    {
      orgId: string;
      owner: { userId: string; email: string; password: string };
      member: { userId: string; email: string; password: string };
      mailbox: { id: string; address: string };
    }
  >;
  replyStyleOrgs: Record<
    E2eProject,
    {
      orgId: string;
      owner: { userId: string; email: string; password: string };
      member: { userId: string; email: string; password: string };
      box: { id: string; address: string };
      oauth: { id: string; address: string };
    }
  >;
  approvalsOrgs: Record<
    E2eProject,
    {
      orgId: string;
      owner: { userId: string; email: string; password: string };
      member: { userId: string; email: string; password: string };
      waitingSendId: string;
      heldSendId: string;
      editSendId: string;
      closedSendId: string;
      raceSendId: string;
      reminderSendId: string;
    }
  >;
}

// Reads the name the way `pg` does, so the guard and the connection agree. No connection is opened.
export function databaseNameOf(url: string): string | null {
  try {
    const { protocol } = new URL(url);
    if (protocol !== "postgres:" && protocol !== "postgresql:") return null;
    return new Client({ connectionString: url }).database ?? null;
  } catch {
    return null;
  }
}

export function isE2eDatabaseName(name: string | null): boolean {
  return name !== null && /^[A-Za-z0-9_]+_e2e$/.test(name);
}

export function seedTargetOk(
  appUrl: string,
  migratorUrl: string
): { ok: true; database: string } | { ok: false; reason: string } {
  const appName = databaseNameOf(appUrl);
  const migratorName = databaseNameOf(migratorUrl);
  if (!isE2eDatabaseName(appName)) {
    return { ok: false, reason: `DATABASE_URL is not an e2e database (${appName ?? "unparsable"})` };
  }
  if (!isE2eDatabaseName(migratorName)) {
    return { ok: false, reason: `MIGRATOR_DATABASE_URL is not an e2e database (${migratorName ?? "unparsable"})` };
  }
  if (appName !== migratorName) {
    return { ok: false, reason: `the two URLs name different databases (${appName}, ${migratorName})` };
  }
  return { ok: true, database: appName as string };
}

export function seedFilePath(repoRoot: string): string {
  return `${repoRoot}/apps/web/e2e/.seed.json`;
}
