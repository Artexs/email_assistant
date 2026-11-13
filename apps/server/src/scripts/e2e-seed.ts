import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { TERMS_VERSION } from "@ea/core";
import { Client } from "pg";

import { insertDefaultSettings } from "../modules/config";
import { configureMailHosts } from "../modules/mail";
import { insertCredentials, insertInboxFolder, insertMailbox } from "../modules/mail/repo";
import {
  createOrganizationWithOwner,
  insertMembership,
  insertUser,
  setOrgPlan,
  setUserTerms,
} from "../modules/tenancy";
import { createAuth } from "../platform/auth";
import { loadConfig, mailAllowLocal, webTrustedOrigins } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";
import { createLog } from "../platform/log";
import { auditWebEvent, termsAcceptedHandler } from "../web";

import { seedOtherOrgMail } from "./e2e-activity-rows";
import {
  E2E_ACTIVITY_MEMBER_EMAILS,
  E2E_ASSISTANT_EMAILS,
  E2E_MEMBER_EMAILS,
  E2E_MEMBER_PASSWORD,
  E2E_ORG_NAME,
  E2E_OTHER_ORG_NAME,
  E2E_OTHER_OWNER_EMAIL,
  E2E_OWNER_EMAIL,
  E2E_OWNER_PASSWORD,
  E2E_PAUSED_ORG_NAME,
  E2E_PAUSED_OWNER_EMAIL,
  E2E_PROJECTS,
  E2E_TERMS_EMAILS,
  e2eTermsOrgName,
  E2E_TRIAL_ORG_NAME,
  E2E_TRIAL_OWNER_EMAIL,
  type E2eProject,
  type SeedFile,
  seedFilePath,
  seedTargetOk,
} from "./e2e-seed-args";

const log = createLog("e2e-seed");

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_DAYS = 10;

const repoRoot = resolve(import.meta.dir, "../../../..");

async function wipe(migratorUrl: string): Promise<void> {
  const client = new Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    // The organization cascade removes mailboxes, mail, actions, memberships and audit rows.
    await client.query("DELETE FROM organizations WHERE name = ANY($1)", [
      [E2E_ORG_NAME, E2E_OTHER_ORG_NAME, E2E_TRIAL_ORG_NAME, E2E_PAUSED_ORG_NAME, ...E2E_PROJECTS.map(e2eTermsOrgName)],
    ]);
    // Users are global: the cascade leaves them.
    await client.query("DELETE FROM users WHERE email = ANY($1)", [
      [
        E2E_OWNER_EMAIL,
        ...E2E_PROJECTS.map((project) => E2E_ASSISTANT_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_MEMBER_EMAILS[project]),
        E2E_OTHER_OWNER_EMAIL,
        E2E_TRIAL_OWNER_EMAIL,
        E2E_PAUSED_OWNER_EMAIL,
        ...E2E_PROJECTS.map((project) => E2E_TERMS_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_ACTIVITY_MEMBER_EMAILS[project]),
      ],
    ]);
    // Tokens left by a half-failed run.
    await client.query("DELETE FROM auth_verifications WHERE value NOT IN (SELECT id::text FROM users)");
  } finally {
    await client.end();
  }
}

