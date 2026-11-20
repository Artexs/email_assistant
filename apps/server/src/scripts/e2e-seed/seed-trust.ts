import { createOrganizationWithOwner, insertMembership, insertUser, upsertOrgFeature } from "../../modules/tenancy";
import {
  E2E_TRUST_MEMBER_EMAILS,
  E2E_TRUST_OWNER_EMAILS,
  E2E_REPORT_KINDS,
  e2eReportMailbox,
  e2eTrustMailbox,
  e2eTrustOrgName,
  type E2eReportKind,
  E2E_MEMBER_PASSWORD,
  E2E_PROJECTS,
  E2E_TIMEZONE,
  type E2eProject,
  type SeedFile,
} from "../e2e-seed-args";
import { seedReportRows, seedTrustRows } from "../lib/e2e-trust-rows";

import { seedAssistMailbox } from "./seed-assist-mailbox";
import type { SeedContext } from "./seed-context";

export async function seedTrust({ db, secretBox }: SeedContext) {
  // One organization per project for the autonomy card spec. The flag `trust_ladder` is on; one mailbox in assist mode
  // with a done history check and one trip (`e2e-trust-rows.ts`). The gate files come from the fixture folder of the e2e server.
  const trustIds = {} as Record<
    E2eProject,
    {
      orgId: string;
      ownerId: string;
      memberId: string;
      mailboxId: string;
      reportMailboxIds: Record<E2eReportKind, string>;
    }
  >;
  for (const project of E2E_PROJECTS) {
    const trustOwner = await createOrganizationWithOwner(db, {
      orgName: e2eTrustOrgName(project),
      timezone: E2E_TIMEZONE,
      email: E2E_TRUST_OWNER_EMAILS[project],
      displayName: `E2E Trust owner ${project}`,
    });
    const ctx = { orgId: trustOwner.orgId };
    const member = await insertUser(db, {
      email: E2E_TRUST_MEMBER_EMAILS[project],
      displayName: `E2E Trust member ${project}`,
    });
    await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
    await upsertOrgFeature(db, ctx, {
      flag: "trust_ladder",
      enabled: true,
      setBy: trustOwner.userId,
      setAt: new Date(),
    });
    const mailboxId = await seedAssistMailbox(db, secretBox, ctx, e2eTrustMailbox(project));
    await seedTrustRows(db, ctx, mailboxId, new Date());
    // The mailboxes of the report page spec (`e2e-trust-rows.ts`).
    const reportMailboxIds = {} as Record<E2eReportKind, string>;
    for (const kind of E2E_REPORT_KINDS) {
      const mode = kind === "done" ? "shadow" : "assist";
      reportMailboxIds[kind] = await seedAssistMailbox(db, secretBox, ctx, e2eReportMailbox(project, kind), mode);
    }
    await seedReportRows(db, ctx, reportMailboxIds, new Date());
    trustIds[project] = {
      orgId: trustOwner.orgId,
      ownerId: trustOwner.userId,
      memberId: member.id,
      mailboxId,
      reportMailboxIds,
    };
  }
  return { trustIds };
}

export async function finishTrust(
  { requestLink, setPassword }: SeedContext,
  { trustIds }: Awaited<ReturnType<typeof seedTrust>>
) {
  const trustOrgs = {} as SeedFile["trustOrgs"];
  for (const project of E2E_PROJECTS) {
    const ownerEmail = E2E_TRUST_OWNER_EMAILS[project];
    const memberEmail = E2E_TRUST_MEMBER_EMAILS[project];
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
    const ids = trustIds[project];
    trustOrgs[project] = {
      orgId: ids.orgId,
      owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
      member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
      mailbox: { id: ids.mailboxId, address: e2eTrustMailbox(project) },
      reportMailboxes: Object.fromEntries(
        E2E_REPORT_KINDS.map((kind) => [
          kind,
          { id: ids.reportMailboxIds[kind], address: e2eReportMailbox(project, kind) },
        ])
      ) as Record<E2eReportKind, { id: string; address: string }>,
    };
  }
  return { trustOrgs };
}
