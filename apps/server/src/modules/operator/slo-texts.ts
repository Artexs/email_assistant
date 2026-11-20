import { MINUTE_MS, type SloKind } from "@ea/core";

// The text of one operator alert, in English or Polish (`OPERATOR_LOCALE`). Plain text for Telegram.
// It holds numbers, UUIDs of mailboxes, mails or organizations, the kind code and the runbook path. It never holds a
// subject, an address, a folder name, an error text or the chat id: no function here reads such a value.

export type AlertLocale = "en" | "pl";
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
  locale?: AlertLocale;
}

type IdType = "mailbox" | "email" | "org";
// One fact as text: `f("mailboxes")` is "2", `f("free_pct", 1)` is "12.3" (Polish "12,3").
type Facts = (key: string, decimals?: number) => string;

interface Words {
  line1: (phase: AlertTextPhase, kind: SloKind, since: string, openMin: number) => string;
  more: (count: number) => string;
  runbook: string;
  idLabel: Record<IdType, string>;
  facts: Record<SloKind, (f: Facts) => string>;
}

// The kinds that name ids, with the fact that holds the total count. Disk and backup name nothing.
const IDS_OF: Partial<Record<SloKind, { type: IdType; total: string }>> = {
  slo_sync_lag: { type: "mailbox", total: "mailboxes" },
  slo_urgent_latency: { type: "email", total: "mails" },
  slo_llm_errors: { type: "org", total: "quota_orgs" },
};

const english: Words = {
  line1: (phase, kind, since, openMin) => {
    if (phase === "open") return `ALERT ${kind}`;
    if (phase === "repeat") return `STILL OPEN ${kind} (since ${since})`;
    if (phase === "resolved") return `RESOLVED ${kind} (open ${openMin} min)`;
    return `TEST ${kind}`;
  },
  more: (count) => `+${count} more`,
  runbook: "Runbook",
  idLabel: { mailbox: "Mailboxes", email: "Mails", org: "Organizations" },
  facts: {
    slo_sync_lag: (f) =>
      f("mailboxes") === "0"
        ? "No mailbox is late"
        : `${f("mailboxes")} ${f("mailboxes") === "1" ? "mailbox" : "mailboxes"}, oldest sync ${f("max_lag_min")} min ago`,
    slo_urgent_latency: (f) =>
      f("mails") === "0"
        ? "No urgent mail waits too long"
        : `${f("mails")} urgent ${f("mails") === "1" ? "mail" : "mails"} not told in time, longest wait ${f("max_wait_min")} min`,
    slo_llm_errors: (f) => {
      const calls =
        f("calls") === "0"
          ? "No LLM calls in the window"
          : `${f("failed")} of ${f("calls")} LLM calls failed (${f("pct", 1)} %)`;
      return f("quota_orgs") === "0"
        ? calls
        : `${calls}, ${f("quota_orgs")} ${f("quota_orgs") === "1" ? "organization" : "organizations"} paused by a spent quota`;
    },
    slo_disk: (f) => `Free ${f("free_pct", 1)} % (${f("free_gb", 1)} GB)`,
    slo_backup_age: (f) => {
      if (f("missing") !== "0") return "No backup status file";
      const ago = Number(f("age_h")) < 0 ? "no good backup on record" : `last good backup ${f("age_h")} h ago`;
      return f("failed") === "0" ? `${ago.charAt(0).toUpperCase()}${ago.slice(1)}` : `Last backup run failed; ${ago}`;
    },
  },
};

const polish: Words = {
  line1: (phase, kind, since, openMin) => {
    if (phase === "open") return `ALARM ${kind}`;
    if (phase === "repeat") return `ALARM TRWA ${kind} (od ${since})`;
    if (phase === "resolved") return `ALARM ZAKOŃCZONY ${kind} (trwał ${openMin} min)`;
    return `TEST ${kind}`;
  },
  more: (count) => `+${count} więcej`,
  runbook: "Instrukcja",
  idLabel: { mailbox: "Skrzynki", email: "Wiadomości", org: "Organizacje" },
  facts: {
    slo_sync_lag: (f) =>
      f("mailboxes") === "0"
        ? "Brak opóźnionych skrzynek"
        : `Opóźnione skrzynki: ${f("mailboxes")}; najstarsza synchronizacja sprzed ${f("max_lag_min")} min`,
    slo_urgent_latency: (f) =>
      f("mails") === "0"
        ? "Brak pilnych wiadomości czekających zbyt długo"
        : `Pilne wiadomości bez powiadomienia na czas: ${f("mails")}; najdłuższe oczekiwanie ${f("max_wait_min")} min`,
    slo_llm_errors: (f) => {
      const calls =
        f("calls") === "0"
          ? "Brak wywołań LLM w oknie"
          : `Nieudane wywołania LLM: ${f("failed")} z ${f("calls")} (${f("pct", 1)}%)`;
      return f("quota_orgs") === "0" ? calls : `${calls}; organizacje z wyczerpanym limitem: ${f("quota_orgs")}`;
    },
    slo_disk: (f) => `Wolne miejsce: ${f("free_pct", 1)}% (${f("free_gb", 1)} GB)`,
    slo_backup_age: (f) => {
      if (f("missing") !== "0") return "Brak pliku statusu kopii zapasowej";
      const ago =
        Number(f("age_h")) < 0 ? "Brak udanej kopii w historii" : `Ostatnia udana kopia sprzed ${f("age_h")} h`;
      return f("failed") === "0"
        ? ago
        : `Ostatnia kopia nie powiodła się; ${ago.charAt(0).toLowerCase()}${ago.slice(1)}`;
    },
  },
};

const WORDS: Record<AlertLocale, Words> = { en: english, pl: polish };

function factReader(facts: Record<string, number>, locale: AlertLocale): Facts {
  return (key, decimals = 0) => {
    const value = facts[key] ?? 0;
    const text = (Number.isFinite(value) ? value : 0).toFixed(decimals);
    return locale === "pl" ? text.replace(".", ",") : text;
  };
}

/** The alert text: line 1 the state, line 2 the facts in words, line 3 up to five ids (not for `resolved`), last line the runbook. */
export function sloAlertText(input: SloTextInput): string {
  const locale = input.locale ?? "en";
  const words = WORDS[locale];
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

// Fixed values of the `ops:alert-test` notice: the operator sees the form of each alert without a real incident.
const testId = (n: number): string => `00000000-0000-4000-8000-00000000000${n}`;

export const TEST_FACTS: Record<SloKind, Record<string, number>> = {
  slo_sync_lag: { mailboxes: 2, max_lag_min: 47 },
  slo_urgent_latency: { mails: 1, max_wait_min: 15 },
  slo_llm_errors: { calls: 10, failed: 3, pct: 30, quota_orgs: 0 },
  slo_disk: { free_pct: 12.3, free_gb: 1.8 },
  slo_backup_age: { age_h: 30, failed: 0, missing: 0 },
};

export const TEST_IDS: Record<SloKind, string[]> = {
  slo_sync_lag: [testId(1), testId(2)],
  slo_urgent_latency: [testId(3)],
  slo_llm_errors: [],
  slo_disk: [],
  slo_backup_age: [],
};
