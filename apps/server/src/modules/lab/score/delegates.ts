import {
  DELEGATION_DEFAULT_DUE_MS,
  localDateTime,
  localToInstant,
  nextLocalDate,
  type DelegateBehaviour,
} from "@ea/core";

import type { Db, TenantContext } from "../../../platform/db";
import { CHASER_LOCAL_TIME, listDelegationOutcomes, type DelegationOutcomeRow } from "../../delegation";
import { getEmailHeaders } from "../../mail";
import type { LabEvent } from "../state";

import type { ScoredMail } from "./join";
import { section, table } from "./render-util";
import type { SectionScope } from "./section";

const ZONE = "Europe/Warsaw";
const HOUR_MS = 3_600_000;
// The executive's tap on the reminder card comes after the chaser run (stage 13: 2 hours).
const TAP_ALLOWANCE_MS = 2 * HOUR_MS;

export const BEHAVIOURS: readonly DelegateBehaviour[] = ["done", "late", "out_of_office", "other_address", "silent"];
// A delegation expects a reminder only for these behaviours.
const NEEDS_REMINDER: readonly DelegateBehaviour[] = ["late", "out_of_office", "silent"];

/** What one planned delegation slot did in the run. */
export interface DelegateObservation {
  slotId: string;
  behaviour: DelegateBehaviour;
  // A delegation of this mail was sent.
  sent: boolean;
  answered: boolean;
  // The answering mail carries an `Auto-Submitted` header (N3: the server cannot tell it from a real answer).
  answeredByAuto: boolean;
  reminders: number;
  overdue: boolean;
  // The first chaser run after the due time, plus the tap allowance, is before the end of the run tail.
  reminderReachable: boolean;
}

export interface DelegateBehaviourScore {
  behaviour: DelegateBehaviour;
  planned: number;
  sent: number;
  answered: number;
  answeredByAuto: number;
  reminders: number;
  overdue: number;
  neverSent: number;
  // Sent delegations that expect a reminder but cannot get one before the run ends: never a mismatch.
  reminderNotReachable: number;
  // Sent delegations whose outcome differs from the expected one of the behaviour.
  differ: number;
  // `other_address` only: answered is a finding for E5b (the planted F040 miss), not a plain mismatch.
  finding: boolean;
}

// The codes of the `skip` events that a delegate bot writes. `unmapped` is shared with the executive: see `isBotRef`.
const BOT_SKIP_CODES = new Set([
  "auto_submitted",
  "reply_to_own_mail",
  "unexpected_delegation",
  "send_failed",
  "delegate_unknown",
  "received_gone",
  "received_changed",
  "address_refused",
]);

export interface BotCounts {
  // `bot_done` events: replies sent.
  replies: number;
  // `bot_error` events: failed tries to send a reply.
  errors: number;
  // `skip` events of the bots by code (`send_failed` is the end of a reply after 5 errors).
  skips: Record<string, number>;
}

export interface DelegatesSection {
  rows: DelegateBehaviourScore[];
  unexpectedDelegation: number;
  unmapped: number;
  bots: BotCounts;
}

// A bot ref is `<persona key>:<uid>` or a reply key `<message id>:<kind>`; an executive ref starts with digits or `rw:`.
const isBotRef = (ref: string): boolean => !/^(rw:)?\d+(:|$)/.test(ref);

export function botCountsOf(events: readonly LabEvent[]): BotCounts {
  const counts: BotCounts = { replies: 0, errors: 0, skips: {} };
  for (const event of events) {
    if (event.t === "bot_done") counts.replies += 1;
    else if (event.t === "bot_error") counts.errors += 1;
    else if (
      event.t === "skip" &&
      (BOT_SKIP_CODES.has(event.code) || (event.code === "unmapped" && isBotRef(event.ref)))
    ) {
      counts.skips[event.code] = (counts.skips[event.code] ?? 0) + 1;
    }
  }
  return counts;
}

/** The first chaser run after `due` (07:30 Warsaw; the chaser acts only on a delegation whose due time has passed). */
export function firstChaserRunAfter(due: Date): Date {
  const local = localDateTime(due, ZONE);
  const sameDay = localToInstant(local.date, CHASER_LOCAL_TIME, ZONE);
  return sameDay.getTime() > due.getTime()
    ? sameDay
    : localToInstant(nextLocalDate(local.date), CHASER_LOCAL_TIME, ZONE);
}

/** T5: a reminder is reachable when the first chaser run after the due time, plus the tap allowance, is before the tail end. */
export function reminderReachable(due: Date, tailEndsAt: Date): boolean {
  return firstChaserRunAfter(due).getTime() + TAP_ALLOWANCE_MS < tailEndsAt.getTime();
}

