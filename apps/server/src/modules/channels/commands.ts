import {
  ANSWERED_CHECK_LIMIT,
  cutText,
  formatClock,
  formatDay,
  llmPauseLine,
  localDateTime,
  localToInstant,
  nextDigestTime,
  parseDigestTimes,
  QUIET_HOURS,
  QUOTA_TIMEZONE,
  quotaDayStart,
  renderReviewPage,
  textsFor,
  withAnsweredCheck,
  type CoreTexts,
  type OutMessage,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import {
  countActionsSince,
  countApprovals,
  sendFilterFor,
  type ActionsScope,
  type DelegationHooks,
  type SendScope,
} from "../actions";
import { countLlmCallsSince } from "../audit";
import { getMailboxSettings } from "../config";
import { countOpenDelegations } from "../delegation";
import { countWaiting, listMailboxes, switchMailboxStatus, type MailboxSummary, type TestMailRule } from "../mail";
import { buildDigestMessage, digestPeriodStart, llmPauseToShow, WAITING_WINDOW_MS } from "../reports";
import { getMembership, getOrganization, isFeatureOn, isOrgSuspended } from "../tenancy";
import { ANSWERED_CHECK_WINDOW_MS, listAnsweredCandidates, listForReview } from "../triage";

import { handleCallback } from "./callbacks";
import { SYNC_LATE_MS } from "./notices";
import type { CommandName, LinkedChat, UpdateHandlers } from "./port";

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
  // The test-sender rule: /review lists real mail only (F097 D1).
  testMail: TestMailRule;
  // Public contact address for the paused answer. null = "the operator".
  operatorContact: string | null;
  // Minutes between two mail syncs (MAIL_SYNC_EVERY_MIN), for the /resume text.
  syncEveryMin: number;
}

const log = createLog("channels");

const ADDRESS_MAX = 60;

const ACTIONS_WINDOW_MS = 24 * 3_600_000;

export function helpMessage(link: LinkedChat): OutMessage {
  return { text: textsFor(link.locale).bot.help, buttons: [] };
}

export async function statusMessage(deps: CommandDeps, link: LinkedChat): Promise<OutMessage> {
  const { db, llmDailyCap } = deps;
  const texts = textsFor(link.locale);
  const t = texts.bot.status;
  const now = deps.now();
  const ctx = { orgId: link.orgId, userId: link.userId };
  const organization = await getOrganization(db, ctx);
  if (organization === undefined) throw new HardError("organization not found");
  const timeZone = organization.timezone;
  const clock = (at: Date): string => formatClock(at, timeZone, now, texts.locale);

  const dayStart = quotaDayStart(now, QUOTA_TIMEZONE);
  const lines = [t.title(formatDay(now, timeZone, texts.locale), localDateTime(now, timeZone).time)];

  const mailboxes = await listMailboxes(db, ctx);
  if (mailboxes.length === 0) lines.push(t.noMailbox);
  for (const mailbox of mailboxes) {
    const settings = await getMailboxSettings(db, ctx, mailbox.id);
    const calls = await countLlmCallsSince(db, ctx, mailbox.id, dayStart);
    const mode =
      settings === undefined
        ? t.modeNone
        : settings.mode === "shadow" || settings.mode === "assist"
          ? t.modes[settings.mode]
          : settings.mode;
    const sync = mailbox.last_synced_at;
    const late = sync !== null && now.getTime() - sync.getTime() > SYNC_LATE_MS;
    lines.push(
      `📮 ${cutText(mailbox.address, ADDRESS_MAX)}`,
      t.mailboxLine(mode, statusText(mailbox, clock, texts)),
      t.lastSync(sync === null ? null : clock(sync), late),
      t.llmCalls(clock(dayStart), calls, llmDailyCap)
    );
  }

  const waiting = await countWaiting(db, ctx, { receivedSince: new Date(now.getTime() - WAITING_WINDOW_MS) });
  lines.push(t.waiting(waiting), t.triage(deps.triageScope));
  const actions = await countActionsSince(db, ctx, { since: new Date(now.getTime() - ACTIONS_WINDOW_MS) });
  lines.push(t.actions(deps.actionsScope.kind, actions));
  lines.push(...(await approvalLines(deps, ctx, mailboxes, texts, clock)));
  lines.push(t.send(deps.sendScope.kind));
  const delegations = await countOpenDelegations(db, ctx);
  lines.push(t.delegations(delegations.open, delegations.overdue));
  lines.push(t.llm(deps.llm.provider, deps.llm.classifierModel));
  const llmPause = await llmPauseToShow(db, ctx, now);
  if (llmPause !== null) lines.push(llmPauseLine(llmPause, timeZone, now, texts));

  const member = await getMembership(db, ctx, link.userId);
  const times = parseDigestTimes(member?.digest_times ?? []);
  const next = nextDigestTime({ now, timeZone, times });
  lines.push(
    next === null ? t.noDigestTimes : t.nextDigest(clock(localToInstant(next.date, next.time, timeZone))),
    t.quietHours(QUIET_HOURS.start, QUIET_HOURS.end)
  );
  return { text: lines.join("\n"), buttons: [] };
}

