import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { TERMS_VERSION } from "@ea/core";

import { configureMailHosts } from "../modules/mail";
import { createAuth } from "../platform/auth";
import { createCliOutput } from "../platform/cli";
import { loadConfig, mailAllowLocal, webTrustedOrigins } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";
import { auditWebEvent, termsAcceptedHandler } from "../web";

import { seedApprovals, finishApprovals } from "./e2e-seed/seed-approvals";
import { type SeedContext } from "./e2e-seed/seed-context";
import { seedDelegates, finishDelegates } from "./e2e-seed/seed-delegates";
import { seedDelegations, finishDelegations } from "./e2e-seed/seed-delegations";
import { seedDelete, finishDelete } from "./e2e-seed/seed-delete";
import { seedLoops, finishLoops } from "./e2e-seed/seed-loops";
import { seedMainOrg, finishMainOrg } from "./e2e-seed/seed-main-org";
import { seedNewsletters, finishNewsletters } from "./e2e-seed/seed-newsletters";
import { seedOpenLoops, finishOpenLoops } from "./e2e-seed/seed-open-loops";
import { seedPlanOrgs } from "./e2e-seed/seed-plan-orgs";
import { seedReplyPanel, finishReplyPanel } from "./e2e-seed/seed-reply-panel";
import { seedReplyStyle, finishReplyStyle } from "./e2e-seed/seed-reply-style";
import { seedReview, finishReview } from "./e2e-seed/seed-review";
import { seedSuggestions, finishSuggestions } from "./e2e-seed/seed-suggestions";
import { seedTermsTwoFactor, finishTermsTwoFactor } from "./e2e-seed/seed-terms-two-factor";
import { seedTrust, finishTrust } from "./e2e-seed/seed-trust";
import { seedUrgency, finishUrgency } from "./e2e-seed/seed-urgency";
import { wipe } from "./e2e-seed/seed-wipe";
import {
  E2E_OWNER_EMAIL,
  E2E_OWNER_PASSWORD,
  E2E_PAUSED_OWNER_EMAIL,
  E2E_PROJECTS,
  E2E_STATS_OWNER_EMAIL,
  E2E_TRIAL_OWNER_EMAIL,
  type SeedFile,
  seedFilePath,
  seedTargetOk,
} from "./e2e-seed-args";

const out = createCliOutput("e2e-seed");

const repoRoot = resolve(import.meta.dir, "../../../..");