async function main(): Promise<number> {
  const config = loadConfig();
  configureMailHosts({ allowLocal: mailAllowLocal(config) });
  const migratorUrl = process.env.MIGRATOR_DATABASE_URL ?? "";
  const target = seedTargetOk(config.DATABASE_URL, migratorUrl);
  if (!target.ok) {
    log.error(`refusing: ${target.reason}`);
    return 1;
  }
  const baseUrl = config.WEB_BASE_URL;
  const secret = config.WEB_AUTH_SECRET;
  if (baseUrl === undefined || secret === undefined) {
    log.error("refusing: WEB_BASE_URL is empty");
    return 1;
  }

  // The role check fails before the destructive wipe when DATABASE_URL points at the wrong role.
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);

    await wipe(migratorUrl);

    const resets: { userId: string; url: string }[] = [];
    const handle = createAuth({
      databaseUrl: config.DATABASE_URL,
      baseUrl,
      secret,
      trustedOrigins: [baseUrl, ...webTrustedOrigins(config)],
      onEvent: auditWebEvent(db),
      onTermsAccepted: termsAcceptedHandler(db, () => new Date()),
      resetLinkTtlSeconds: 86_400,
      sendResetPassword: async (reset) => {
        resets.push(reset);
      },
    });
    try {
      const owner = await createOrganizationWithOwner(db, {
        orgName: E2E_ORG_NAME,
        timezone: "Europe/Warsaw",
        email: E2E_OWNER_EMAIL,
        displayName: "E2E Owner",
      });
      const assistantIds = {} as Record<E2eProject, string>;
      for (const project of E2E_PROJECTS) {
        const user = await insertUser(db, {
          email: E2E_ASSISTANT_EMAILS[project],
          displayName: `E2E Assistant ${project}`,
        });
        await insertMembership(db, { orgId: owner.orgId }, { userId: user.id, role: "assistant" });
        assistantIds[project] = user.id;
      }

      const memberIds = {} as Record<E2eProject, string>;
      for (const project of E2E_PROJECTS) {
        const user = await insertUser(db, {
          email: E2E_MEMBER_EMAILS[project],
          displayName: `E2E Member ${project}`,
        });
        await insertMembership(db, { orgId: owner.orgId }, { userId: user.id, role: "assistant" });
        memberIds[project] = user.id;
      }

      const activityIds = {} as Record<E2eProject, string>;
      for (const project of E2E_PROJECTS) {
        const user = await insertUser(db, {
          email: E2E_ACTIVITY_MEMBER_EMAILS[project],
          displayName: `E2E Activity ${project}`,
        });
        await insertMembership(db, { orgId: owner.orgId }, { userId: user.id, role: "assistant" });
        activityIds[project] = user.id;
      }

      // One organization per project with an owner whose accepted terms are old: the panel shows the terms dialog.
      const termsIds = {} as Record<E2eProject, string>;
      for (const project of E2E_PROJECTS) {
        const termsOwner = await createOrganizationWithOwner(db, {
          orgName: e2eTermsOrgName(project),
          timezone: "Europe/Warsaw",
          email: E2E_TERMS_EMAILS[project],
          displayName: `E2E Terms ${project}`,
        });
        termsIds[project] = termsOwner.userId;
      }

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

      // Takes the link of the last reset request for an e-mail address.
      const requestLink = async (email: string): Promise<string> => {
        resets.length = 0;
        await handle.auth.api.requestPasswordReset({ body: { email, redirectTo: `${baseUrl}/setup` } });
        const url = resets[0]?.url;
        if (url === undefined) throw new Error("no reset link was produced");
        return url;
      };

      // Every password set carries the current terms (F082 L16): the seeded users have accepted them.
      const setPassword = async (newPassword: string, token: string): Promise<void> => {
        const body = { newPassword, token, termsVersion: TERMS_VERSION };
        await handle.auth.api.resetPassword({ body });
      };

      const ownerLink = await requestLink(E2E_OWNER_EMAIL);
      const token = new URL(ownerLink).pathname.split("/").pop() ?? "";
      await setPassword(E2E_OWNER_PASSWORD, token);

      for (const email of [E2E_TRIAL_OWNER_EMAIL, E2E_PAUSED_OWNER_EMAIL]) {
        const planToken = new URL(await requestLink(email)).pathname.split("/").pop() ?? "";
        await setPassword(E2E_OWNER_PASSWORD, planToken);
      }

      const assistants = {} as SeedFile["assistants"];
      for (const project of E2E_PROJECTS) {
        const email = E2E_ASSISTANT_EMAILS[project];
        assistants[project] = { userId: assistantIds[project], email, setupUrl: await requestLink(email) };
      }

      const members = {} as SeedFile["members"];
      for (const project of E2E_PROJECTS) {
        const email = E2E_MEMBER_EMAILS[project];
        const memberToken = new URL(await requestLink(email)).pathname.split("/").pop() ?? "";
        await setPassword(E2E_MEMBER_PASSWORD, memberToken);
        members[project] = { userId: memberIds[project], email, password: E2E_MEMBER_PASSWORD };
      }

      const activityMembers = {} as SeedFile["activityMembers"];
      for (const project of E2E_PROJECTS) {
        const email = E2E_ACTIVITY_MEMBER_EMAILS[project];
        const activityToken = new URL(await requestLink(email)).pathname.split("/").pop() ?? "";
        await setPassword(E2E_MEMBER_PASSWORD, activityToken);
        activityMembers[project] = { userId: activityIds[project], email, password: E2E_MEMBER_PASSWORD };
      }

      // The reset stores the current terms; the terms owners then go back to an old version.
      const termsOwners = {} as SeedFile["termsOwners"];
      for (const project of E2E_PROJECTS) {
        const email = E2E_TERMS_EMAILS[project];
        const termsToken = new URL(await requestLink(email)).pathname.split("/").pop() ?? "";
        await setPassword(E2E_MEMBER_PASSWORD, termsToken);
        await setUserTerms(db, termsIds[project], "2000-01-01", new Date());
        termsOwners[project] = { userId: termsIds[project], email, password: E2E_MEMBER_PASSWORD };
      }

      const seed: SeedFile = {
        orgId: owner.orgId,
        owner: { userId: owner.userId, email: E2E_OWNER_EMAIL, password: E2E_OWNER_PASSWORD },
        assistants,
        members,
        otherOrg: { orgId: other.orgId, emailId: otherMail.emailId },
        activityMembers,
        termsOwners,
        trialOwner: {
          userId: trial.userId,
          email: E2E_TRIAL_OWNER_EMAIL,
          password: E2E_OWNER_PASSWORD,
          orgId: trial.orgId,
          trialEndsAt: trialEndsAt.toISOString(),
        },
        pausedOwner: {
          userId: paused.userId,
          email: E2E_PAUSED_OWNER_EMAIL,
          password: E2E_OWNER_PASSWORD,
          orgId: paused.orgId,
          mailboxId: pausedMailboxId,
        },
      };
      const path = seedFilePath(repoRoot);
      await mkdir(dirname(path), { recursive: true });
      // An old file may have wider permissions: remove it so the new one is never readable by others.
      await rm(path, { force: true });
      await writeFile(path, `${JSON.stringify(seed, null, 2)}\n`, { mode: 0o600 });

      log.info(
        `seeded org ${seed.orgId} owner ${seed.owner.userId} assistants ${E2E_PROJECTS.map((project) => assistantIds[project]).join(",")} members ${E2E_PROJECTS.map((project) => memberIds[project]).join(",")} trial org ${trial.orgId} paused org ${paused.orgId}`
      );
      return 0;
    } finally {
      await handle.close();
    }
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error(`failed: ${describeError(error)}`);
    process.exit(1);
  });
