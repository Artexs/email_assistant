import type { AlertTextPhase } from "../ops/alert-text";
import type { SloKind } from "../ops/kinds";
import type { UserLocale } from "../tenancy";

import { pluralCategory } from "./locale";

// The Telegram notices to the operator chat (`OPERATOR_LOCALE`, one language per server). Each text holds ids, codes, dates and
// counts only: no subject, no address, no mail text. Dates are ISO strings from the caller.
// The kinds of id that a service-level alert names.
export type SloIdType = "mailbox" | "email" | "org";
// One fact as text: `f("mailboxes")` is "2", `f("free_pct", 1)` is "12.3" (Polish "12,3").
export type SloFacts = (key: string, decimals?: number) => string;

// The words of the service-level alerts (`renderSloAlert` joins them).
export interface SloWords {
  line1: (phase: AlertTextPhase, kind: SloKind, since: string, openMin: number) => string;
  more: (count: number) => string;
  runbook: string;
  idLabel: Record<SloIdType, string>;
  facts: Record<SloKind, (f: SloFacts) => string>;
}

export interface OperatorTexts {
  slo: SloWords;
  trialEnds: (orgId: string, endsIso: string) => string;
  trialEnded: (orgId: string, endedIso: string) => string;
  authError24h: (mailboxId: string, orgId: string, sinceIso: string) => string;
  llmCap: (mailboxId: string, orgId: string, cap: number, dayIso: string) => string;
  authMailFailed: (kind: string, userId: string, orgId: string, code: string) => string;
  sendLimit: (mailboxId: string, orgId: string, limit: string, atIso: string, untilIso: string) => string;
}

const callsPl = (count: number): string => {
  const category = pluralCategory("pl", count);
  if (category === "one") return "wywołanie";
  return category === "few" ? "wywołania" : "wywołań";
};

export const operatorTexts = {
  en: {
    slo: {
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
          return f("failed") === "0"
            ? `${ago.charAt(0).toUpperCase()}${ago.slice(1)}`
            : `Last backup run failed; ${ago}`;
        },
      },
    },
    trialEnds: (orgId, endsIso) => `Trial of org ${orgId} ends ${endsIso}.`,
    trialEnded: (orgId, endedIso) => `Trial of org ${orgId} ended ${endedIso}.`,
    authError24h: (mailboxId, orgId, sinceIso) =>
      `Mailbox ${mailboxId} of org ${orgId} has been in auth_error since ${sinceIso}.`,
    llmCap: (mailboxId, orgId, cap, dayIso) =>
      `Mailbox ${mailboxId} of org ${orgId} reached the daily LLM cap (${cap} calls) on the quota day from ${dayIso}.`,
    authMailFailed: (kind, userId, orgId, code) =>
      `Auth mail ${kind} to user ${userId} of org ${orgId} failed (${code}).`,
    sendLimit: (mailboxId, orgId, limit, atIso, untilIso) =>
      `Mailbox ${mailboxId} of org ${orgId} hit the send limit ${limit} at ${atIso}; its sends wait until ${untilIso}.`,
  },
  pl: {
    slo: {
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
    },
    trialEnds: (orgId, endsIso) => `Okres próbny organizacji ${orgId} kończy się ${endsIso}.`,
    trialEnded: (orgId, endedIso) => `Okres próbny organizacji ${orgId} zakończył się ${endedIso}.`,
    authError24h: (mailboxId, orgId, sinceIso) =>
      `Skrzynka ${mailboxId} organizacji ${orgId} ma stan auth_error od ${sinceIso}.`,
    llmCap: (mailboxId, orgId, cap, dayIso) =>
      `Skrzynka ${mailboxId} organizacji ${orgId} osiągnęła dzienny limit wywołań LLM (${cap} ${callsPl(cap)}) w dobie limitu od ${dayIso}.`,
    authMailFailed: (kind, userId, orgId, code) =>
      `Nie udało się wysłać wiadomości uwierzytelniającej (${kind}) do użytkownika ${userId} organizacji ${orgId} (${code}).`,
    sendLimit: (mailboxId, orgId, limit, atIso, untilIso) =>
      `Skrzynka ${mailboxId} organizacji ${orgId} osiągnęła limit wysyłki ${limit} o ${atIso}; jej wysyłki czekają do ${untilIso}.`,
  },
} satisfies Record<UserLocale, OperatorTexts>;
