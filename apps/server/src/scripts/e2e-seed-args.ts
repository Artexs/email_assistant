import { parseArgs } from "node:util";

import type { CliDescription } from "@ea/core";

export const cliDescriptions = [
  {
    name: "e2e:seed",
    summary: "Wipes the e2e database and seeds the organizations and users of the Playwright suites.",
    risk: "dev",
    needs: ["db"],
    usage: [
      "bun run e2e:seed",
      "  Takes no arguments. Reads DATABASE_URL and MIGRATOR_DATABASE_URL: both must name an e2e database (the name ends in _e2e).",
      "  Writes apps/web/e2e/.seed.json for the specs.",
    ].join("\n"),
    exits: { 1: 'failed, or refused: "DATABASE_URL is not an e2e database"' },
  },
] satisfies readonly CliDescription[];

// The seed takes no argument: any flag or word is a usage error (`parseArgs` throws, `runCli` maps it to exit 2).
export function parseE2eSeedArgs(argv: string[]): void {
  parseArgs({ args: argv, options: {}, allowPositionals: false, strict: true });
}

export {
  E2E_ASSISTANT_EMAILS,
  E2E_DELETE_ASSISTANT_EMAILS,
  E2E_DELETE_OWNER_EMAILS,
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
  E2E_TRIAL_ORG_NAME,
  E2E_TRIAL_OWNER_EMAIL,
  E2E_TWO_FACTOR_EMAILS,
  assertTaggedMailbox,
  e2eDeleteMailbox,
  e2eDeleteOrgName,
  e2eTermsOrgName,
  e2eTwoFactorOrgName,
  greenMailAddress,
  mailTagFromEnv,
  taggedAddress,
  type E2eProject,
} from "./e2e-seed/args-core";
export {
  E2E_APPROVALS,
  E2E_APPROVALS_COUNT,
  E2E_APPROVALS_MEMBER_EMAILS,
  E2E_APPROVALS_OWNER_EMAILS,
  E2E_APPROVALS_WAITING,
  E2E_SEND_TEST_ADDRESS,
  e2eApprovalsMailbox,
  e2eApprovalsOrgName,
} from "./e2e-seed/args-approvals";
export {
  E2E_DELEGATES_ANNA,
  E2E_DELEGATES_MEMBER_EMAILS,
  E2E_DELEGATES_OWNER_EMAILS,
  e2eDelegatesOrgName,
} from "./e2e-seed/args-delegates";
export {
  E2E_DELEGATIONS,
  E2E_DELEGATIONS_MEMBER_EMAILS,
  E2E_DELEGATIONS_OWNER_EMAILS,
  e2eDelegatesMailbox,
  e2eDelegationsMailbox,
  e2eDelegationsOrgName,
  type DelegationsSeedIds,
} from "./e2e-seed/args-delegations";
export {
  E2E_OPEN_LOOPS,
  E2E_OPEN_LOOPS_DELEGATE,
  E2E_OPEN_LOOPS_DELEGATIONS,
  E2E_OPEN_LOOPS_MEMBER_EMAILS,
  E2E_OPEN_LOOPS_OWNER_EMAILS,
  e2eOpenLoopsMailbox,
  e2eOpenLoopsOrgName,
  type E2eLoopPlan,
  type OpenLoopsSeedIds,
} from "./e2e-seed/args-open-loops";
export {
  E2E_TIMEZONE,
  E2E_URGENCY_MEMBER_EMAILS,
  E2E_URGENCY_OWNER_EMAILS,
  E2E_URGENCY_SEEDED,
  e2eUrgencyMailbox,
  e2eUrgencyOrgName,
  e2eUrgencyProfile,
} from "./e2e-seed/args-urgency";
export { E2E_GATE_FIXTURE_DIR, E2E_LLM_PIN } from "./e2e-seed/args-llm-pin";
export {
  E2E_REPORT_KINDS,
  E2E_TRUST_MEMBER_EMAILS,
  E2E_TRUST_OWNER_EMAILS,
  e2eReportMailbox,
  e2eTrustMailbox,
  e2eTrustOrgName,
  type E2eReportKind,
} from "./e2e-seed/args-trust";
export {
  E2E_REVIEW_MAIL_COUNT,
  E2E_REVIEW_MEMBER_EMAILS,
  E2E_REVIEW_OWNER_EMAILS,
  E2E_REVIEW_SUMMARY,
  e2eReviewMailbox,
  e2eReviewOrgName,
  e2eReviewSender,
  e2eReviewSubject,
} from "./e2e-seed/args-review";
export {
  E2E_AUTHSERV_ID,
  E2E_NEWSLETTERS_MEMBER_EMAILS,
  E2E_NEWSLETTERS_OWNER_EMAILS,
  E2E_NEWSLETTER_LINK,
  E2E_NEWSLETTER_SENDERS,
  e2eNewslettersMailbox,
  e2eNewslettersOrgName,
} from "./e2e-seed/args-newsletters";
export {
  E2E_SUGGESTIONS,
  E2E_SUGGESTIONS_MEMBER_EMAILS,
  E2E_SUGGESTIONS_OWNER_EMAILS,
  e2eSuggestionsMailbox,
  e2eSuggestionsOrgName,
} from "./e2e-seed/args-suggestions";
export {
  ACTIVITY_FILLERS,
  ACTIVITY_SUBJECTS,
  E2E_ACTIVITY_MEMBER_EMAILS,
  activityFillerSubject,
} from "./e2e-seed/args-activity";
export {
  E2E_LOOPS_CHAT_IDS,
  E2E_LOOPS_MEMBER_EMAILS,
  E2E_LOOPS_OLD_CONSENT,
  E2E_LOOPS_OWNER_EMAILS,
  E2E_LOOPS_SUBJECTS,
  e2eLoopsMailbox,
  e2eLoopsOrgName,
} from "./e2e-seed/args-loops";
export {
  E2E_REPLY_STYLE_MEMBER_EMAILS,
  E2E_REPLY_STYLE_OWNER_EMAILS,
  e2eReplyStyleMailbox,
  e2eReplyStyleOrgName,
} from "./e2e-seed/args-reply-style";
export {
  E2E_REPLY_PANEL,
  E2E_REPLY_PANEL_MEMBER_EMAILS,
  E2E_REPLY_PANEL_OWNER_EMAILS,
  e2eReplyPanelMailbox,
  e2eReplyPanelOrgName,
} from "./e2e-seed/args-reply-panel";
export { E2E_GREENMAIL_MAILBOXES } from "./e2e-seed/args-greenmail";
export { seedFilePath, type SeedFile } from "./e2e-seed/args-seed-file";
export { databaseNameOf, isE2eDatabaseName, seedTargetOk } from "./e2e-seed/args-seed-target";
