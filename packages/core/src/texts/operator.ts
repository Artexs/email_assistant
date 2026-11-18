import type { UserLocale } from "../tenancy";

import { pluralCategory } from "./locale";

// The Telegram notices to the operator chat (`OPERATOR_LOCALE`, one language per server). Each text holds ids, codes, dates and
// counts only: no subject, no address, no mail text. Dates are ISO strings from the caller.
export interface OperatorTexts {
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
