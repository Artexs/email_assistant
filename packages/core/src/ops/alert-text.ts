import type { UserLocale } from "../tenancy";
import { textsFor } from "../texts";
import type { SloIdType } from "../texts/operator";
import { MINUTE_MS } from "../time";

import type { OperatorEvent } from "./events";
import type { SloKind } from "./kinds";

// The text of one operator message, in `OPERATOR_LOCALE`. Plain text for Telegram.
// It holds numbers, UUIDs of mailboxes, mails or organizations, the kind code and the runbook path. It never holds a
// subject, an address, a folder name, an error text or the chat id: no function here reads such a value.

export type AlertTextPhase = "open" | "repeat" | "resolved" | "test";

const MAX_SHOWN_IDS = 5;

export interface SloTextInput {
  kind: SloKind;
  phase: AlertTextPhase;
  facts: Record<string, number>;
  // UUIDs of the mailboxes, mails or organizations that the check names. At most five show; the rest count as `+N more`.
  ids: string[];
  openedAt: Date;
  // The end of the incident for `resolved` (it gives the minutes open); the moment of the send for the other phases.
  now: Date;
}

// The kinds that name ids, with the fact that holds the total count. Disk and backup name nothing.
const IDS_OF: Partial<Record<SloKind, { type: SloIdType; total: string }>> = {
  slo_sync_lag: { type: "mailbox", total: "mailboxes" },
  slo_urgent_latency: { type: "email", total: "mails" },
  slo_llm_errors: { type: "org", total: "quota_orgs" },
};

function factReader(facts: Record<string, number>, locale: UserLocale) {
  return (key: string, decimals = 0): string => {
    const value = facts[key] ?? 0;
    const text = (Number.isFinite(value) ? value : 0).toFixed(decimals);
    return locale === "pl" ? text.replace(".", ",") : text;
  };
}

/** The alert text: line 1 the state, line 2 the facts in words, line 3 up to five ids (not for `resolved`), last line the runbook. */
export function renderSloAlert(input: SloTextInput, locale: UserLocale): string {
  const words = textsFor(locale).operator.slo;
  const { kind, phase } = input;
  const openMin = Math.max(0, Math.floor((input.now.getTime() - input.openedAt.getTime()) / MINUTE_MS));
  const lines = [
    words.line1(phase, kind, input.openedAt.toISOString(), openMin),
    words.facts[kind](factReader(input.facts, locale)),
  ];
  const named = IDS_OF[kind];
  if (named !== undefined && phase !== "resolved" && input.ids.length > 0) {
    const shown = input.ids.slice(0, MAX_SHOWN_IDS);
    const total = Math.max(input.ids.length, Math.floor(input.facts[named.total] ?? 0));
    const more = total - shown.length;
    lines.push(`${words.idLabel[named.type]}: ${shown.join(", ")}${more > 0 ? ` ${words.more(more)}` : ""}`);
  }
  lines.push(`${words.runbook}: docs/known-alerts.md#${kind}`);
  return lines.join("\n");
}

/** The text of one event notice. Dates go in as ISO strings. */
export function renderOperatorEvent(event: OperatorEvent, locale: UserLocale): string {
  const texts = textsFor(locale).operator;
  switch (event.kind) {
    case "trial_ending": {
      const iso = event.endsAt.toISOString();
      return event.ended ? texts.trialEnded(event.orgId, iso) : texts.trialEnds(event.orgId, iso);
    }
    case "auth_error_24h":
      return texts.authError24h(event.mailboxId, event.orgId, event.since.toISOString());
    case "llm_cap":
      return texts.llmCap(event.mailboxId, event.orgId, event.cap, event.dayStart.toISOString());
    case "auth_mail_failed":
      return texts.authMailFailed(event.mail, event.userId, event.orgId, event.code);
    case "send_limit":
      return texts.sendLimit(
        event.mailboxId,
        event.orgId,
        event.limit,
        event.at.toISOString(),
        event.until.toISOString()
      );
  }
}

// Fixed values of the `ops:alert-test` notice: the operator sees the form of each alert without a real incident.
const testId = (n: number): string => `00000000-0000-4000-8000-00000000000${n}`;

export const SLO_TEST_FACTS: Record<SloKind, Record<string, number>> = {
  slo_sync_lag: { mailboxes: 2, max_lag_min: 47 },
  slo_urgent_latency: { mails: 1, max_wait_min: 15 },
  slo_llm_errors: { calls: 10, failed: 3, pct: 30, quota_orgs: 0 },
  slo_disk: { free_pct: 12.3, free_gb: 1.8 },
  slo_backup_age: { age_h: 30, failed: 0, missing: 0 },
};

export const SLO_TEST_IDS: Record<SloKind, string[]> = {
  slo_sync_lag: [testId(1), testId(2)],
  slo_urgent_latency: [testId(3)],
  slo_llm_errors: [],
  slo_disk: [],
  slo_backup_age: [],
};
