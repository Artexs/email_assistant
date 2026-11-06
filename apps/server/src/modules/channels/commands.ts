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
import { countLlmCallsSince } from "../audit";
import { getMailboxSettings } from "../config";
import { countWaiting, listMailboxes, type MailboxSummary } from "../mail";
import { buildDigestMessage, digestPeriodStart, WAITING_WINDOW_MS } from "../reports";
import { getMembership, getOrganization } from "../tenancy";

import type { LinkedChat } from "./port";
import { helpText } from "./texts";

export interface CommandDeps {
  db: Db | Transaction<DB>;
  now(): Date;
  llmDailyCap: number;
  triageScope: "off" | "synthetic" | "all";
}

const SYNC_LATE_MS = 30 * 60_000;
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
