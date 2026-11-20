import { randomUUID } from "node:crypto";

import { insertDefaultSettings } from "../../modules/config";
import { insertCredentials, insertInboxFolder, insertMailbox } from "../../modules/mail/repo";
import { createOrganizationWithOwner, insertMembership, insertUser, upsertOrgFeature } from "../../modules/tenancy";
import {
  E2E_DELETE_ASSISTANT_EMAILS,
  E2E_DELETE_OWNER_EMAILS,
  e2eDeleteMailbox,
  e2eDeleteOrgName,
  E2E_MEMBER_PASSWORD,
  E2E_PROJECTS,
  type E2eProject,
  type SeedFile,
} from "../e2e-seed-args";
import { seedActivityRows } from "../lib/e2e-activity-rows";

import type { SeedContext } from "./seed-context";

export async function seedDelete({ db, secretBox }: SeedContext) {
  // One organization per project with the flag `org_delete` on, one mailbox with mail rows, an owner and
  // an assistant. Only the delete spec uses them: it deletes the organization. The mailbox points at a closed port, so no sync
  // reaches the GreenMail of the dev stack.
  const deleteIds = {} as Record<E2eProject, { orgId: string; ownerId: string; assistantId: string }>;
  for (const project of E2E_PROJECTS) {
    const deleteOwner = await createOrganizationWithOwner(db, {
      orgName: e2eDeleteOrgName(project),
      timezone: "Europe/Warsaw",
      email: E2E_DELETE_OWNER_EMAILS[project],
      displayName: `E2E Delete owner ${project}`,
    });
    const ctx = { orgId: deleteOwner.orgId };
    const assistant = await insertUser(db, {
      email: E2E_DELETE_ASSISTANT_EMAILS[project],
      displayName: `E2E Delete assistant ${project}`,
    });
    await insertMembership(db, ctx, { userId: assistant.id, role: "assistant" });
    await upsertOrgFeature(db, ctx, {
      flag: "org_delete",
      enabled: true,
      setBy: deleteOwner.userId,
      setAt: new Date(),
    });
    const mailboxId = randomUUID();
    await insertMailbox(db, ctx, {
      id: mailboxId,
      address: e2eDeleteMailbox(project),
      imapHost: "127.0.0.1",
      imapPort: 1,
      smtpHost: "127.0.0.1",
      smtpPort: 1,
      capabilities: {
        move: true,
        uidplus: true,
        idle: false,
        condstore: false,
        specialUse: false,
        keywords: false,
      },
      folderMap: { drafts: "Drafts" },
    });
    await insertInboxFolder(db, ctx, mailboxId);
    const mailboxSecret = secretBox.encrypt("e2e-delete-box-password", `mailbox:${mailboxId}`);
    await insertCredentials(db, ctx, {
      mailboxId,
      encryptedSecret: mailboxSecret.ciphertext,
      secretKind: "password",
      keyVersion: mailboxSecret.keyVersion,
    });
    await insertDefaultSettings(db, ctx, mailboxId);
    await seedActivityRows(db, ctx, mailboxId, new Date());
    deleteIds[project] = { orgId: deleteOwner.orgId, ownerId: deleteOwner.userId, assistantId: assistant.id };
  }
  return { deleteIds };
}

export async function finishDelete(
  { requestLink, setPassword }: SeedContext,
  { deleteIds }: Awaited<ReturnType<typeof seedDelete>>
) {
  const deleteOrgs = {} as SeedFile["deleteOrgs"];
  for (const project of E2E_PROJECTS) {
    const ownerEmail = E2E_DELETE_OWNER_EMAILS[project];
    const assistantEmail = E2E_DELETE_ASSISTANT_EMAILS[project];
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
    await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(assistantEmail)).pathname.split("/").pop() ?? "");
    deleteOrgs[project] = {
      orgId: deleteIds[project].orgId,
      name: e2eDeleteOrgName(project),
      mailboxAddress: e2eDeleteMailbox(project),
      owner: { userId: deleteIds[project].ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
      assistant: { userId: deleteIds[project].assistantId, email: assistantEmail, password: E2E_MEMBER_PASSWORD },
    };
  }
  return { deleteOrgs };
}
