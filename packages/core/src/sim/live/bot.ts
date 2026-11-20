import { localDateTime, localToInstant, nextLocalDate } from "../../digest/local-time";
import { MINUTE_MS } from "../../time";
import { createRng } from "../random";
import type { SimLang } from "../scenario";
import type { Slot } from "../slot";

import { addDays, isoWeekday } from "./calendar-days";

// The pure rules of a delegate bot: when and what a delegate answers to a delegation mail. The server module
// `lab/bots` reads the mail and sends; this file holds no clock, no file and no random source of its own.
const ZONE = "Europe/Warsaw";
const WORK_START = "08:00";
const WORK_END = "18:00";
const OTHER_ADDRESS_DOMAIN = "poczta-prywatna.test";
const OUT_OF_OFFICE_DAYS = 7;

export type DelegateBehaviour = NonNullable<Slot["delegateBehaviour"]>;
export type BotEvent = "delegation" | "reminder";
export type BotReplyKind = "done" | "auto_reply";
export interface BotReplyPlan {
  kind: BotReplyKind;
  from: "self" | "other";
  at: string; // UTC ISO
}

export interface BotReplyPlanInput {
  behaviour: DelegateBehaviour;
  event: BotEvent;
  receivedAt: string; // UTC ISO
  repliedBefore: boolean; // the bot planned a `done` reply for this delegation before
  seed: number;
}

// Minutes of human delay: `done` waits 30 to 240 minutes after the start point, `late` 30 to 120.
const DONE_DELAY = { min: 30, max: 240 };
const LATE_DELAY = { min: 30, max: 120 };

function isWorkingDay(date: string): boolean {
  return isoWeekday(date) <= 5;
}

/** The moment a delegate starts to look at mail: the receipt time inside Warsaw working hours (Mon-Fri 08:00-18:00), else the next working start. */
export function workStartAfter(receivedAt: string): Date {
  const received = new Date(receivedAt);
  const local = localDateTime(received, ZONE);
  if (isWorkingDay(local.date)) {
    if (local.time >= WORK_START && local.time < WORK_END) return received;
    if (local.time < WORK_START) return localToInstant(local.date, WORK_START, ZONE);
  }
  let date = nextLocalDate(local.date);
  while (!isWorkingDay(date)) date = nextLocalDate(date);
  return localToInstant(date, WORK_START, ZONE);
}

function afterHumanDelay(receivedAt: string, delay: { min: number; max: number }, seed: number): string {
  const minutes = delay.min + createRng(seed).int(delay.max - delay.min + 1);
  return new Date(workStartAfter(receivedAt).getTime() + minutes * MINUTE_MS).toISOString();
}

/**
 * What one delegate does with one event, or null for no reply. The seed fixes the delay: the same seed gives the
 * same answer, so a restart plans the same time.
 */
export function botReplyPlan(input: BotReplyPlanInput): BotReplyPlan | null {
  const { behaviour, event, receivedAt, repliedBefore, seed } = input;
  switch (behaviour) {
    case "silent":
      return null;
    case "out_of_office":
      return {
        kind: "auto_reply",
        from: "self",
        at: new Date(new Date(receivedAt).getTime() + MINUTE_MS).toISOString(),
      };
    case "done":
      return event === "delegation"
        ? { kind: "done", from: "self", at: afterHumanDelay(receivedAt, DONE_DELAY, seed) }
        : null;
    case "other_address":
      return event === "delegation"
        ? { kind: "done", from: "other", at: afterHumanDelay(receivedAt, DONE_DELAY, seed) }
        : null;
    case "late":
      return event === "reminder" && !repliedBefore
        ? { kind: "done", from: "self", at: afterHumanDelay(receivedAt, LATE_DELAY, seed) }
        : null;
  }
}

/** The private address a delegate of the `other_address` behaviour answers from: the same local part on the private domain. */
export function otherAddressOf(address: string): string {
  const local = address.slice(0, address.lastIndexOf("@"));
  return `${local}@${OTHER_ADDRESS_DOMAIN}`;
}

/** The date an out-of-office delegate says they are back: the receipt day plus 7 days, as Warsaw wall date text of the language. */
export function backOnText(receivedAt: string, lang: SimLang): string {
  const date = addDays(localDateTime(new Date(receivedAt), ZONE).date, OUT_OF_OFFICE_DAYS);
  const [year, month, day] = date.split("-") as [string, string, string];
  return lang === "en" ? date : `${day}.${month}.${year}`;
}

const DONE_TEXT: Record<SimLang, { subject: string; body: (name: string) => string }> = {
  pl: { subject: "Zrobione", body: (name) => `Zrobione. Pozdrawiam, ${name}` },
  en: { subject: "Done", body: (name) => `Done. Best regards, ${name}` },
  de: { subject: "Erledigt", body: (name) => `Erledigt. Viele Grüße, ${name}` },
};

const AUTO_TEXT: Record<SimLang, { subject: string; body: (backOn: string) => string }> = {
  pl: { subject: "Automatyczna odpowiedź", body: (backOn) => `Jestem poza biurem do ${backOn}. Odpowiem po powrocie.` },
  en: {
    subject: "Automatic reply",
    body: (backOn) => `I am out of the office until ${backOn}. I will answer when I am back.`,
  },
  de: {
    subject: "Automatische Antwort",
    body: (backOn) => `Ich bin bis ${backOn} nicht im Büro. Ich antworte nach meiner Rückkehr.`,
  },
};

/**
 * The fixed template of a reply, no LLM. `subject` is the template's own subject: the bot uses `Re: <subject of the
 * received mail>` and falls back to this one only for a mail with no subject.
 */
export function botReplyText(
  kind: BotReplyKind,
  lang: SimLang,
  name: string,
  backOn: string
): { subject: string; body: string } {
  if (kind === "done") return { subject: DONE_TEXT[lang].subject, body: DONE_TEXT[lang].body(name) };
  return { subject: AUTO_TEXT[lang].subject, body: AUTO_TEXT[lang].body(backOn) };
}

/** A 32-bit seed from a run id and a Message-ID (FNV-1a), for `botReplyPlan`. */
export function botSeed(runId: string, messageId: string): number {
  let hash = 0x811c9dc5;
  for (const char of `${runId}\n${messageId}`) {
    hash ^= char.codePointAt(0) as number;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
