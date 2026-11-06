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

import type { DB, Db } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { auditEvents, countLlmCallsSince, recordAudit } from "../audit";
import { getMailboxSettings } from "../config";
import { changeMailboxStatus, countWaiting, listMailboxes, type MailboxSummary } from "../mail";
import { buildDigestMessage, digestPeriodStart, WAITING_WINDOW_MS } from "../reports";
import { getMembership, getOrganization } from "../tenancy";

import { handleCallback } from "./callbacks";
import { SYNC_LATE_MS } from "./notices";
import type { CommandName, LinkedChat, UpdateHandlers } from "./port";
import { helpText } from "./texts";

export interface CommandDeps {
  db: Db | Transaction<DB>;
  now(): Date;
  llmDailyCap: number;
  triageScope: "off" | "synthetic" | "all";
}

const log = createLog("channels");

const ADDRESS_MAX = 60;

const SCOPE_TEXTS: Record<CommandDeps["triageScope"], string> = {
  off: "off",
  synthetic: "test mail only (TRIAGE_LLM_SCOPE=synthetic)",
  all: "real mail of the test mailbox (TRIAGE_LLM_SCOPE=all)",
};

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
  from: "active" | "paused";
  to: "active" | "paused";
  event: string;
  verb: string;
  already: string;
}

// One transaction per mailbox: the conditional update and its audit row. `auth_error` never matches `from`.
async function switchMailboxes(deps: CommandDeps, link: LinkedChat, change: StatusSwitch): Promise<OutMessage> {
  if (link.role !== "owner") return { text: OWNER_ONLY_TEXT, buttons: [] };
  const now = deps.now();
  const ctx = { orgId: link.orgId, userId: link.userId };
  const changed: string[] = [];
  const extra: string[] = [];
  for (const mailbox of await listMailboxes(deps.db, ctx)) {
    const address = cutText(mailbox.address, ADDRESS_MAX);
    if (mailbox.status === "auth_error") {
      extra.push(`❌ ${address} has a login error: run mailbox:password first.`);
      continue;
    }
    const run = async (trx: Transaction<DB>): Promise<boolean> => {
      const done = await changeMailboxStatus(trx, ctx, mailbox.id, { from: change.from, to: change.to, at: now });
      if (done) {
        await recordAudit(trx, ctx, {
          actor: link.userId,
          event: change.event,
          data: { mailbox_id: mailbox.id, via: "telegram" },
          at: now,
        });
      }
      return done;
    };
    const done = await (deps.db.isTransaction ? run(deps.db as Transaction<DB>) : deps.db.transaction().execute(run));
    if (done) {
      changed.push(address);
      log.info(`mailbox ${mailbox.id} ${change.verb} by user ${link.userId}`);
    } else {
      extra.push(`${address} ${change.already}`);
    }
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
    from: "active",
    to: "paused",
    event: auditEvents.mailboxPaused,
    verb: "paused",
    already: "was paused already.",
  });
}

export function resumeMailboxes(deps: CommandDeps, link: LinkedChat): Promise<OutMessage> {
  return switchMailboxes(deps, link, {
    from: "paused",
    to: "active",
    event: auditEvents.mailboxResumed,
    verb: "resumed",
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
    command: (link, name) => runCommand(deps, link, name),
    callback: (link, data) => handleCallback({ db: deps.db, now: deps.now }, link, data),
  };
}
