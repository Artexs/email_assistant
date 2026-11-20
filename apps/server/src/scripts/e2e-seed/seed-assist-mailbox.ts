import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { DAY_MS, TERMS_VERSION } from "@ea/core";
import { Client } from "pg";

import { insertDefaultSettings, setUrgencyProfile, updateMailboxSettings } from "../modules/config";
import { configureMailHosts } from "../modules/mail";
import { insertCredentials, insertInboxFolder, insertMailbox } from "../modules/mail/repo";
import {
  createOrganizationWithOwner,
  insertMembership,
  insertUser,
  setOrgPlan,
  setUserTerms,
  upsertOrgFeature,
} from "../modules/tenancy";
import { createAuth } from "../platform/auth";
import { createCliOutput } from "../platform/cli";
import { loadConfig, mailAllowLocal, webTrustedOrigins } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb, type Db } from "../platform/db";
import { describeError } from "../platform/errors";
import { auditWebEvent, termsAcceptedHandler } from "../web";

import {
  E2E_ACTIVITY_MEMBER_EMAILS,
  E2E_APPROVALS_MEMBER_EMAILS,
  E2E_APPROVALS_OWNER_EMAILS,
  E2E_DELEGATES_ANNA,
  E2E_DELEGATES_MEMBER_EMAILS,
  E2E_DELEGATES_OWNER_EMAILS,
  e2eDelegatesOrgName,
  e2eApprovalsMailbox,
  e2eDelegatesMailbox,
  e2eDelegationsMailbox,
  e2eDelegationsOrgName,
  E2E_DELEGATIONS_MEMBER_EMAILS,
  E2E_DELEGATIONS_OWNER_EMAILS,
  e2eOpenLoopsMailbox,
  e2eOpenLoopsOrgName,
  E2E_OPEN_LOOPS_MEMBER_EMAILS,
  E2E_OPEN_LOOPS_OWNER_EMAILS,
  e2eApprovalsOrgName,
  E2E_LOOPS_CHAT_IDS,
  E2E_LOOPS_MEMBER_EMAILS,
  E2E_LOOPS_OWNER_EMAILS,
  e2eLoopsMailbox,
  e2eLoopsOrgName,
  E2E_REPLY_STYLE_MEMBER_EMAILS,
  E2E_REPLY_STYLE_OWNER_EMAILS,
  e2eReplyPanelMailbox,
  e2eReplyPanelOrgName,
  E2E_REPLY_PANEL_MEMBER_EMAILS,
  E2E_REPLY_PANEL_OWNER_EMAILS,
  e2eReplyStyleMailbox,
  e2eReplyStyleOrgName,
  E2E_TRUST_MEMBER_EMAILS,
  E2E_TRUST_OWNER_EMAILS,
  E2E_URGENCY_MEMBER_EMAILS,
  E2E_URGENCY_OWNER_EMAILS,
  E2E_REPORT_KINDS,
  e2eReportMailbox,
  e2eTrustMailbox,
  e2eTrustOrgName,
  type E2eReportKind,
  E2E_NEWSLETTERS_MEMBER_EMAILS,
  E2E_NEWSLETTERS_OWNER_EMAILS,
  e2eNewslettersMailbox,
  e2eNewslettersOrgName,
  E2E_SUGGESTIONS_MEMBER_EMAILS,
  E2E_SUGGESTIONS_OWNER_EMAILS,
  e2eSuggestionsMailbox,
  e2eSuggestionsOrgName,
  E2E_REVIEW_MEMBER_EMAILS,
  E2E_REVIEW_OWNER_EMAILS,
  e2eReviewMailbox,
  e2eReviewOrgName,
  e2eUrgencyMailbox,
  e2eUrgencyOrgName,
  e2eUrgencyProfile,
  E2E_ASSISTANT_EMAILS,
  E2E_DELETE_ASSISTANT_EMAILS,
  E2E_DELETE_OWNER_EMAILS,
  e2eDeleteMailbox,
  e2eDeleteOrgName,
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
  E2E_STATS_ORG_NAME,
  E2E_STATS_OWNER_EMAIL,
  E2E_TERMS_EMAILS,
  E2E_TIMEZONE,
  e2eTermsOrgName,
  E2E_TRIAL_ORG_NAME,
  E2E_TRIAL_OWNER_EMAIL,
  E2E_TWO_FACTOR_EMAILS,
  e2eTwoFactorOrgName,
  type E2eProject,
  type SeedFile,
  assertTaggedMailbox,
  mailTagFromEnv,
  seedFilePath,
  seedTargetOk,
} from "./e2e-seed-args";
import { seedActivityRows, seedOtherOrgMail } from "./lib/e2e-activity-rows";
import { seedApprovalsRows } from "./lib/e2e-approvals-rows";
import { seedDelegationsRows } from "./lib/e2e-delegations-rows";
import { seedLoopsRows } from "./lib/e2e-loops-rows";
import { seedNewsletterRows } from "./lib/e2e-newsletter-rows";
import { seedOpenLoopsRows } from "./lib/e2e-open-loops-rows";
import { seedReplyPanelRows, type ReplyPanelSeedResult } from "./lib/e2e-reply-panel-rows";
import { seedReviewRows } from "./lib/e2e-review-rows";
import { seedSuggestionRows } from "./lib/e2e-suggestion-rows";
import { seedReportRows, seedTrustRows } from "./lib/e2e-trust-rows";