// The cause of an approved send that waits, in the order of the tap toast (S4 16.1): the mailbox, then the scope.
// `held` sends are not admitted by the scope; `sending` sends are admitted and go out on a tick.
function approvedText(
  deps: CommandDeps,
  mailbox: MailboxSummary | undefined,
  count: { held: number; sending: number },
  t: CoreTexts["bot"]["status"]
): string {
  const total = count.held + count.sending;
  switch (mailbox?.status) {
    case "paused":
      return t.approvedPaused(total);
    case "auth_error":
      return t.approvedAuthError(total);
    case "host_blocked":
      return t.approvedHostBlocked(total);
    case "active":
    case undefined:
      break;
  }
  if (count.held > 0) return t.approvedHeld(count.held, deps.sendScope.kind);
  return t.approvedSending(count.sending);
}

// One line for the organization; one line per mailbox when it has more than one.
async function approvalLines(
  deps: CommandDeps,
  ctx: TenantContext,
  mailboxes: MailboxSummary[],
  texts: CoreTexts,
  clock: (at: Date) => string
): Promise<string[]> {
  const t = texts.bot.status;
  const line = (prefix: string, count: Awaited<ReturnType<typeof countApprovals>>, mailbox?: MailboxSummary) => {
    const approved = count.approvedHeld + count.approvedSending;
    return t.approvalsLine(prefix, count.waiting, {
      oldest: count.oldestNotifiedAt === null ? null : clock(count.oldestNotifiedAt),
      held:
        approved > 0
          ? approvedText(deps, mailbox, { held: count.approvedHeld, sending: count.approvedSending }, t)
          : null,
    });
  };
  if (mailboxes.length <= 1) {
    const mailbox = mailboxes[0];
    const send = mailbox === undefined ? { kind: "none" as const } : sendFilterFor(deps.sendScope);
    return [line(t.approvals, await countApprovals(deps.db, ctx, { send }), mailbox)];
  }
  const lines: string[] = [];
  for (const mailbox of mailboxes) {
    const send = sendFilterFor(deps.sendScope);
    const count = await countApprovals(deps.db, ctx, { send, mailboxId: mailbox.id });
    lines.push(line(t.approvalsOf(cutText(mailbox.address, ADDRESS_MAX)), count, mailbox));
  }
  return lines;
}

function statusText(mailbox: MailboxSummary, clock: (at: Date) => string, texts: CoreTexts): string {
  const t = texts.bot.status;
  const since = clock(mailbox.status_changed_at);
  switch (mailbox.status) {
    case "active":
      return t.stateActive;
    case "paused":
      return t.statePaused(since);
    case "auth_error":
      return t.stateAuthError(since);
    case "host_blocked":
      return t.stateHostBlocked(since);
  }
}

// The period does not move: no `digests` row and no outbox row; the router sends the reply at once.
export async function digestNowMessage(deps: CommandDeps, link: LinkedChat): Promise<OutMessage> {
  const now = deps.now();
  const ctx = { orgId: link.orgId, userId: link.userId };
  const periodStart = await digestPeriodStart(deps.db, ctx, { userId: link.userId, linkedAt: link.linkedAt }, now);
  return buildDigestMessage(deps.db, ctx, {
    kind: "on_demand",
    periodStart,
    periodEnd: now,
    slot: null,
    now,
    locale: link.locale,
    testMail: deps.testMail,
  });
}

