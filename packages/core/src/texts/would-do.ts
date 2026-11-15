import type { UserLocale } from "../tenancy";
import type { DraftKind } from "../triage/payloads";

// The tense of an action phrase. `would` and `will` use the infinitive in Polish; the others use a noun.
export type ActionTense = "would" | "will" | "done" | "undone" | "failed";
export type SendPhraseStatus =
  | "logged"
  | "awaiting_approval"
  | "approved"
  | "applying"
  | "applied"
  | "rejected"
  | "expired"
  | "failed";

export interface WouldDoTexts {
  tense: Record<ActionTense, string>;
  flag: (tense: ActionTense) => string;
  markRead: (tense: ActionTense) => string;
  move: (tense: ActionTense, folder: string | null) => string;
  // `skills` (F110 stage 16, flag `why_lines`): the competence label of the delegate of a delegation draft, put next to the name.
  draft: (tense: ActionTense, kind: DraftKind, name: string | null, skills?: string | null) => string;
  send: Record<SendPhraseStatus, string>;
  sendChanged: string; // a send that ended `expired` / `superseded`: a panel edit replaced it (F102 D12)
  sendLimitWait: string; // an approved send held by the send limit (F099 D11 a); the stage plan has no row for it
  staysIn: (folder: string) => string;
}

const isFuture = (tense: ActionTense): boolean => tense === "would" || tense === "will";

// A Polish name in parentheses avoids a case ending on a name that we cannot decline.
const plDelegate = (name: string | null, skills: string | null): string => {
  const parts = [...(name === null ? [] : [`wykonawca ${name}`]), ...(skills === null ? [] : [skills])];
  return parts.length === 0 ? "" : ` (${parts.join("; ")})`;
};

export const wouldDoTexts = {
  en: {
    tense: { would: "would", will: "will", done: "done:", undone: "undone:", failed: "failed:" },
    flag: (_tense) => "flag",
    markRead: (_tense) => "mark read",
    move: (_tense, folder) => (folder === null ? "move" : `move to ${folder}`),
    draft: (_tense, kind, name, skills = null) => {
      if (kind === "clarification") return "draft a question to the sender";
      return `draft a ${kind === "reminder" ? "reminder" : "delegation"} to ${name ?? "a delegate"}${skills === null ? "" : ` (${skills})`}`;
    },
    send: {
      logged: "would ask you to send it",
      awaiting_approval: "waits for your approval",
      approved: "approved, sending",
      applying: "sending",
      applied: "sent",
      rejected: "rejected",
      expired: "not sent (approval expired)",
      failed: "not sent (failed)",
    },
    sendChanged: "changed in the panel (new version)",
    sendLimitWait: "approved, waiting: send limit",
    staysIn: (folder) => `stays in ${folder}`,
  },
  pl: {
    tense: { would: "zrobiłby –", will: "zrobi –", done: "zrobione –", undone: "cofnięte –", failed: "nieudane –" },
    flag: (tense) => (isFuture(tense) ? "oznaczyć flagą" : "oznaczenie flagą"),
    markRead: (tense) => (isFuture(tense) ? "oznaczyć jako przeczytaną" : "oznaczenie jako przeczytanej"),
    move: (tense, folder) => {
      const verb = isFuture(tense) ? "przenieść" : "przeniesienie";
      return folder === null ? verb : `${verb} do ${folder}`;
    },
    draft: (tense, kind, name, skills = null) => {
      const noun = isFuture(tense) ? "przygotować szkic" : "szkic";
      if (kind === "clarification") return `${noun} pytania do nadawcy`;
      return `${noun} ${kind === "reminder" ? "przypomnienia" : "zlecenia"}${plDelegate(name, skills)}`;
    },
    send: {
      logged: "poprosiłby Cię o wysłanie",
      awaiting_approval: "czeka na Twoje zatwierdzenie",
      approved: "zatwierdzone, wysyłanie",
      applying: "wysyłanie",
      applied: "wysłane",
      rejected: "odrzucone",
      expired: "niewysłane (zatwierdzenie wygasło)",
      failed: "niewysłane (błąd)",
    },
    sendChanged: "zmieniono w panelu (nowa wersja)",
    sendLimitWait: "zatwierdzone, czeka (limit wysyłki)",
    staysIn: (folder) => `zostaje w ${folder}`,
  },
} satisfies Record<UserLocale, WouldDoTexts>;