const out = createCliOutput("e2e-seed");

// The GreenMail of the dev stack (the same host that the Playwright config uses).
const GREENMAIL_HOST = process.env.TEST_IMAP_HOST ?? "127.0.0.1";
const ASSIST_SWITCHES = { move: true, mark_read: true, flag: true, create_draft: true, move_unsure: false };
const TRIAL_DAYS = 10;

const repoRoot = resolve(import.meta.dir, "../../../..");

// A mailbox on the GreenMail of the dev stack, in assist mode with the draft switch on, as the approvals and the reminders need it (an
// approval of a draft-less mailbox is a shadow plan). The password is a test value; the mailbox is never polled by a spec.
async function seedAssistMailbox(
  db: Db,
  secretBox: ReturnType<typeof createSecretBox>,
  ctx: { orgId: string },
  address: string,
  mode: "assist" | "shadow" = "assist",
  opts: { oauthProvider?: "microsoft" | "google" } = {}
): Promise<string> {
  assertTaggedMailbox(address, mailTagFromEnv(process.env));
  const mailboxId = randomUUID();
  await insertMailbox(db, ctx, {
    id: mailboxId,
    address,
    imapHost: GREENMAIL_HOST,
    imapPort: 3143,
    smtpHost: GREENMAIL_HOST,
    smtpPort: 3025,
    capabilities: { move: true, uidplus: true, idle: false, condstore: false, specialUse: false, keywords: false },
    folderMap: { drafts: "Drafts" },
    ...(opts.oauthProvider === undefined ? {} : { oauthProvider: opts.oauthProvider }),
  });
  await insertInboxFolder(db, ctx, mailboxId);
  const mailboxSecret = secretBox.encrypt("e2e-assist-box-password", `mailbox:${mailboxId}`);
  await insertCredentials(db, ctx, {
    mailboxId,
    encryptedSecret: mailboxSecret.ciphertext,
    secretKind: "password",
    keyVersion: mailboxSecret.keyVersion,
  });
  await insertDefaultSettings(db, ctx, mailboxId);
  // `shadow` is the mode of a new mailbox: nothing to change.
  if (mode === "assist") {
    await db
      .transaction()
      .execute((trx) => updateMailboxSettings(trx, ctx, mailboxId, { mode: "assist", toolSwitches: ASSIST_SWITCHES }));
  }
  return mailboxId;
}

