import type { E2eProject } from "./args-core";
import type { OpenLoopsSeedIds } from "./args-open-loops";
import type { E2eReportKind } from "./args-trust";

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
  suggestionOrgs: Record<
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
  replyPanelOrgs: Record<
    E2eProject,
    {
      orgId: string;
      owner: { userId: string; email: string; password: string };
      member: { userId: string; email: string; password: string };
      mailbox: { id: string; address: string };
      // The waiting sends (the page `/approvals?id=<id>`) and the mails that have no draft (the activity rows).
      sendIds: Record<"gap" | "plain" | "plainTwo" | "all" | "viaReplyTo", string>;
      mailIds: Record<"gap" | "clean" | "flagged", string>;
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
export function seedFilePath(repoRoot: string): string {
  return `${repoRoot}/apps/web/e2e/.seed.json`;
}
