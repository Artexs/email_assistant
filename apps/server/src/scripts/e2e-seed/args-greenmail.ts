import { e2eApprovalsMailbox } from "./args-approvals";
import type { E2eProject } from "./args-core";
import { e2eDelegatesMailbox, e2eDelegationsMailbox } from "./args-delegations";
import { e2eLoopsMailbox } from "./args-loops";
import { e2eNewslettersMailbox } from "./args-newsletters";
import { e2eOpenLoopsMailbox } from "./args-open-loops";
import { e2eReplyPanelMailbox } from "./args-reply-panel";
import { e2eReplyStyleMailbox } from "./args-reply-style";
import { e2eReviewMailbox } from "./args-review";
import { e2eSuggestionsMailbox } from "./args-suggestions";
import { E2E_REPORT_KINDS, e2eReportMailbox, e2eTrustMailbox } from "./args-trust";
import { e2eUrgencyMailbox } from "./args-urgency";

// Every function that returns an address the seed connects to the GreenMail (each one reaches `seedAssistMailbox`). The unit test walks
// this list and checks it against the calls in `e2e-seed.ts`.
export const E2E_GREENMAIL_MAILBOXES: Record<string, (project: E2eProject) => string[]> = {
  e2eApprovalsMailbox: (project) => [e2eApprovalsMailbox(project)],
  e2eDelegationsMailbox: (project) => [e2eDelegationsMailbox(project)],
  e2eDelegatesMailbox: (project) => [e2eDelegatesMailbox(project)],
  e2eOpenLoopsMailbox: (project) => [e2eOpenLoopsMailbox(project)],
  e2eUrgencyMailbox: (project) => [e2eUrgencyMailbox(project, "seeded"), e2eUrgencyMailbox(project, "empty")],
  e2eTrustMailbox: (project) => [e2eTrustMailbox(project)],
  e2eReportMailbox: (project) => E2E_REPORT_KINDS.map((kind) => e2eReportMailbox(project, kind)),
  e2eReviewMailbox: (project) => [e2eReviewMailbox(project)],
  e2eNewslettersMailbox: (project) => [e2eNewslettersMailbox(project)],
  e2eSuggestionsMailbox: (project) => [e2eSuggestionsMailbox(project)],
  e2eLoopsMailbox: (project) => [e2eLoopsMailbox(project)],
  e2eReplyStyleMailbox: (project) => [e2eReplyStyleMailbox(project, "box"), e2eReplyStyleMailbox(project, "oauth")],
  e2eReplyPanelMailbox: (project) => [e2eReplyPanelMailbox(project)],
};
