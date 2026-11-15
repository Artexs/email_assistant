import type { PlanSpec, WeekSpec } from "./plan-spec";
import type { Scenario, SimPersona } from "./scenario";
import type { SentPlanSpec } from "./sent-plan-spec";
import type { SentBlindCase, SentLabel, SentSlot, SentText } from "./sent-slot";

function persona(key: string, group: SimPersona["group"], lang: SimPersona["lang"], host: string): SimPersona {
  return {
    key,
    displayName: `Persona ${key}`,
    address: `${key}@${host}`,
    group,
    lang,
    voice: `Short and direct, writes as the ${group} ${key}.`,
    signature: group === "boss" || group === "team" ? `Pozdrawiam, ${key}` : "",
  };
}

// A small valid scenario for tests of the sim code; the real scenario is a file in evals/sim.
export const miniScenario: Scenario = {
  id: "mini",
  company: { name: "Mini Sp. z o.o.", domain: "mini.test" },
  executive: {
    key: "szef",
    displayName: "Szef Mini",
    address: "szef@mini.test",
    lang: "pl",
    timeZone: "Europe/Warsaw",
    voice: "Short and direct, first names, no small talk.",
    signature: "Pozdrawiam, Szef",
  },
  personas: [
    persona("prezes", "boss", "pl", "mini.test"),
    persona("kasia", "team", "pl", "mini.test"),
    persona("anna", "delegate", "pl", "mini.test"),
    persona("marek", "delegate", "pl", "mini.test"),
    persona("client-a", "client", "en", "client-a.test"),
    persona("partner-b", "partner", "en", "partner-b.test"),
    persona("vendor-c", "vendor", "pl", "vendor-c.test"),
    persona("news-d", "newsletter", "en", "news-d.test"),
    persona("promo-e", "marketing", "pl", "promo-e.test"),
    persona("system-f", "system", "en", "system-f.test"),
    persona("spam-g", "spammer", "en", "spam-g.test"),
    persona("phish-h", "phishing", "en", "phish-h.test"),
  ],
  delegates: [
    { persona: "anna", tags: ["faktury", "ksiegowosc"] },
    { persona: "marek", tags: ["oferty", "sprzedaz"] },
  ],
  urgency: {
    vip: ["prezes"],
    profile: {
      topics: [
        { label: "Fuzja z Beta", keywords: ["fuzja", "beta"] },
        { label: "Audyt roczny", keywords: ["audyt"] },
      ],
      deadlines: [
        { label: "Oferta dla klienta A", due: "2026-11-20" },
        { label: "Zamkniecie audytu", due: "2026-12-04" },
      ],
    },
  },
  calendar: { bankStart: "2026-11-02", weekStart: "2026-11-16" },
  topics: [
    { key: "faktury", label: "Faktury i platnosci", personas: ["anna", "vendor-c"] },
    { key: "oferty", label: "Oferty dla klientow", personas: ["marek", "client-a"] },
    { key: "fuzja", label: "Fuzja z Beta", personas: ["prezes", "partner-b"] },
    { key: "audyt", label: "Audyt roczny", personas: ["kasia"] },
    { key: "systemy", label: "Powiadomienia systemowe", personas: ["system-f"] },
  ],
};

// The week numbers of lab-01 (the real plan file is evals/sim/<id>/plan.json).
export const defaultWeekSpec: WeekSpec = {
  weekdayMails: 150,
  weekendMails: 40,
  mix: { notification: 0.35, spam: 0.2, info: 0.2, needs_reply: 0.13, delegation: 0.07, urgent: 0.05 },
  langShare: { pl: 0.7, en: 0.3 },
  replyShare: 0.3,
  maxThreadDepth: 5,
  sentThreadsPerWeekday: 3,
  offHoursShare: 0.05,
  behaviour: { done: 0.4, late: 0.2, out_of_office: 0.15, other_address: 0.1, silent: 0.15 },
  historyDays: 30,
};

// A small corpus plan for tests: 5 dev and 20 holdout cases per category, 1 holdout case per hard-case tag.
export const miniPlanSpec: PlanSpec = {
  seed: 7,
  batchSize: 25,
  bank: {
    devPerCategory: 5,
    holdoutPerCategory: 20,
    hardPerTag: 2,
    hardDevPerTag: 1,
    replyInjectionPerTag: 1,
    replyInjectionDevPerTag: 0,
    langShare: { pl: 0.6, en: 0.4 },
    threadShare: 0.2,
  },
  week: defaultWeekSpec,
};