async function wipe(migratorUrl: string): Promise<void> {
  const client = new Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    // The organization cascade removes mailboxes, mail, actions, memberships and audit rows.
    await client.query("DELETE FROM organizations WHERE name = ANY($1)", [
      [
        E2E_ORG_NAME,
        E2E_OTHER_ORG_NAME,
        E2E_TRIAL_ORG_NAME,
        E2E_PAUSED_ORG_NAME,
        E2E_STATS_ORG_NAME,
        ...E2E_PROJECTS.map(e2eTermsOrgName),
        ...E2E_PROJECTS.map(e2eTwoFactorOrgName),
        ...E2E_PROJECTS.map(e2eDeleteOrgName),
        ...E2E_PROJECTS.map(e2eApprovalsOrgName),
        ...E2E_PROJECTS.map(e2eDelegatesOrgName),
        ...E2E_PROJECTS.map(e2eDelegationsOrgName),
        ...E2E_PROJECTS.map(e2eOpenLoopsOrgName),
        ...E2E_PROJECTS.map(e2eUrgencyOrgName),
        ...E2E_PROJECTS.map(e2eTrustOrgName),
        ...E2E_PROJECTS.map(e2eNewslettersOrgName),
        ...E2E_PROJECTS.map(e2eSuggestionsOrgName),
        ...E2E_PROJECTS.map(e2eReviewOrgName),
        ...E2E_PROJECTS.map(e2eLoopsOrgName),
        ...E2E_PROJECTS.map(e2eReplyStyleOrgName),
        ...E2E_PROJECTS.map(e2eReplyPanelOrgName),
      ],
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
        E2E_STATS_OWNER_EMAIL,
        ...E2E_PROJECTS.map((project) => E2E_TERMS_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_TWO_FACTOR_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_ACTIVITY_MEMBER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_DELETE_OWNER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_DELETE_ASSISTANT_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_APPROVALS_OWNER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_APPROVALS_MEMBER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_DELEGATES_OWNER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_DELEGATES_MEMBER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_DELEGATIONS_OWNER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_DELEGATIONS_MEMBER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_OPEN_LOOPS_OWNER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_OPEN_LOOPS_MEMBER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_URGENCY_OWNER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_URGENCY_MEMBER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_TRUST_OWNER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_TRUST_MEMBER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_NEWSLETTERS_OWNER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_NEWSLETTERS_MEMBER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_SUGGESTIONS_OWNER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_SUGGESTIONS_MEMBER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_REVIEW_OWNER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_REVIEW_MEMBER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_LOOPS_OWNER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_LOOPS_MEMBER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_REPLY_STYLE_OWNER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_REPLY_STYLE_MEMBER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_REPLY_PANEL_OWNER_EMAILS[project]),
        ...E2E_PROJECTS.map((project) => E2E_REPLY_PANEL_MEMBER_EMAILS[project]),
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

      // One organization per project with an owner whose second factor starts off: the two-factor spec turns it on and off.
      const twoFactorIds = {} as Record<E2eProject, { userId: string; orgId: string }>;
      for (const project of E2E_PROJECTS) {
        const twoFactorOwner = await createOrganizationWithOwner(db, {
          orgName: e2eTwoFactorOrgName(project),
          timezone: "Europe/Warsaw",
          email: E2E_TWO_FACTOR_EMAILS[project],
          displayName: `E2E Two-factor ${project}`,
        });
        twoFactorIds[project] = { userId: twoFactorOwner.userId, orgId: twoFactorOwner.orgId };
      }

      // One organization per project with the flag `org_delete` on, one mailbox with mail rows, an owner and
      // an assistant. Only the delete spec uses them: it deletes the organization. The mailbox points at a closed port, so no sync
      // reaches the GreenMail of the dev stack.
      const secretBox = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
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

      // One organization per project for the approvals spec. The flags are on; the mailbox is the GreenMail of the dev
      // stack, so an approved send to the delegate that SEND_SCOPE=self admits goes out and leaves the list. See `e2e-approvals-rows.ts`.
      const approvalsIds = {} as Record<
        E2eProject,
        { orgId: string; ownerId: string; memberId: string } & Awaited<ReturnType<typeof seedApprovalsRows>>
      >;
      for (const project of E2E_PROJECTS) {
        const approvalsOwner = await createOrganizationWithOwner(db, {
          orgName: e2eApprovalsOrgName(project),
          timezone: "Europe/Warsaw",
          email: E2E_APPROVALS_OWNER_EMAILS[project],
          displayName: `E2E Approvals owner ${project}`,
        });
        const ctx = { orgId: approvalsOwner.orgId };
        const member = await insertUser(db, {
          email: E2E_APPROVALS_MEMBER_EMAILS[project],
          displayName: `E2E Approvals member ${project}`,
        });
        await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
        for (const flag of ["approvals_page", "stats_page", "mistake_capture"] as const) {
          await upsertOrgFeature(db, ctx, { flag, enabled: true, setBy: approvalsOwner.userId, setAt: new Date() });
        }
        const mailboxId = await seedAssistMailbox(db, secretBox, ctx, e2eApprovalsMailbox(project));
        const rows = await seedApprovalsRows(db, ctx, mailboxId, approvalsOwner.userId, new Date());
        approvalsIds[project] = {
          orgId: approvalsOwner.orgId,
          ownerId: approvalsOwner.userId,
          memberId: member.id,
          ...rows,
        };
      }

      // One organization per project for the delegates spec. The flag `delegation_pages` is on; one delegate (Anna Nowak,
      // tag `finance`) and a mailbox.
      const delegatesIds = {} as Record<E2eProject, { orgId: string; ownerId: string; memberId: string }>;
      for (const project of E2E_PROJECTS) {
        const delegatesOwner = await createOrganizationWithOwner(db, {
          orgName: e2eDelegatesOrgName(project),
          timezone: "Europe/Warsaw",
          email: E2E_DELEGATES_OWNER_EMAILS[project],
          displayName: `E2E Delegates owner ${project}`,
        });
        const ctx = { orgId: delegatesOwner.orgId };
        const member = await insertUser(db, {
          email: E2E_DELEGATES_MEMBER_EMAILS[project],
          displayName: `E2E Delegates member ${project}`,
        });
        await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
        await upsertOrgFeature(db, ctx, {
          flag: "delegation_pages",
          enabled: true,
          setBy: delegatesOwner.userId,
          setAt: new Date(),
        });
        await db
          .insertInto("delegates")
          .values({
            org_id: ctx.orgId,
            name: E2E_DELEGATES_ANNA.name,
            email: E2E_DELEGATES_ANNA.email,
            competence_tags: [...E2E_DELEGATES_ANNA.tags],
          })
          .execute();
        // A mailbox address: adding it as a delegate gives 400 `mailbox_address` (the delegates spec).
        await seedAssistMailbox(db, secretBox, ctx, e2eDelegatesMailbox(project));
        delegatesIds[project] = { orgId: delegatesOwner.orgId, ownerId: delegatesOwner.userId, memberId: member.id };
      }

      // One organization per project for the delegations spec. The three flags are on (a full phone tab bar); the
      // mailbox is in assist mode with drafts on; one delegation for each case of the page. See `e2e-delegations-rows.ts`.
      const delegationsIds = {} as Record<
        E2eProject,
        { orgId: string; ownerId: string; memberId: string; draftedSendId: string }
      >;
      for (const project of E2E_PROJECTS) {
        const delegationsOwner = await createOrganizationWithOwner(db, {
          orgName: e2eDelegationsOrgName(project),
          timezone: "Europe/Warsaw",
          email: E2E_DELEGATIONS_OWNER_EMAILS[project],
          displayName: `E2E Delegations owner ${project}`,
        });
        const ctx = { orgId: delegationsOwner.orgId };
        const member = await insertUser(db, {
          email: E2E_DELEGATIONS_MEMBER_EMAILS[project],
          displayName: `E2E Delegations member ${project}`,
        });
        await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
        for (const flag of ["delegation_pages", "approvals_page", "stats_page"] as const) {
          await upsertOrgFeature(db, ctx, { flag, enabled: true, setBy: delegationsOwner.userId, setAt: new Date() });
        }
        const mailboxId = await seedAssistMailbox(db, secretBox, ctx, e2eDelegationsMailbox(project));
        const rows = await seedDelegationsRows(db, ctx, mailboxId, delegationsOwner.userId, new Date());
        delegationsIds[project] = {
          orgId: delegationsOwner.orgId,
          ownerId: delegationsOwner.userId,
          memberId: member.id,
          ...rows,
        };
      }

      // One organization per project for the open loops page spec (`open-loops.spec.ts`). The flags `open_loops`,
      // `delegation_pages` and `approvals_page` are on; the mailbox is in assist mode with drafts on. See `e2e-open-loops-rows.ts`.
      const openLoopsIds = {} as Record<
        E2eProject,
        { orgId: string; ownerId: string; memberId: string; rows: Awaited<ReturnType<typeof seedOpenLoopsRows>> }
      >;
      for (const project of E2E_PROJECTS) {
        const openOwner = await createOrganizationWithOwner(db, {
          orgName: e2eOpenLoopsOrgName(project),
          timezone: E2E_TIMEZONE,
          email: E2E_OPEN_LOOPS_OWNER_EMAILS[project],
          displayName: `E2E Open Loops owner ${project}`,
        });
        const ctx = { orgId: openOwner.orgId };
        const member = await insertUser(db, {
          email: E2E_OPEN_LOOPS_MEMBER_EMAILS[project],
          displayName: `E2E Open Loops member ${project}`,
        });
        await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
        for (const flag of ["open_loops", "delegation_pages", "approvals_page"] as const) {
          await upsertOrgFeature(db, ctx, { flag, enabled: true, setBy: openOwner.userId, setAt: new Date() });
        }
        const mailboxId = await seedAssistMailbox(db, secretBox, ctx, e2eOpenLoopsMailbox(project));
        const rows = await seedOpenLoopsRows(db, ctx, mailboxId, openOwner.userId, new Date());
        openLoopsIds[project] = { orgId: openOwner.orgId, ownerId: openOwner.userId, memberId: member.id, rows };
      }

      // One organization per project for the urgency editor spec. The flag `urgency_editor` is on; two mailboxes, one
      // with a profile (a topic, a deadline of yesterday, a deadline in ten days) and one without.
      const urgencyIds = {} as Record<
        E2eProject,
        { orgId: string; ownerId: string; memberId: string; seededId: string; emptyId: string }
      >;
      for (const project of E2E_PROJECTS) {
        const urgencyOwner = await createOrganizationWithOwner(db, {
          orgName: e2eUrgencyOrgName(project),
          timezone: E2E_TIMEZONE,
          email: E2E_URGENCY_OWNER_EMAILS[project],
          displayName: `E2E Urgency owner ${project}`,
        });
        const ctx = { orgId: urgencyOwner.orgId };
        const member = await insertUser(db, {
          email: E2E_URGENCY_MEMBER_EMAILS[project],
          displayName: `E2E Urgency member ${project}`,
        });
        await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
        await upsertOrgFeature(db, ctx, {
          flag: "urgency_editor",
          enabled: true,
          setBy: urgencyOwner.userId,
          setAt: new Date(),
        });
        const seededId = await seedAssistMailbox(db, secretBox, ctx, e2eUrgencyMailbox(project, "seeded"));
        const emptyId = await seedAssistMailbox(db, secretBox, ctx, e2eUrgencyMailbox(project, "empty"));
        await setUrgencyProfile(db, ctx, seededId, e2eUrgencyProfile(new Date()), { via: "cli" });
        urgencyIds[project] = {
          orgId: urgencyOwner.orgId,
          ownerId: urgencyOwner.userId,
          memberId: member.id,
          seededId,
          emptyId,
        };
      }

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

      // One organization per project for the style card spec. The flag `reply_drafts` is on; two mailboxes in assist mode,
      // one with a password and one that signs in with a provider (the reply drafts switch is disabled for it).
      const replyStyleIds = {} as Record<
        E2eProject,
        { orgId: string; ownerId: string; memberId: string; boxId: string; oauthId: string }
      >;
      for (const project of E2E_PROJECTS) {
        const replyOwner = await createOrganizationWithOwner(db, {
          orgName: e2eReplyStyleOrgName(project),
          timezone: E2E_TIMEZONE,
          email: E2E_REPLY_STYLE_OWNER_EMAILS[project],
          displayName: `E2E Reply Style owner ${project}`,
        });
        const ctx = { orgId: replyOwner.orgId };
        const member = await insertUser(db, {
          email: E2E_REPLY_STYLE_MEMBER_EMAILS[project],
          displayName: `E2E Reply Style member ${project}`,
        });
        await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
        await upsertOrgFeature(db, ctx, {
          flag: "reply_drafts",
          enabled: true,
          setBy: replyOwner.userId,
          setAt: new Date(),
        });
        const boxId = await seedAssistMailbox(db, secretBox, ctx, e2eReplyStyleMailbox(project, "box"));
        const oauthId = await seedAssistMailbox(db, secretBox, ctx, e2eReplyStyleMailbox(project, "oauth"), "assist", {
          oauthProvider: "google",
        });
        replyStyleIds[project] = {
          orgId: replyOwner.orgId,
          ownerId: replyOwner.userId,
          memberId: member.id,
          boxId,
          oauthId,
        };
      }

      // One organization per project for the reply panel spec. The flags `approvals_page` and `reply_drafts` are on, and so is the reply
      // switch of the mailbox. See `e2e-reply-panel-rows.ts`.
      const replyPanelIds = {} as Record<
        E2eProject,
        { orgId: string; ownerId: string; memberId: string; mailboxId: string } & ReplyPanelSeedResult
      >;
      for (const project of E2E_PROJECTS) {
        const panelOwner = await createOrganizationWithOwner(db, {
          orgName: e2eReplyPanelOrgName(project),
          timezone: E2E_TIMEZONE,
          email: E2E_REPLY_PANEL_OWNER_EMAILS[project],
          displayName: `E2E Reply Panel owner ${project}`,
        });
        const ctx = { orgId: panelOwner.orgId };
        const member = await insertUser(db, {
          email: E2E_REPLY_PANEL_MEMBER_EMAILS[project],
          displayName: `E2E Reply Panel member ${project}`,
        });
        await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
        for (const flag of ["approvals_page", "reply_drafts"] as const) {
          await upsertOrgFeature(db, ctx, { flag, enabled: true, setBy: panelOwner.userId, setAt: new Date() });
        }
        const address = e2eReplyPanelMailbox(project);
        const mailboxId = await seedAssistMailbox(db, secretBox, ctx, address);
        await db.transaction().execute((trx) =>
          updateMailboxSettings(trx, ctx, mailboxId, {
            mode: "assist",
            toolSwitches: { ...ASSIST_SWITCHES, reply_drafts: true },
          })
        );
        const rows = await seedReplyPanelRows(db, ctx, mailboxId, address, panelOwner.userId, new Date());
        replyPanelIds[project] = {
          orgId: panelOwner.orgId,
          ownerId: panelOwner.userId,
          memberId: member.id,
          mailboxId,
          ...rows,
        };
      }

      // One organization per project for the newsletters spec. The flag `bulk_unsubscribe` is on; one mailbox with five
      // newsletter senders and one request. See `e2e-newsletter-rows.ts`.
      const newsletterIds = {} as Record<
        E2eProject,
        { orgId: string; ownerId: string; memberId: string; mailboxId: string }
      >;
      for (const project of E2E_PROJECTS) {
        const newsletterOwner = await createOrganizationWithOwner(db, {
          orgName: e2eNewslettersOrgName(project),
          timezone: E2E_TIMEZONE,
          email: E2E_NEWSLETTERS_OWNER_EMAILS[project],
          displayName: `E2E Newsletters owner ${project}`,
        });
        const ctx = { orgId: newsletterOwner.orgId };
        const member = await insertUser(db, {
          email: E2E_NEWSLETTERS_MEMBER_EMAILS[project],
          displayName: `E2E Newsletters member ${project}`,
        });
        await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
        await upsertOrgFeature(db, ctx, {
          flag: "bulk_unsubscribe",
          enabled: true,
          setBy: newsletterOwner.userId,
          setAt: new Date(),
        });
        const mailboxId = await seedAssistMailbox(db, secretBox, ctx, e2eNewslettersMailbox(project));
        await seedNewsletterRows(db, ctx, mailboxId, new Date());
        newsletterIds[project] = {
          orgId: newsletterOwner.orgId,
          ownerId: newsletterOwner.userId,
          memberId: member.id,
          mailboxId,
        };
      }

      // One organization per project for the suggestions spec. The flags `sender_context`, `sender_suggestions` and `sent_sync` are
      // on; one mailbox with three open suggestions and Sent coverage. See `e2e-suggestion-rows.ts`.
      const suggestionIds = {} as Record<
        E2eProject,
        { orgId: string; ownerId: string; memberId: string; mailboxId: string }
      >;
      for (const project of E2E_PROJECTS) {
        const suggestionOwner = await createOrganizationWithOwner(db, {
          orgName: e2eSuggestionsOrgName(project),
          timezone: E2E_TIMEZONE,
          email: E2E_SUGGESTIONS_OWNER_EMAILS[project],
          displayName: `E2E Suggestions owner ${project}`,
        });
        const ctx = { orgId: suggestionOwner.orgId };
        const member = await insertUser(db, {
          email: E2E_SUGGESTIONS_MEMBER_EMAILS[project],
          displayName: `E2E Suggestions member ${project}`,
        });
        await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
        for (const flag of ["sender_context", "sender_suggestions", "sent_sync"] as const) {
          await upsertOrgFeature(db, ctx, { flag, enabled: true, setBy: suggestionOwner.userId, setAt: new Date() });
        }
        const mailboxId = await seedAssistMailbox(db, secretBox, ctx, e2eSuggestionsMailbox(project));
        await seedSuggestionRows(db, ctx, mailboxId, config.CREDENTIALS_KEY, new Date());
        suggestionIds[project] = {
          orgId: suggestionOwner.orgId,
          ownerId: suggestionOwner.userId,
          memberId: member.id,
          mailboxId,
        };
      }

      // One organization per project for the panel review spec. The flags `panel_review` and `trust_ladder` are on; one
      // mailbox with a done history check and 12 real, unlabelled mails. See `e2e-review-rows.ts`.
      const reviewIds = {} as Record<
        E2eProject,
        { orgId: string; ownerId: string; memberId: string; mailboxId: string }
      >;
      for (const project of E2E_PROJECTS) {
        const reviewOwner = await createOrganizationWithOwner(db, {
          orgName: e2eReviewOrgName(project),
          timezone: E2E_TIMEZONE,
          email: E2E_REVIEW_OWNER_EMAILS[project],
          displayName: `E2E Review owner ${project}`,
        });
        const ctx = { orgId: reviewOwner.orgId };
        const member = await insertUser(db, {
          email: E2E_REVIEW_MEMBER_EMAILS[project],
          displayName: `E2E Review member ${project}`,
        });
        await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
        for (const flag of ["panel_review", "trust_ladder"] as const) {
          await upsertOrgFeature(db, ctx, { flag, enabled: true, setBy: reviewOwner.userId, setAt: new Date() });
        }
        const mailboxId = await seedAssistMailbox(db, secretBox, ctx, e2eReviewMailbox(project));
        await seedReviewRows(db, ctx, mailboxId, new Date());
        reviewIds[project] = { orgId: reviewOwner.orgId, ownerId: reviewOwner.userId, memberId: member.id, mailboxId };
      }

      // One organization per project for the loops spec. The flags `open_loops`, `delegate_button`, `delegation_pages`,
      // `sent_sync` and `approvals_page` are on; one active delegate; a mailbox in assist mode with drafts on that tracks Sent; the owner is linked to
      // Telegram with a consent of an old version. See `e2e-loops-rows.ts`.
      const loopsIds = {} as Record<
        E2eProject,
        { orgId: string; ownerId: string; memberId: string; mailboxId: string }
      >;
      for (const project of E2E_PROJECTS) {
        const loopsOwner = await createOrganizationWithOwner(db, {
          orgName: e2eLoopsOrgName(project),
          timezone: E2E_TIMEZONE,
          email: E2E_LOOPS_OWNER_EMAILS[project],
          displayName: `E2E Loops owner ${project}`,
        });
        const ctx = { orgId: loopsOwner.orgId };
        const member = await insertUser(db, {
          email: E2E_LOOPS_MEMBER_EMAILS[project],
          displayName: `E2E Loops member ${project}`,
        });
        await insertMembership(db, ctx, { userId: member.id, role: "assistant" });
        for (const flag of [
          "open_loops",
          "delegate_button",
          "delegation_pages",
          "sent_sync",
          "approvals_page",
        ] as const) {
          await upsertOrgFeature(db, ctx, { flag, enabled: true, setBy: loopsOwner.userId, setAt: new Date() });
        }
        await db
          .insertInto("delegates")
          .values({
            org_id: ctx.orgId,
            name: E2E_DELEGATES_ANNA.name,
            email: E2E_DELEGATES_ANNA.email,
            competence_tags: [...E2E_DELEGATES_ANNA.tags],
          })
          .execute();
        const mailboxId = await seedAssistMailbox(db, secretBox, ctx, e2eLoopsMailbox(project));
        await seedLoopsRows(db, ctx, mailboxId, loopsOwner.userId, E2E_LOOPS_CHAT_IDS[project], new Date());
        loopsIds[project] = { orgId: loopsOwner.orgId, ownerId: loopsOwner.userId, memberId: member.id, mailboxId };
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

      const ownerLink = await requestLink(E2E_OWNER_EMAIL);
      const token = new URL(ownerLink).pathname.split("/").pop() ?? "";
      await setPassword(E2E_OWNER_PASSWORD, token);

      for (const email of [E2E_TRIAL_OWNER_EMAIL, E2E_PAUSED_OWNER_EMAIL, E2E_STATS_OWNER_EMAIL]) {
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

      const deleteOrgs = {} as SeedFile["deleteOrgs"];
      for (const project of E2E_PROJECTS) {
        const ownerEmail = E2E_DELETE_OWNER_EMAILS[project];
        const assistantEmail = E2E_DELETE_ASSISTANT_EMAILS[project];
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
        await setPassword(
          E2E_MEMBER_PASSWORD,
          new URL(await requestLink(assistantEmail)).pathname.split("/").pop() ?? ""
        );
        deleteOrgs[project] = {
          orgId: deleteIds[project].orgId,
          name: e2eDeleteOrgName(project),
          mailboxAddress: e2eDeleteMailbox(project),
          owner: { userId: deleteIds[project].ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
          assistant: { userId: deleteIds[project].assistantId, email: assistantEmail, password: E2E_MEMBER_PASSWORD },
        };
      }

      const approvalsOrgs = {} as SeedFile["approvalsOrgs"];
      for (const project of E2E_PROJECTS) {
        const ownerEmail = E2E_APPROVALS_OWNER_EMAILS[project];
        const memberEmail = E2E_APPROVALS_MEMBER_EMAILS[project];
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
        const ids = approvalsIds[project];
        approvalsOrgs[project] = {
          orgId: ids.orgId,
          owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
          member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
          waitingSendId: ids.waitingSendId,
          heldSendId: ids.heldSendId,
          editSendId: ids.editSendId,
          closedSendId: ids.closedSendId,
          raceSendId: ids.raceSendId,
          reminderSendId: ids.reminderSendId,
        };
      }

      const delegatesOrgs = {} as SeedFile["delegatesOrgs"];
      for (const project of E2E_PROJECTS) {
        const ownerEmail = E2E_DELEGATES_OWNER_EMAILS[project];
        const memberEmail = E2E_DELEGATES_MEMBER_EMAILS[project];
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
        const ids = delegatesIds[project];
        delegatesOrgs[project] = {
          orgId: ids.orgId,
          owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
          member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
          mailboxAddress: e2eDelegatesMailbox(project),
        };
      }

      const delegationsOrgs = {} as SeedFile["delegationsOrgs"];
      for (const project of E2E_PROJECTS) {
        const ownerEmail = E2E_DELEGATIONS_OWNER_EMAILS[project];
        const memberEmail = E2E_DELEGATIONS_MEMBER_EMAILS[project];
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
        const ids = delegationsIds[project];
        delegationsOrgs[project] = {
          orgId: ids.orgId,
          owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
          member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
          draftedSendId: ids.draftedSendId,
        };
      }

      const openLoopsOrgs = {} as SeedFile["openLoopsOrgs"];
      for (const project of E2E_PROJECTS) {
        const ownerEmail = E2E_OPEN_LOOPS_OWNER_EMAILS[project];
        const memberEmail = E2E_OPEN_LOOPS_MEMBER_EMAILS[project];
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
        const ids = openLoopsIds[project];
        openLoopsOrgs[project] = {
          orgId: ids.orgId,
          owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
          member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
          ...ids.rows,
        };
      }

      const urgencyOrgs = {} as SeedFile["urgencyOrgs"];
      for (const project of E2E_PROJECTS) {
        const ownerEmail = E2E_URGENCY_OWNER_EMAILS[project];
        const memberEmail = E2E_URGENCY_MEMBER_EMAILS[project];
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
        const ids = urgencyIds[project];
        urgencyOrgs[project] = {
          orgId: ids.orgId,
          owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
          member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
          seeded: { id: ids.seededId, address: e2eUrgencyMailbox(project, "seeded") },
          empty: { id: ids.emptyId, address: e2eUrgencyMailbox(project, "empty") },
        };
      }

      const replyStyleOrgs = {} as SeedFile["replyStyleOrgs"];
      for (const project of E2E_PROJECTS) {
        const ownerEmail = E2E_REPLY_STYLE_OWNER_EMAILS[project];
        const memberEmail = E2E_REPLY_STYLE_MEMBER_EMAILS[project];
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
        const ids = replyStyleIds[project];
        replyStyleOrgs[project] = {
          orgId: ids.orgId,
          owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
          member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
          box: { id: ids.boxId, address: e2eReplyStyleMailbox(project, "box") },
          oauth: { id: ids.oauthId, address: e2eReplyStyleMailbox(project, "oauth") },
        };
      }

      const replyPanelOrgs = {} as SeedFile["replyPanelOrgs"];
      for (const project of E2E_PROJECTS) {
        const ownerEmail = E2E_REPLY_PANEL_OWNER_EMAILS[project];
        const memberEmail = E2E_REPLY_PANEL_MEMBER_EMAILS[project];
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
        const ids = replyPanelIds[project];
        replyPanelOrgs[project] = {
          orgId: ids.orgId,
          owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
          member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
          mailbox: { id: ids.mailboxId, address: e2eReplyPanelMailbox(project) },
          sendIds: ids.sendIds,
          mailIds: ids.mailIds,
        };
      }

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

      const newsletterOrgs = {} as SeedFile["newsletterOrgs"];
      for (const project of E2E_PROJECTS) {
        const ownerEmail = E2E_NEWSLETTERS_OWNER_EMAILS[project];
        const memberEmail = E2E_NEWSLETTERS_MEMBER_EMAILS[project];
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
        const ids = newsletterIds[project];
        newsletterOrgs[project] = {
          orgId: ids.orgId,
          owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
          member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
          mailbox: { id: ids.mailboxId, address: e2eNewslettersMailbox(project) },
        };
      }

      const suggestionOrgs = {} as SeedFile["suggestionOrgs"];
      for (const project of E2E_PROJECTS) {
        const ownerEmail = E2E_SUGGESTIONS_OWNER_EMAILS[project];
        const memberEmail = E2E_SUGGESTIONS_MEMBER_EMAILS[project];
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
        const ids = suggestionIds[project];
        suggestionOrgs[project] = {
          orgId: ids.orgId,
          owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
          member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
          mailbox: { id: ids.mailboxId, address: e2eSuggestionsMailbox(project) },
        };
      }

      const reviewOrgs = {} as SeedFile["reviewOrgs"];
      for (const project of E2E_PROJECTS) {
        const ownerEmail = E2E_REVIEW_OWNER_EMAILS[project];
        const memberEmail = E2E_REVIEW_MEMBER_EMAILS[project];
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
        const ids = reviewIds[project];
        reviewOrgs[project] = {
          orgId: ids.orgId,
          owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
          member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
          mailbox: { id: ids.mailboxId, address: e2eReviewMailbox(project) },
        };
      }

      const loopsOrgs = {} as SeedFile["loopsOrgs"];
      for (const project of E2E_PROJECTS) {
        const ownerEmail = E2E_LOOPS_OWNER_EMAILS[project];
        const memberEmail = E2E_LOOPS_MEMBER_EMAILS[project];
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(ownerEmail)).pathname.split("/").pop() ?? "");
        await setPassword(E2E_MEMBER_PASSWORD, new URL(await requestLink(memberEmail)).pathname.split("/").pop() ?? "");
        const ids = loopsIds[project];
        loopsOrgs[project] = {
          orgId: ids.orgId,
          owner: { userId: ids.ownerId, email: ownerEmail, password: E2E_MEMBER_PASSWORD },
          member: { userId: ids.memberId, email: memberEmail, password: E2E_MEMBER_PASSWORD },
          mailboxId: ids.mailboxId,
        };
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

      const twoFactorOwners = {} as SeedFile["twoFactorOwners"];
      for (const project of E2E_PROJECTS) {
        const email = E2E_TWO_FACTOR_EMAILS[project];
        const twoFactorToken = new URL(await requestLink(email)).pathname.split("/").pop() ?? "";
        await setPassword(E2E_MEMBER_PASSWORD, twoFactorToken);
        twoFactorOwners[project] = { ...twoFactorIds[project], email, password: E2E_MEMBER_PASSWORD };
      }

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
