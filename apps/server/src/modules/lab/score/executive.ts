import type { Db, TenantContext } from "../../../platform/db";
import { listExpiredUnapprovedSends } from "../../actions";
import type { LabEvent } from "../state";

import { section, table } from "./render-util";
import type { SectionScope } from "./section";

/** The rule names of the presses, as the executive rules of the lab press them (`ap`, `ar` with a reason, `rw`, `as`, `fu`, `ag`). */
export const PRESS_RULES = [
  "approve",
  "reject_wrong_person",
  "reject_not_needed",
  "reject_no_reason",
  "reason_pick",
  "approve_set",
  "undo",
  "send_again",
  "other",
] as const;
export type PressRule = (typeof PRESS_RULES)[number];

export interface ExecutiveSection {
  // Presses that reached the fake Telegram (`tap_done`), by rule.
  presses: Record<PressRule, number>;
  pressed: number;
  // Taps planned, and planned but not pressed yet (a run that is not stopped, or a restart that lost them).
  planned: number;
  unmapped: number;
  noRule: number;
  // A press with an intent and no done: it may or may not have reached the server, and it is never pressed again.
  tapUnsure: number;
  // A press that the fake refused with a 4xx answer (the button was gone).
  tapGone: number;
  // The same button again, in a later digest.
  tapRepeat: number;
  fakeRestarted: number;
  // Sends that expired with no tap: a fake restart can lose cards, so these are not errors. Counts by reason code.
  approvalsExpired: { total: number; byReason: Record<string, number> };
}

// An executive ref is `<telegram message id>:<id>` or `rw:<telegram message id>:<id>`; a bot ref starts with a persona key.
const isExecutiveRef = (ref: string): boolean => /^(rw:)?\d+(:|$)/.test(ref);

function ruleOf(data: string, then: "p" | "n" | undefined): PressRule {
  switch (data.split(":")[0]) {
    case "ap":
      return "approve";
    case "ar":
      return then === "p" ? "reject_wrong_person" : then === "n" ? "reject_not_needed" : "reject_no_reason";
    case "rw":
      return "reason_pick";
    case "as":
      return "approve_set";
    case "fu":
      return "undo";
    case "ag":
      return "send_again";
    default:
      return "other";
  }
}

/** The executive table from the events and the expired sends (reason code of each). Pure. */
export function scoreExecutive(
  events: readonly LabEvent[],
  expired: readonly { id: string; reason: string | null }[]
): ExecutiveSection {
  const thenOf = new Map<string, "p" | "n" | undefined>();
  const presses = Object.fromEntries(PRESS_RULES.map((rule) => [rule, 0])) as Record<PressRule, number>;
  const result: ExecutiveSection = {
    presses,
    pressed: 0,
    planned: 0,
    unmapped: 0,
    noRule: 0,
    tapUnsure: 0,
    tapGone: 0,
    tapRepeat: 0,
    fakeRestarted: 0,
    approvalsExpired: { total: expired.length, byReason: {} },
  };
  for (const event of events) {
    if (event.t === "tap_planned") {
      thenOf.set(event.key, event.then);
      result.planned += 1;
    } else if (event.t === "tap_done") {
      presses[ruleOf(event.data, thenOf.get(event.key))] += 1;
      result.pressed += 1;
    } else if (event.t === "skip") {
      if (event.code === "unmapped" && isExecutiveRef(event.ref)) result.unmapped += 1;
      else if (event.code === "no_rule") result.noRule += 1;
      else if (event.code === "tap_unsure") result.tapUnsure += 1;
      else if (event.code === "tap_gone") result.tapGone += 1;
      else if (event.code === "tap_repeat") result.tapRepeat += 1;
      else if (event.code === "fake_restarted") result.fakeRestarted += 1;
    }
  }
  for (const row of expired) {
    const reason = row.reason ?? "none";
    result.approvalsExpired.byReason[reason] = (result.approvalsExpired.byReason[reason] ?? 0) + 1;
  }
  return result;
}

/** Reads the sends of the run mailbox that expired with no tap (ids and reasons; filters `ctx.orgId`) and scores the run. */
export async function scoreExecutiveSection(
  db: Db,
  ctx: TenantContext,
  scope: SectionScope
): Promise<ExecutiveSection> {
  const expired = await listExpiredUnapprovedSends(db, ctx, { range: scope.window, mailboxId: scope.mailboxId });
  return scoreExecutive(scope.events, expired);
}

export const renderExecutive = section<ExecutiveSection>((data) => {
  const reasons = Object.entries(data.approvalsExpired.byReason)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, count]) => `${reason} ${count}`);
  return [
    "## Executive",
    "",
    `Taps planned ${data.planned}, pressed ${data.pressed}.`,
    "",
    ...table(
      ["Rule", "Presses"],
      PRESS_RULES.map((rule) => [rule, String(data.presses[rule])])
    ),
    "",
    `Cards with no mapped mail (unmapped) ${data.unmapped}, no rule ${data.noRule}, tap unsure ${data.tapUnsure}, tap gone ${data.tapGone}, tap repeat ${data.tapRepeat}, fake restarted ${data.fakeRestarted}.`,
    `Approvals expired without a tap: ${data.approvalsExpired.total}${reasons.length === 0 ? "" : ` (${reasons.join(", ")})`}. A fake restart can lose cards, so these are not errors.`,
    "",
  ];
});
