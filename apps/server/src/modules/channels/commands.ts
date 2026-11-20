import {
  ANSWERED_CHECK_LIMIT,
  minimalDigestMessage,
  minimalReviewMessage,
  renderReviewPage,
  textsFor,
  withAnsweredCheck,
  type NoticeDetail,
  type OutMessage,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import type { ActionsScope, DelegationHooks, SendScope } from "../actions";
import { listMailboxes, type TestMailRule } from "../mail";
import { buildDigest, digestPeriodStart } from "../reports";
import { getOrganization, isFeatureOn, isOrgSuspended } from "../tenancy";
import { ANSWERED_CHECK_WINDOW_MS, listAnsweredCandidates, listForReview } from "../triage";

import { handleCallback, type CallbackDeps } from "./callbacks";
import { telegramDetailOf } from "./commands-shared";
import { statusMessage } from "./commands-status";
import { pauseMailboxes, resumeMailboxes } from "./commands-switch";
import { replyConsentOf } from "./consent";
import type { CommandName, LinkedChat, UpdateHandlers } from "./port";
import { handleReplyText } from "./reply-redraft";

export { telegramDetailOf } from "./commands-shared";
export { statusMessage } from "./commands-status";
export { pauseMailboxes, resumeMailboxes } from "./commands-switch";

export interface CommandDeps {
  db: Db | Transaction<DB>;
  now(): Date;
  llmDailyCap: number;
  triageScope: "off" | "synthetic" | "all";
  actionsScope: ActionsScope;
  llm: { provider: string; classifierModel: string };
  hooks: DelegationHooks;
  uidplus(ctx: TenantContext, mailboxId: string): Promise<boolean>;
  sendScope: SendScope;
  // The test-sender rule: /review lists real mail only.
  testMail: TestMailRule;
  // Public contact address for the paused answer. null = "the operator".
  operatorContact: string | null;
  // Minutes between two mail syncs (MAIL_SYNC_EVERY_MIN), for the /resume text.
  syncEveryMin: number;
  // The base URL of the panel (`WEB_BASE_URL`): the picker of the Delegate button links to the delegates page, and the
  // spam review line of /digest links to the Activity list. Unset: no link, the panel text.
  webBaseUrl?: string;
  // The detail level of the chat of a link: `full` (today) or `minimal` (counts and panel links, no mail text, no address). Absent
  // reads `telegramDetailOf`; a test passes a fake level.
  detailOf?(link: LinkedChat): Promise<NoticeDetail>;
}

const log = createLog("channels");

export function helpMessage(link: LinkedChat): OutMessage {
  return { text: textsFor(link.locale).bot.help, buttons: [] };
}

// The period does not move: no `digests` row and no outbox row; the router sends the reply at once.
export async function digestNowMessage(deps: CommandDeps, link: LinkedChat): Promise<OutMessage> {
  const now = deps.now();
  const ctx = { orgId: link.orgId, userId: link.userId };
  const periodStart = await digestPeriodStart(deps.db, ctx, { userId: link.userId, linkedAt: link.linkedAt }, now);
  const built = await buildDigest(deps.db, ctx, {
    kind: "on_demand",
    periodStart,
    periodEnd: now,
    slot: null,
    now,
    locale: link.locale,
    role: link.role,
    testMail: deps.testMail,
    ...(deps.webBaseUrl === undefined ? {} : { panelBase: deps.webBaseUrl }),
    ...(link.role === "owner" && (await replyConsentOf(deps.db, ctx, [link.userId])).has(link.userId)
      ? { replyDrafts: true }
      : {}),
  });
  // `minimal`: counts, the clock and the link to the panel, no keyboard.
  if ((await telegramDetailOf(deps, link)) === "minimal") {
    return minimalDigestMessage(built.minimal, {
      channel: "telegram",
      detail: "minimal",
      locale: link.locale,
      webBaseUrl: deps.webBaseUrl,
    });
  }
  return built.message;
}

// The /review page: behind the flag `review_command`; a seeded random sample of unlabelled real mail.
// A new seed per call (chat id and time) gives a new sample on the next /review.
export async function reviewMessage(deps: CommandDeps, link: LinkedChat): Promise<OutMessage> {
  const texts = textsFor(link.locale);
  const ctx = { orgId: link.orgId, userId: link.userId };
  if (!(await isFeatureOn(deps.db, ctx, "review_command"))) return { text: texts.review.off, buttons: [] };
  // `minimal`: the review lives in the panel; no mail, no summary.
  if ((await telegramDetailOf(deps, link)) === "minimal") {
    return minimalReviewMessage({ locale: link.locale, webBaseUrl: deps.webBaseUrl });
  }
  const organization = await getOrganization(deps.db, ctx);
  if (organization === undefined) throw new HardError("organization not found");
  const mailboxIds = (await listMailboxes(deps.db, ctx)).map((mailbox) => mailbox.id);
  if (mailboxIds.length === 0) return { text: texts.review.noMailbox, buttons: [] };
  const now = deps.now();
  const seed = `${link.chatId}:${now.toISOString()}`;
  const items = await listForReview(deps.db, ctx, { mailboxIds, now, seed, testMail: deps.testMail });
  const page = renderReviewPage(
    {
      items: items.map((item) => ({
        emailId: item.emailId,
        category: item.category,
        from: item.from,
        subject: item.subject,
        receivedAt: item.receivedAt,
        aiText: item.summary,
      })),
      now,
      timeZone: organization.timezone,
    },
    texts
  );
  if (!(await isFeatureOn(deps.db, ctx, "answered_check"))) return page;
  const answered = await listAnsweredCandidates(deps.db, ctx, {
    mailboxIds,
    since: new Date(now.getTime() - ANSWERED_CHECK_WINDOW_MS),
    limit: ANSWERED_CHECK_LIMIT,
    testMail: deps.testMail,
  });
  return withAnsweredCheck(page, answered, { now, timeZone: organization.timezone }, texts);
}

export function runCommand(deps: CommandDeps, link: LinkedChat, name: CommandName): Promise<OutMessage> {
  switch (name) {
    case "help":
      return Promise.resolve(helpMessage(link));
    case "status":
      return statusMessage(deps, link);
    case "digest":
      return digestNowMessage(deps, link);
    case "review":
      return reviewMessage(deps, link);
    case "pause":
      return pauseMailboxes(deps, link);
    case "resume":
      return resumeMailboxes(deps, link);
  }
}

function callbackDepsOf(deps: CommandDeps): CallbackDeps {
  return {
    db: deps.db,
    now: deps.now,
    actionsScope: deps.actionsScope,
    hooks: deps.hooks,
    uidplus: deps.uidplus,
    sendScope: deps.sendScope,
    ...(deps.webBaseUrl === undefined ? {} : { webBaseUrl: deps.webBaseUrl }),
  };
}

export function createUpdateHandlers(deps: CommandDeps): UpdateHandlers {
  return {
    command: async (link, name) => {
      if (name !== "help" && (await isOrgSuspended(deps.db, { orgId: link.orgId }))) {
        log.info("command_refused_suspended", { org_id: link.orgId, command: name });
        return { text: textsFor(link.locale).bot.accountPaused(deps.operatorContact), buttons: [] };
      }
      return runCommand(deps, link, name);
    },
    callback: async (link, data, source) => {
      if (await isOrgSuspended(deps.db, { orgId: link.orgId })) {
        log.info("tap_refused_suspended", { org_id: link.orgId });
        return { answer: textsFor(link.locale).bot.accountPaused(deps.operatorContact) };
      }
      return handleCallback(callbackDepsOf(deps), link, data, source);
    },
    text: async (link, text, replyToMessageId) => {
      if (await isOrgSuspended(deps.db, { orgId: link.orgId })) {
        log.info("tap_refused_suspended", { org_id: link.orgId });
        return { text: textsFor(link.locale).bot.accountPaused(deps.operatorContact), buttons: [] };
      }
      return handleReplyText(callbackDepsOf(deps), link, text, replyToMessageId);
    },
  };
}
