import {
  cutText,
  formatClock,
  formatDay,
  localDateTime,
  localToInstant,
  nextDigestTime,
  parseDigestTimes,
  QUIET_HOURS,
  QUOTA_TIMEZONE,
  quotaDayStart,
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
import { countWaiting, listMailboxes, switchMailboxStatus, type MailboxSummary } from "../mail";
import { buildDigestMessage, digestPeriodStart, WAITING_WINDOW_MS } from "../reports";
import { getMembership, getOrganization, isOrgSuspended } from "../tenancy";

import { handleCallback } from "./callbacks";
import { SYNC_LATE_MS } from "./notices";
import type { CommandName, LinkedChat, UpdateHandlers } from "./port";
import { accountPausedText, helpText } from "./texts";

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
  // Public contact address for the paused answer. null = "the operator".
  operatorContact: string | null;
}

const log = createLog("channels");

const ADDRESS_MAX = 60;

const SCOPE_TEXTS: Record<CommandDeps["triageScope"], string> = {
  off: "off",
  synthetic: "test mail only (TRIAGE_LLM_SCOPE=synthetic)",
  all: "real mail of every active mailbox (TRIAGE_LLM_SCOPE=all)",
};

const ACTIONS_SCOPE_TEXTS: Record<ActionsScope["kind"], string> = {
  off: "off",
  synthetic: "test mail only (ACTIONS_SCOPE=synthetic)",
  all: "real mail, by the mode of each mailbox (ACTIONS_SCOPE=all)",
};

const SEND_SCOPE_TEXTS: Record<SendScope["kind"], string> = {
  off: "off",
  self: "only to your test addresses (SEND_SCOPE=self)",
  all: "real recipients, after an owner's tap (SEND_SCOPE=all)",
};

const ACTIONS_WINDOW_MS = 24 * 3_600_000;

export function helpMessage(): OutMessage {
  return { text: helpText(), buttons: [] };
}

export async function statusMessage(deps: CommandDeps, link: LinkedChat): Promise<OutMessage> {
  const { db, llmDailyCap } = deps;
  const now = deps.now();
  const ctx = { orgId: link.orgId, userId: link.userId };
  const organization = await getOrganization(db, ctx);
  if (organization === undefined) throw new HardError("organization not found");
  const timeZone = organization.timezone;
  const clock = (at: Date): string => formatClock(at, timeZone, now);

  const dayStart = quotaDayStart(now, QUOTA_TIMEZONE);
  const lines = [`📊 Status · ${formatDay(now, timeZone)} ${localDateTime(now, timeZone).time}`];

  const mailboxes = await listMailboxes(db, ctx);
  if (mailboxes.length === 0) lines.push("No mailbox connected.");
  for (const mailbox of mailboxes) {
    const settings = await getMailboxSettings(db, ctx, mailbox.id);
    const calls = await countLlmCallsSince(db, ctx, mailbox.id, dayStart);
    const mode = settings === undefined ? "none (no settings row: not triaged)" : settings.mode;
    const sync = mailbox.last_synced_at;
    const late = sync !== null && now.getTime() - sync.getTime() > SYNC_LATE_MS;
    lines.push(
      `📮 ${cutText(mailbox.address, ADDRESS_MAX)}`,
      `Mode: ${mode} · Status: ${statusText(mailbox, clock)}`,
      `Last sync: ${sync === null ? "never" : `${clock(sync)}${late ? " (late)" : ""}`}`,
      `LLM calls since ${clock(dayStart)}: ${calls} of ${llmDailyCap}`
    );
  }

  const waiting = await countWaiting(db, ctx, { receivedSince: new Date(now.getTime() - WAITING_WINDOW_MS) });
  lines.push(`Waiting for triage: ${waiting}`, `Triage: ${SCOPE_TEXTS[deps.triageScope]}`);
  const actions = await countActionsSince(db, ctx, { since: new Date(now.getTime() - ACTIONS_WINDOW_MS) });
  lines.push(
    `Actions: ${ACTIONS_SCOPE_TEXTS[deps.actionsScope.kind]} · last 24 h: applied ${actions.applied}, undone ${actions.undone}, failed ${actions.failed}`
  );
  lines.push(...(await approvalLines(deps, ctx, mailboxes, now, clock)));
  lines.push(`Send: ${SEND_SCOPE_TEXTS[deps.sendScope.kind]}`);
  const delegations = await countOpenDelegations(db, ctx);
  lines.push(`Delegations: ${delegations.open} waiting for a reply, ${delegations.overdue} overdue`);
  lines.push(`LLM: ${deps.llm.provider} · ${deps.llm.classifierModel}`);

  const member = await getMembership(db, ctx, link.userId);
  const times = parseDigestTimes(member?.digest_times ?? []);
  const next = nextDigestTime({ now, timeZone, times });
  lines.push(
    next === null
      ? "No digest times set (bun run digest:times)"
      : `Next digest: ${clock(localToInstant(next.date, next.time, timeZone))}`,
    `Quiet hours: ${QUIET_HOURS.start}–${QUIET_HOURS.end} (notices wait until ${QUIET_HOURS.end})`
  );
  return { text: lines.join("\n"), buttons: [] };
}

// The cause of an approved send that waits, in the order of the tap toast (S4 16.1): the mailbox, then the scope.
// `held` sends are not admitted by the scope; `sending` sends are admitted and go out on a tick.
function approvedText(
  deps: CommandDeps,
  mailbox: MailboxSummary | undefined,
  count: { held: number; sending: number }
): string {
  const total = count.held + count.sending;
  if (mailbox?.status === "paused") return `${total} approved, held: the mailbox is paused`;
  if (mailbox?.status === "auth_error") return `${total} approved, held: the mailbox login fails`;
  if (count.held > 0) return `${count.held} approved, held by SEND_SCOPE=${deps.sendScope.kind}`;
  return `${count.sending} approved, sending`;
}