// One sent mail (F116): an ask with a time-word due and a dated promise, plus the files that belong to it.
export const miniSentSlot: SentSlot = {
  id: "s-0001",
  part: "sent-dev",
  batch: "batch-001",
  persona: "szef",
  to: ["client-a"],
  cc: ["kasia"],
  lang: "en",
  sentAt: "2026-11-18T09:00:00.000Z",
  labels: {
    expectsReply: true,
    ask: "confirm the Oferty dla klientow figures",
    due: { kind: "word", word: "friday" },
    promise: "send the updated offer",
    promiseDue: { kind: "date", date: "2026-11-25" },
  },
  hardCases: [],
  thread: [{ from: "client-a", subject: "Oferty dla klientow", brief: "the first mail of the exchange" }],
  quoted: true,
  style: { length: "short", greeting: "formal", signature: true },
  brief: "Mail to Persona client-a about Oferty dla klientow. It asks the recipient to confirm the figures by friday.",
};

export const miniSentText: SentText = {
  id: "s-0001",
  subject: "Re: Oferty dla klientow",
  body: "Hello, please confirm the figures by Friday. I will send the updated offer on 2026-11-25.",
};

export const miniSentBlind: SentBlindCase = {
  id: "s-0001",
  from: "szef@mini.test",
  to: ["client-a@client-a.test"],
  cc: ["kasia@mini.test"],
  subject: "Re: Oferty dla klientow",
  sentAt: "2026-11-18T09:00:00.000Z",
  body: miniSentText.body,
  threadSubjects: ["Oferty dla klientow"],
};

export const miniSentLabel: SentLabel = {
  id: "s-0001",
  expectsReply: true,
  promise: true,
  due: "2026-11-20",
  promiseDue: "2026-11-25",
  blindHash: "a".repeat(64),
};

// A small sent-bank plan for tests: 13 hard-case slots and 7 others in dev, 26 and 34 in holdout.
export const miniSentPlanSpec: SentPlanSpec = {
  seed: 7,
  batchSize: 25,
  sizes: { dev: 20, holdout: 60 },
  hardPerTag: { dev: 1, holdout: 2 },
  langShare: { pl: 0.6, en: 0.4 },
  expectsReplyShare: 0.5,
  promiseShare: 0.25,
  dueShare: 0.3,
  delegateShare: 0.2,
  weekendShare: 0.2,
  threadShare: 0.35,
  ccShare: 0.25,
};

// A text that passes `checkSentCase` for a slot: right language, length, signature, quoted blocks and planted string.
const sentences: Record<SentSlot["lang"], string> = {
  pl: "Dzień dobry, to jest bardzo ważne, ale nie mam czasu, więc proszę o pomoc i dziękuję za wszystko.",
  en: "Hello, this is the note that we send to you, and we can write it for the team, please let me know when you are ready, thanks.",
};
const WORDS = { short: 20, medium: 100, long: 220 } as const;

function filler(lang: SentSlot["lang"], words: number): string {
  const all = Array.from({ length: Math.ceil(words / 10) }, () => sentences[lang]).join(" ");
  return all.split(/\s+/).slice(0, words).join(" ");
}

export const sentPlantedFixture = "PL00-TEST-4821";

export function sentFixtureText(slot: SentSlot, scenario: Scenario = miniScenario): SentText {
  const injection = slot.hardCases.includes("injection_quote");
  const lines = [filler(slot.lang, WORDS[slot.style.length])];
  if (slot.style.signature && scenario.executive.signature !== "") lines.push(scenario.executive.signature);
  // One quoted block per thread mail, newest first; the injection text sits in the first block.
  if (slot.quoted) {
    slot.thread.forEach((item, i) => {
      lines.push(
        "",
        `On day ${i}, ${item.from} wrote:`,
        `> ${injection && i === 0 ? sentPlantedFixture : filler(slot.lang, 8)}`
      );
    });
  }
  const text: SentText = { id: slot.id, subject: `Temat ${slot.id}`, body: lines.join("\n") };
  if (injection) text.planted = [sentPlantedFixture];
  return text;
}