function scoreOne(behaviour: DelegateBehaviour, rows: readonly DelegateObservation[]): DelegateBehaviourScore {
  const sent = rows.filter((row) => row.sent);
  let differ = 0;
  let reminderNotReachable = 0;
  for (const row of sent) {
    if (NEEDS_REMINDER.includes(behaviour) && !row.reminderReachable) {
      reminderNotReachable += 1;
      continue;
    }
    // done: answered. late: answered after a reminder. out_of_office, silent: not answered, a reminder.
    // other_address: not answered (the delegate answers from another address).
    const expected = {
      done: row.answered,
      late: row.answered && row.reminders >= 1,
      out_of_office: !row.answered && row.reminders >= 1,
      other_address: !row.answered,
      silent: !row.answered && row.reminders >= 1,
    }[behaviour];
    if (!expected) differ += 1;
  }
  return {
    behaviour,
    planned: rows.length,
    sent: sent.length,
    answered: sent.filter((row) => row.answered).length,
    answeredByAuto: sent.filter((row) => row.answeredByAuto).length,
    reminders: sent.reduce((total, row) => total + row.reminders, 0),
    overdue: sent.filter((row) => row.overdue).length,
    neverSent: rows.length - sent.length,
    reminderNotReachable,
    differ,
    finding: behaviour === "other_address",
  };
}

/** The delegates table: one row per behaviour, then the bot counts. */
export function scoreDelegates(rows: readonly DelegateObservation[], events: readonly LabEvent[]): DelegatesSection {
  const bots = botCountsOf(events);
  return {
    rows: BEHAVIOURS.map((behaviour) =>
      scoreOne(
        behaviour,
        rows.filter((row) => row.behaviour === behaviour)
      )
    ),
    unexpectedDelegation: bots.skips.unexpected_delegation ?? 0,
    unmapped: bots.skips.unmapped ?? 0,
    bots,
  };
}

// The delegation of a mail that went out: the newest one that has a send time.
function sentDelegationOf(rows: readonly DelegationOutcomeRow[]): DelegationOutcomeRow | undefined {
  return rows.filter((row) => row.sentAt !== null).at(-1);
}

/** Reads the delegations of the planned delegation slots (every read filters by `ctx.orgId`) and scores them. */
export async function scoreDelegatesSection(
  db: Db,
  ctx: TenantContext,
  scope: SectionScope,
  joined: readonly ScoredMail[]
): Promise<DelegatesSection> {
  const emailOf = new Map(joined.flatMap((row) => (row.emailId === null ? [] : [[row.slotId, row.emailId] as const])));
  const slots = scope.run.plan.items.flatMap((item) => {
    const slot = scope.corpus.slots.get(item.slotId);
    return slot?.delegateBehaviour === undefined ? [] : [{ id: slot.id, behaviour: slot.delegateBehaviour }];
  });
  const outcomes = await listDelegationOutcomes(db, ctx, [...emailOf.values()]);
  const tailEndsAt = new Date(scope.run.plan.tailEndsAt);

  const observations: DelegateObservation[] = [];
  for (const slot of slots) {
    const emailId = emailOf.get(slot.id);
    const delegation =
      emailId === undefined ? undefined : sentDelegationOf(outcomes.filter((row) => row.emailId === emailId));
    if (delegation === undefined || delegation.sentAt === null) {
      observations.push({
        slotId: slot.id,
        behaviour: slot.behaviour,
        sent: false,
        answered: false,
        answeredByAuto: false,
        reminders: 0,
        overdue: false,
        reminderReachable: false,
      });
      continue;
    }
    const answered = delegation.answeredAt !== null;
    const headers =
      answered && delegation.answeredEmailId !== null
        ? await getEmailHeaders(db, ctx, delegation.answeredEmailId)
        : undefined;
    const auto = headers?.autoSubmitted ?? null;
    const due = delegation.dueAt ?? new Date(delegation.sentAt.getTime() + DELEGATION_DEFAULT_DUE_MS);
    observations.push({
      slotId: slot.id,
      behaviour: slot.behaviour,
      sent: true,
      answered,
      answeredByAuto: auto !== null && auto !== "no",
      reminders: delegation.remindersSent,
      overdue: delegation.overdueAt !== null,
      reminderReachable: reminderReachable(due, tailEndsAt),
    });
  }
  return scoreDelegates(observations, scope.events);
}

function rowCells(row: DelegateBehaviourScore): string[] {
  const outcome =
    row.differ === 0 ? "ok" : row.finding ? `finding: ${row.differ} answered (E5b)` : `${row.differ} differ`;
  return [
    row.behaviour,
    String(row.planned),
    String(row.sent),
    String(row.answered),
    String(row.answeredByAuto),
    String(row.reminders),
    String(row.overdue),
    String(row.neverSent),
    String(row.reminderNotReachable),
    outcome,
  ];
}

export const renderDelegates = section<DelegatesSection>((data) => {
  const skips = Object.entries(data.bots.skips)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, count]) => `${code} ${count}`);
  return [
    "## Delegates",
    "",
    "Expected: done answered; late answered after a reminder; out_of_office not answered, a reminder; other_address not answered (planted miss); silent not answered, a reminder. A reminder is expected only when a chaser run (07:30 Warsaw) after the due time, plus 2 hours, is before the end of the run.",
    "",
    ...table(
      [
        "Behaviour",
        "Planned",
        "Sent",
        "Answered",
        "Answered by auto-reply",
        "Reminders sent",
        "Overdue",
        "Never sent",
        "Reminder not reachable in this run",
        "Outcome",
      ],
      data.rows.map(rowCells)
    ),
    "",
    `Bot replies sent ${data.bots.replies}, failed tries ${data.bots.errors}. Unexpected delegation ${data.unexpectedDelegation}, unmapped ${data.unmapped}.`,
    `Bot skips: ${skips.length === 0 ? "none" : skips.join(", ")}.`,
    "",
  ];
});