// One line for the organization; one line per mailbox when it has more than one.
async function approvalLines(
  deps: CommandDeps,
  ctx: TenantContext,
  mailboxes: MailboxSummary[],
  now: Date,
  clock: (at: Date) => string
): Promise<string[]> {
  const line = (prefix: string, count: Awaited<ReturnType<typeof countApprovals>>, mailbox?: MailboxSummary) => {
    const oldest = count.oldestNotifiedAt === null ? "" : ` (oldest ${clock(count.oldestNotifiedAt)})`;
    const approved = count.approvedHeld + count.approvedSending;
    const held =
      approved > 0
        ? ` · ${approvedText(deps, mailbox, { held: count.approvedHeld, sending: count.approvedSending })}`
        : "";
    return `${prefix}: ${count.waiting} waiting for your tap${oldest}${held}`;
  };
  if (mailboxes.length <= 1) {
    const mailbox = mailboxes[0];
    const send = mailbox === undefined ? { kind: "none" as const } : sendFilterFor(deps.sendScope);
    return [line("Approvals", await countApprovals(deps.db, ctx, { send }), mailbox)];
  }
  const lines: string[] = [];
  for (const mailbox of mailboxes) {
    const send = sendFilterFor(deps.sendScope);
    const count = await countApprovals(deps.db, ctx, { send, mailboxId: mailbox.id });
    lines.push(line(`Approvals ${cutText(mailbox.address, ADDRESS_MAX)}`, count, mailbox));
  }
  return lines;
}

function statusText(mailbox: MailboxSummary, clock: (at: Date) => string): string {
  const since = clock(mailbox.status_changed_at);
  if (mailbox.status === "paused") return `paused since ${since}`;
  if (mailbox.status === "auth_error") return `login error since ${since} (run mailbox:password)`;
  return "active";
}

// The period does not move: no `digests` row and no outbox row; the router sends the reply at once.
export async function digestNowMessage(deps: CommandDeps, link: LinkedChat): Promise<OutMessage> {
  const now = deps.now();
  const ctx = { orgId: link.orgId, userId: link.userId };
  const periodStart = await digestPeriodStart(deps.db, ctx, { userId: link.userId, linkedAt: link.linkedAt }, now);
  return buildDigestMessage(deps.db, ctx, { kind: "on_demand", periodStart, periodEnd: now, slot: null, now });
}

const OWNER_ONLY_TEXT = "Only the owner can pause or resume the mailboxes.";

interface StatusSwitch {
  to: "active" | "paused";
  already: string;
}

// `switchMailboxStatus` does one transaction per mailbox: the conditional update and its audit row.
async function switchMailboxes(deps: CommandDeps, link: LinkedChat, change: StatusSwitch): Promise<OutMessage> {
  if (link.role !== "owner") return { text: OWNER_ONLY_TEXT, buttons: [] };
  const now = deps.now();
  const ctx = { orgId: link.orgId, userId: link.userId };
  const changed: string[] = [];
  const extra: string[] = [];
  for (const mailbox of await listMailboxes(deps.db, ctx)) {
    const address = cutText(mailbox.address, ADDRESS_MAX);
    const loginError = `❌ ${address} has a login error: run mailbox:password first.`;
    if (mailbox.status === "auth_error") {
      extra.push(loginError);
      continue;
    }
    const result = await switchMailboxStatus(deps.db, ctx, mailbox.id, {
      to: change.to,
      actor: link.userId,
      via: "telegram",
      now,
    });
    if (result.kind === "changed") changed.push(address);
    else if (result.kind === "already") extra.push(`${address} ${change.already}`);
    else if (result.kind === "auth_error") extra.push(loginError);
  }
  return { text: [...changeLines(change.to, changed), ...extra].join("\n") || "No mailbox connected.", buttons: [] };
}

function changeLines(to: "active" | "paused", changed: string[]): string[] {
  if (changed.length === 0) return [];
  const list = changed.join(", ");
  return to === "paused"
    ? [
        `⏸ Paused: ${list}`,
        "The system does not read or triage these mailboxes now and sends no urgent notice for them. Digests still come.",
        "/resume starts them again.",
      ]
    : [
        `▶️ Resumed: ${list}`,
        "The next sync runs within 5 minutes. Mail that came during the pause is read then; mail older than 7 days is not triaged.",
      ];
}

export function pauseMailboxes(deps: CommandDeps, link: LinkedChat): Promise<OutMessage> {
  return switchMailboxes(deps, link, {
    to: "paused",
    already: "was paused already.",
  });
}

export function resumeMailboxes(deps: CommandDeps, link: LinkedChat): Promise<OutMessage> {
  return switchMailboxes(deps, link, {
    to: "active",
    already: "was active already.",
  });
}

export function runCommand(deps: CommandDeps, link: LinkedChat, name: CommandName): Promise<OutMessage> {
  switch (name) {
    case "help":
      return Promise.resolve(helpMessage());
    case "status":
      return statusMessage(deps, link);
    case "digest":
      return digestNowMessage(deps, link);
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
        return { text: accountPausedText(deps.operatorContact), buttons: [] };
      }
      return runCommand(deps, link, name);
    },
    callback: async (link, data) => {
      if (await isOrgSuspended(deps.db, { orgId: link.orgId })) {
        log.info(`telegram: org ${link.orgId} suspended: tap refused`);
        return { answer: accountPausedText(deps.operatorContact) };
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
