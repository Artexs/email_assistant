import {
  cutText,
  formatClock,
  formatDay,
  llmPauseLine,
  localDateTime,
  localToInstant,
  minimalTexts,
  nextDigestTime,
  parseDigestTimes,
  quietHoursOf,
  QUOTA_TIMEZONE,
  quotaDayStart,
  textsFor,
  type CoreTexts,
  type OutMessage,
  DAY_MS,
} from "@ea/core";

import type { TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { countActionsSince, countApprovals, sendFilterFor } from "../actions";
import { countLlmCallsSince } from "../audit";
import { getMailboxSettings } from "../config";
import { countOpenDelegations } from "../delegation";
import { countWaiting, listMailboxes, type MailboxSummary } from "../mail";
import { llmPauseToShow, WAITING_WINDOW_MS } from "../reports";
import { getMemberNotify, getMembership, getOrganization, isFeatureOn } from "../tenancy";

import type { CommandDeps } from "./commands";
import { ADDRESS_MAX, telegramDetailOf } from "./commands-shared";
import { SYNC_LATE_MS } from "./notices";
import type { LinkedChat } from "./port";

const ACTIONS_WINDOW_MS = DAY_MS;

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

  // `minimal`: a mailbox is "Mailbox 1", "Mailbox 2" in the order of the list, never its address.
  const minimal = (await telegramDetailOf(deps, link)) === "minimal";
  const dayStart = quotaDayStart(now, QUOTA_TIMEZONE);
  const lines = [t.title(formatDay(now, timeZone, texts.locale), localDateTime(now, timeZone).time)];

  const mailboxes = await listMailboxes(db, ctx);
  if (mailboxes.length === 0) lines.push(t.noMailbox);
  const names = new Map(
    mailboxes.map((mailbox, index) => [
      mailbox.id,
      minimal ? minimalTexts(link.locale).mailboxName(index + 1) : cutText(mailbox.address, ADDRESS_MAX),
    ])
  );
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
      `📮 ${names.get(mailbox.id)}`,
      t.mailboxLine(mode, statusText(mailbox, clock, texts)),
      t.lastSync(sync === null ? null : clock(sync), late),
      t.llmCalls(clock(dayStart), calls, llmDailyCap)
    );
  }

  const waiting = await countWaiting(db, ctx, { receivedSince: new Date(now.getTime() - WAITING_WINDOW_MS) });
  lines.push(t.waiting(waiting), t.triage(deps.triageScope));
  const actions = await countActionsSince(db, ctx, { since: new Date(now.getTime() - ACTIONS_WINDOW_MS) });
  lines.push(t.actions(deps.actionsScope.kind, actions));
  lines.push(...(await approvalLines(deps, ctx, mailboxes, texts, clock, names)));
  lines.push(t.send(deps.sendScope.kind));
  const delegations = await countOpenDelegations(db, ctx);
  lines.push(t.delegations(delegations.open, delegations.overdue));
  lines.push(t.llm(deps.llm.provider, deps.llm.classifierModel));
  const llmPause = await llmPauseToShow(db, ctx, now);
  if (llmPause !== null) lines.push(llmPauseLine(llmPause, timeZone, now, texts));

  const member = await getMembership(db, ctx, link.userId);
  const times = parseDigestTimes(member?.digest_times ?? []);
  const next = nextDigestTime({ now, timeZone, times });
  // The own quiet hours of the member; the default while the flag is off or the member set none.
  const own = (await isFeatureOn(db, ctx, "user_quiet_hours"))
    ? await getMemberNotify(db, ctx, link.userId)
    : undefined;
  const quiet = quietHoursOf(own?.quiet_start ?? null, own?.quiet_end ?? null);
  lines.push(
    next === null ? t.noDigestTimes : t.nextDigest(clock(localToInstant(next.date, next.time, timeZone))),
    quiet.start === quiet.end ? t.noQuietHours : t.quietHours(quiet.start, quiet.end)
  );
  return { text: lines.join("\n"), buttons: [] };
}

// The cause of an approved send that waits, in the order of the tap toast: the mailbox, then the scope.
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
  clock: (at: Date) => string,
  names: ReadonlyMap<string, string>
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
    lines.push(line(t.approvalsOf(names.get(mailbox.id) ?? ""), count, mailbox));
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
      return mailbox.oauth_provider === null ? t.stateAuthError(since) : t.stateAuthErrorOAuth(since);
    case "host_blocked":
      return t.stateHostBlocked(since);
  }
}
