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

// F106 stage 11: one organization per project that only the delete spec uses (it deletes the organization). The owner
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
// F102 stage 07: an organization with the flag `stats_page` on, for the Stats page. The main organization stays without the flag
// (auth.spec counts its 4 phone tabs). The page reads only; no spec changes this organization.
export const E2E_STATS_ORG_NAME = "E2E Stats";
export const E2E_STATS_OWNER_EMAIL = "e2e-stats-owner@x.test";

// F102 stage 12: one organization per project for the approvals spec (it approves and rejects, so each project needs its own). The
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
  // F102 stage 13: a second waiting send to the first delegate, for the edit that is approved (T3 of the approvals spec).
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
  // A waiting reminder (no Edit button, Q2).
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
