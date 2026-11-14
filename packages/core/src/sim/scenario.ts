import { z } from "zod";

import { isReservedHost } from "../testmail/batch";
import { urgencyProfileSchema } from "../triage/urgency-profile";

export const simPersonaGroups = [
  "boss",
  "team",
  "delegate",
  "client",
  "partner",
  "vendor",
  "newsletter",
  "marketing",
  "system",
  "spammer",
  "phishing",
] as const;
export type SimPersonaGroup = (typeof simPersonaGroups)[number];
export const simLangs = ["pl", "en", "de"] as const;
export type SimLang = (typeof simLangs)[number];

const keySchema = z.string().regex(/^[a-z0-9-]{1,40}$/);

export const simPersonaSchema = z
  .object({
    key: keySchema,
    displayName: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[^<>"\r\n@]+$/),
    // ASCII, lower case; the validator checks the host.
    address: z.string().regex(/^[a-z0-9._+-]+@[a-z0-9.-]+$/),
    group: z.enum(simPersonaGroups),
    lang: z.enum(simLangs),
    voice: z.string().min(1).max(500),
    // "" means no signature line.
    signature: z.string().max(200),
  })
  .strict();
export type SimPersona = z.infer<typeof simPersonaSchema>;

export const scenarioSchema = z
  .object({
    id: keySchema,
    company: z
      .object({
        name: z.string().min(1).max(80),
        domain: z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)*\.test$/),
      })
      .strict(),
    executive: z
      .object({
        key: keySchema,
        displayName: z.string().min(1).max(60),
        address: z.string(),
        lang: z.enum(["pl", "en"]),
        timeZone: z.literal("Europe/Warsaw"),
      })
      .strict(),
    personas: z.array(simPersonaSchema).min(10).max(25),
    delegates: z
      .array(
        z
          .object({
            persona: z.string(),
            tags: z.array(z.string().min(1).max(30)).min(1).max(5),
          })
          .strict()
      )
      .min(2)
      .max(5),
    urgency: z.object({ vip: z.array(z.string()).max(5), profile: urgencyProfileSchema }).strict(),
    calendar: z.object({ bankStart: z.iso.date(), weekStart: z.iso.date() }).strict(),
    topics: z
      .array(
        z
          .object({
            key: keySchema,
            label: z.string().min(1).max(80),
            personas: z.array(z.string()).min(1),
          })
          .strict()
      )
      .min(5)
      .max(30),
  })
  .strict();
export type Scenario = z.infer<typeof scenarioSchema>;

export type ScenarioIssueCode =
  | "duplicate_key"
  | "duplicate_address"
  | "address_not_reserved"
  | "executive_not_company"
  | "unknown_persona"
  | "delegate_not_delegate_group"
  | "vip_unknown"
  | "missing_group"
  | "not_monday"
  | "deadline_out_of_range"
  | "topic_persona_unknown"
  | "dst_in_week";

// detail holds ids and field names only, never a display name or a voice text.
export interface ScenarioIssue {
  code: ScenarioIssueCode;
  detail: string;
}

const DAY_MS = 86_400_000;
const WARSAW_OFFSET_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Warsaw",
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
});

function dayMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function dayString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isMonday(date: string): boolean {
  return new Date(dayMs(date)).getUTCDay() === 1;
}

// The UTC offset in minutes of Europe/Warsaw at local noon of the given day.
function warsawNoonOffsetMinutes(ms: number): number {
  const noonUtc = ms + 11 * 3_600_000;
  const parts = Object.fromEntries(
    WARSAW_OFFSET_FORMAT.formatToParts(new Date(noonUtc)).map((part) => [part.type, part.value])
  );
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute)
  );
  return Math.round((localAsUtc - noonUtc) / 60_000);
}

// Lists every rule violation of a scenario (never throws); an empty list means valid.
export function validateScenario(s: Scenario): ScenarioIssue[] {
  const issues: ScenarioIssue[] = [];
  const add = (code: ScenarioIssueCode, detail: string) => issues.push({ code, detail });
  const personaByKey = new Map<string, SimPersona>();

  const keys = new Set<string>([s.executive.key]);
  for (const persona of s.personas) {
    if (keys.has(persona.key)) add("duplicate_key", `persona: ${persona.key}`);
    keys.add(persona.key);
    if (!personaByKey.has(persona.key)) personaByKey.set(persona.key, persona);
  }

  const addressOwner = new Map<string, string>([[s.executive.address, s.executive.key]]);
  for (const persona of s.personas) {
    const owner = addressOwner.get(persona.address);
    if (owner !== undefined) add("duplicate_address", `persona: ${persona.key} shares an address with ${owner}`);
    else addressOwner.set(persona.address, persona.key);
    if (!isReservedHost(persona.address.split("@")[1] ?? "")) {
      add("address_not_reserved", `persona: ${persona.key}`);
    }
  }

  if (!s.executive.address.endsWith(`@${s.company.domain}`)) {
    add("executive_not_company", `executive: ${s.executive.key}`);
  }

  for (const delegate of s.delegates) {
    const persona = personaByKey.get(delegate.persona);
    if (!persona) add("unknown_persona", `delegates: ${delegate.persona}`);
    else if (persona.group !== "delegate") add("delegate_not_delegate_group", `delegates: ${delegate.persona}`);
  }

  for (const key of s.urgency.vip) {
    if (!personaByKey.has(key)) add("vip_unknown", `urgency.vip: ${key}`);
  }

  for (const group of simPersonaGroups) {
    if (!s.personas.some((persona) => persona.group === group)) add("missing_group", `group: ${group}`);
  }

  const { bankStart, weekStart } = s.calendar;
  if (!isMonday(bankStart)) add("not_monday", "calendar.bankStart");
  if (!isMonday(weekStart)) add("not_monday", "calendar.weekStart");

  const earliest = dayString(dayMs(bankStart) - 7 * DAY_MS);
  const latest = dayString(dayMs(weekStart) + 21 * DAY_MS);
  s.urgency.profile.deadlines.forEach((deadline, index) => {
    if (deadline.due < earliest || deadline.due > latest)
      add("deadline_out_of_range", `urgency.profile.deadlines[${index}]`);
  });

  for (const topic of s.topics) {
    for (const key of topic.personas) {
      if (!personaByKey.has(key)) add("topic_persona_unknown", `topics: ${topic.key} names ${key}`);
    }
  }

  const weekMs = dayMs(weekStart);
  if (warsawNoonOffsetMinutes(weekMs) !== warsawNoonOffsetMinutes(weekMs + 6 * DAY_MS)) {
    add("dst_in_week", "calendar.weekStart");
  }

  return issues;
}