// The /review page (F097 D4, D6): behind the flag `review_command`; a seeded random sample of unlabelled real mail.
// A new seed per call (chat id and time) gives a new sample on the next /review.
export async function reviewMessage(deps: CommandDeps, link: LinkedChat): Promise<OutMessage> {
  const texts = textsFor(link.locale);
  const ctx = { orgId: link.orgId, userId: link.userId };
  if (!(await isFeatureOn(deps.db, ctx, "review_command"))) return { text: texts.review.off, buttons: [] };
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

interface StatusSwitch {
  to: "active" | "paused";
}

// `switchMailboxStatus` does one transaction per mailbox: the conditional update and its audit row.
async function switchMailboxes(deps: CommandDeps, link: LinkedChat, change: StatusSwitch): Promise<OutMessage> {
  const texts = textsFor(link.locale).bot.switch;
  if (link.role !== "owner") return { text: texts.ownerOnly, buttons: [] };
  const now = deps.now();
  const ctx = { orgId: link.orgId, userId: link.userId };
  const changed: string[] = [];
  const extra: string[] = [];
  for (const mailbox of await listMailboxes(deps.db, ctx)) {
    const address = cutText(mailbox.address, ADDRESS_MAX);
    const skip = skipText(mailbox.status, address, texts);
    if (skip !== null) {
      extra.push(skip);
      continue;
    }
    const result = await switchMailboxStatus(deps.db, ctx, mailbox.id, {
      to: change.to,
      actor: link.userId,
      via: "telegram",
      now,
    });
    if (result.kind === "changed") changed.push(address);
    else if (result.kind === "already")
      extra.push(change.to === "paused" ? texts.alreadyPaused(address) : texts.alreadyActive(address));
    else if (result.kind === "auth_error") extra.push(texts.loginError(address));
    else if (result.kind === "host_blocked") extra.push(texts.hostBlocked(address));
  }
  return {
    text: [...changeLines(change.to, changed, texts, deps.syncEveryMin), ...extra].join("\n") || texts.noMailbox,
    buttons: [],
  };
}

// A mailbox in a state that only the system leaves is not paused or resumed: its own line says why.
function skipText(status: MailboxSummary["status"], address: string, texts: CoreTexts["bot"]["switch"]): string | null {
  switch (status) {
    case "auth_error":
      return texts.loginError(address);
    case "host_blocked":
      return texts.hostBlocked(address);
    case "active":
    case "paused":
      return null;
  }
}

function changeLines(
  to: "active" | "paused",
  changed: string[],
  texts: CoreTexts["bot"]["switch"],
  syncEveryMin: number
): string[] {
  if (changed.length === 0) return [];
  const list = changed.join(", ");
  return to === "paused"
    ? [texts.pausedHeader(list), texts.pausedExplain, texts.pausedResume]
    : [texts.resumedHeader(list), texts.resumedExplain(syncEveryMin)];
}

export function pauseMailboxes(deps: CommandDeps, link: LinkedChat): Promise<OutMessage> {
  return switchMailboxes(deps, link, {
    to: "paused",
  });
}

export function resumeMailboxes(deps: CommandDeps, link: LinkedChat): Promise<OutMessage> {
  return switchMailboxes(deps, link, {
    to: "active",
  });
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

export function createUpdateHandlers(deps: CommandDeps): UpdateHandlers {
  return {
    command: async (link, name) => {
      if (name !== "help" && (await isOrgSuspended(deps.db, { orgId: link.orgId }))) {
        log.info(`telegram: org ${link.orgId} suspended: ${name} refused`);
        return { text: textsFor(link.locale).bot.accountPaused(deps.operatorContact), buttons: [] };
      }
      return runCommand(deps, link, name);
    },
    callback: async (link, data) => {
      if (await isOrgSuspended(deps.db, { orgId: link.orgId })) {
        log.info(`telegram: org ${link.orgId} suspended: tap refused`);
        return { answer: textsFor(link.locale).bot.accountPaused(deps.operatorContact) };
      }
      return handleCallback(
        {
          db: deps.db,
          now: deps.now,
          actionsScope: deps.actionsScope,
          hooks: deps.hooks,
          uidplus: deps.uidplus,
          sendScope: deps.sendScope,
        },
        link,
        data
      );
    },
  };
}
