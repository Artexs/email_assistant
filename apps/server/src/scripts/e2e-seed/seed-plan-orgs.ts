import { randomUUID } from "node:crypto";

import { DAY_MS } from "@ea/core";

import { insertDefaultSettings } from "../../modules/config";
import { insertCredentials, insertInboxFolder, insertMailbox } from "../../modules/mail/repo";
import { createOrganizationWithOwner, setOrgPlan, upsertOrgFeature } from "../../modules/tenancy";
import { createSecretBox } from "../../platform/crypto";
import {
  E2E_DELEGATES_ANNA,
  E2E_OTHER_ORG_NAME,
  E2E_OTHER_OWNER_EMAIL,
  E2E_PAUSED_ORG_NAME,
  E2E_PAUSED_OWNER_EMAIL,
  E2E_STATS_ORG_NAME,
  E2E_STATS_OWNER_EMAIL,
  E2E_TRIAL_ORG_NAME,
  E2E_TRIAL_OWNER_EMAIL,
} from "../e2e-seed-args";
import { seedOtherOrgMail } from "../lib/e2e-activity-rows";

import type { SeedContext } from "./seed-context";

const TRIAL_DAYS = 10;

export async function seedPlanOrgs({ db, config }: SeedContext) {
  // The organization of the isolation checks: one mail that the E2E organization must never see.
  const other = await createOrganizationWithOwner(db, {
    orgName: E2E_OTHER_ORG_NAME,
    timezone: "Europe/Warsaw",
    email: E2E_OTHER_OWNER_EMAIL,
    displayName: "E2E Other Owner",
  });
  const otherMail = await seedOtherOrgMail(db, { orgId: other.orgId }, new Date());

  // The trial organization: the panel shows the trial line to its owner.
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
  const trial = await createOrganizationWithOwner(db, {
    orgName: E2E_TRIAL_ORG_NAME,
    timezone: "Europe/Warsaw",
    email: E2E_TRIAL_OWNER_EMAIL,
    displayName: "E2E Trial Owner",
    plan: { kind: "trial", endsAt: trialEndsAt },
  });

  // The paused organization: one mailbox, so the read-only mirror has controls to check. No sync reaches it.
  // The org has no outbox rows, so the suspend needs no hook.
  const paused = await createOrganizationWithOwner(db, {
    orgName: E2E_PAUSED_ORG_NAME,
    timezone: "Europe/Warsaw",
    email: E2E_PAUSED_OWNER_EMAIL,
    displayName: "E2E Paused Owner",
  });
  const pausedCtx = { orgId: paused.orgId };
  const pausedMailboxId = randomUUID();
  await insertMailbox(db, pausedCtx, {
    id: pausedMailboxId,
    address: "e2e-paused-box@x.test",
    imapHost: "127.0.0.1",
    imapPort: 3143,
    smtpHost: "127.0.0.1",
    smtpPort: 3025,
    capabilities: { move: true, uidplus: true, idle: false, condstore: false, specialUse: false, keywords: false },
    folderMap: { drafts: "Drafts" },
  });
  await insertInboxFolder(db, pausedCtx, pausedMailboxId);
  const secret = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION).encrypt(
    "e2e-paused-box-password",
    `mailbox:${pausedMailboxId}`
  );
  await insertCredentials(db, pausedCtx, {
    mailboxId: pausedMailboxId,
    encryptedSecret: secret.ciphertext,
    secretKind: "password",
    keyVersion: secret.keyVersion,
  });
  await insertDefaultSettings(db, pausedCtx, pausedMailboxId);
  const suspended = await setOrgPlan(db, pausedCtx, { plan: "suspended", actor: "e2e-seed", now });
  if (suspended.kind !== "changed") throw new Error(`suspending the paused organization gave ${suspended.kind}`);
  // The delegates page of a suspended organization shows the list and takes no write. One delegate, the flag on.
  await upsertOrgFeature(db, pausedCtx, {
    flag: "delegation_pages",
    enabled: true,
    setBy: paused.userId,
    setAt: now,
  });
  await db
    .insertInto("delegates")
    .values({
      org_id: pausedCtx.orgId,
      name: E2E_DELEGATES_ANNA.name,
      email: E2E_DELEGATES_ANNA.email,
      competence_tags: [...E2E_DELEGATES_ANNA.tags],
    })
    .execute();

  // The stats organization: the flag `stats_page` is on, so the panel shows the Stats page. It has no mailbox.
  const stats = await createOrganizationWithOwner(db, {
    orgName: E2E_STATS_ORG_NAME,
    timezone: "Europe/Warsaw",
    email: E2E_STATS_OWNER_EMAIL,
    displayName: "E2E Stats Owner",
  });
  await upsertOrgFeature(
    db,
    { orgId: stats.orgId },
    { flag: "stats_page", enabled: true, setBy: stats.userId, setAt: now }
  );
  return { other, otherMail, trial, trialEndsAt, paused, pausedMailboxId, stats };
}