async function main(): Promise<number> {
  const config = loadConfig();
  configureMailHosts({ allowLocal: mailAllowLocal(config) });
  const migratorUrl = process.env.MIGRATOR_DATABASE_URL ?? "";
  const target = seedTargetOk(config.DATABASE_URL, migratorUrl);
  if (!target.ok) {
    out.fail(`refusing: ${target.reason}`);
    return 1;
  }
  const baseUrl = config.WEB_BASE_URL;
  const secret = config.WEB_AUTH_SECRET;
  if (baseUrl === undefined || secret === undefined) {
    out.fail("refusing: WEB_BASE_URL is empty");
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
      // Takes the link of the last reset request for an e-mail address.
      const requestLink = async (email: string): Promise<string> => {
        resets.length = 0;
        await handle.auth.api.requestPasswordReset({ body: { email, redirectTo: `${baseUrl}/setup` } });
        const url = resets[0]?.url;
        if (url === undefined) throw new Error("no reset link was produced");
        return url;
      };

      // Every password set carries the current terms: the seeded users have accepted them.
      const setPassword = async (newPassword: string, token: string): Promise<void> => {
        const body = { newPassword, token, termsVersion: TERMS_VERSION };
        await handle.auth.api.resetPassword({ body });
      };

      const ctx: SeedContext = {
        db,
        config,
        secretBox: createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION),
        requestLink,
        setPassword,
      };

      const { owner, assistantIds, memberIds, activityIds } = await seedMainOrg(ctx);
      const { termsIds, twoFactorIds } = await seedTermsTwoFactor(ctx);
      const { deleteIds } = await seedDelete(ctx);
      const { approvalsIds } = await seedApprovals(ctx);
      const { delegatesIds } = await seedDelegates(ctx);
      const { delegationsIds } = await seedDelegations(ctx);
      const { openLoopsIds } = await seedOpenLoops(ctx);
      const { urgencyIds } = await seedUrgency(ctx);
      const { trustIds } = await seedTrust(ctx);
      const { replyStyleIds } = await seedReplyStyle(ctx);
      const { replyPanelIds } = await seedReplyPanel(ctx);
      const { newsletterIds } = await seedNewsletters(ctx);
      const { suggestionIds } = await seedSuggestions(ctx);
      const { reviewIds } = await seedReview(ctx);
      const { loopsIds } = await seedLoops(ctx);
      const { other, otherMail, trial, trialEndsAt, paused, pausedMailboxId, stats } = await seedPlanOrgs(ctx);

      const { assistants, members, activityMembers } = await finishMainOrg(ctx, {
        assistantIds,
        memberIds,
        activityIds,
      });
      const { deleteOrgs } = await finishDelete(ctx, { deleteIds });
      const { approvalsOrgs } = await finishApprovals(ctx, { approvalsIds });
      const { delegatesOrgs } = await finishDelegates(ctx, { delegatesIds });
      const { delegationsOrgs } = await finishDelegations(ctx, { delegationsIds });
      const { openLoopsOrgs } = await finishOpenLoops(ctx, { openLoopsIds });
      const { urgencyOrgs } = await finishUrgency(ctx, { urgencyIds });
      const { replyStyleOrgs } = await finishReplyStyle(ctx, { replyStyleIds });
      const { replyPanelOrgs } = await finishReplyPanel(ctx, { replyPanelIds });
      const { trustOrgs } = await finishTrust(ctx, { trustIds });
      const { newsletterOrgs } = await finishNewsletters(ctx, { newsletterIds });
      const { suggestionOrgs } = await finishSuggestions(ctx, { suggestionIds });
      const { reviewOrgs } = await finishReview(ctx, { reviewIds });
      const { loopsOrgs } = await finishLoops(ctx, { loopsIds });
      const { termsOwners, twoFactorOwners } = await finishTermsTwoFactor(ctx, { termsIds, twoFactorIds });

      const seed: SeedFile = {
        orgId: owner.orgId,
        owner: { userId: owner.userId, email: E2E_OWNER_EMAIL, password: E2E_OWNER_PASSWORD },
        assistants,
        members,
        otherOrg: { orgId: other.orgId, emailId: otherMail.emailId },
        activityMembers,
        termsOwners,
        twoFactorOwners,
        deleteOrgs,
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
        statsOwner: {
          userId: stats.userId,
          email: E2E_STATS_OWNER_EMAIL,
          password: E2E_OWNER_PASSWORD,
          orgId: stats.orgId,
        },
        delegatesOrgs,
        delegationsOrgs,
        openLoopsOrgs,
        urgencyOrgs,
        trustOrgs,
        replyStyleOrgs,
        replyPanelOrgs,
        newsletterOrgs,
        suggestionOrgs,
        reviewOrgs,
        approvalsOrgs,
        loopsOrgs,
      };
      const path = seedFilePath(repoRoot);
      await mkdir(dirname(path), { recursive: true });
      // An old file may have wider permissions: remove it so the new one is never readable by others.
      await rm(path, { force: true });
      await writeFile(path, `${JSON.stringify(seed, null, 2)}\n`, { mode: 0o600 });

      out.print(
        `seeded org ${seed.orgId} owner ${seed.owner.userId} assistants ${E2E_PROJECTS.map((project) => assistantIds[project]).join(",")} members ${E2E_PROJECTS.map((project) => memberIds[project]).join(",")} trial org ${trial.orgId} paused org ${paused.orgId} approvals orgs ${E2E_PROJECTS.map((project) => approvalsIds[project].orgId).join(",")}`
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
    out.fail(`failed: ${describeError(error)}`);
    process.exit(1);
  });
