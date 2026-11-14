import { z } from "zod";

import { localDateTime, localToInstant } from "../digest/local-time";
import { senderHistorySchema, type SenderHistory } from "../triage/sender-history";
import type { UrgencySource } from "../triage/urgency-profile";

import { BRIEF_MAX } from "./briefs";
import { hardCaseRules, type HardCaseRule } from "./hard-cases";
import { senderHistoryFor } from "./history-gen";
import {
  batchSlots,
  buildSlot,
  groupDraws,
  greetingOf,
  pad,
  personGroups,
  personaOf,
  type ContextState,
  type Env,
  type Planned,
} from "./plan-bank";
import type { PlanSpec, WeekSpec } from "./plan-spec";
import { createRng, deriveSeed, largestRemainder, quota, type Rng } from "./random";
import type { Scenario, SimLang, SimPersona } from "./scenario";
import type { Slot, ValueCategory } from "./slot";

// A day of the plan; the order of the mix is also the order that breaks a tie of the largest remainder.
const mixOrder = [
  "notification",
  "spam",
  "info",
  "needs_reply",
  "delegation",
  "urgent",
] as const satisfies readonly ValueCategory[];
const behaviourOrder = ["done", "late", "out_of_office", "other_address", "silent"] as const;
const urgencyOrder: readonly UrgencySource[] = ["text", "vip", "context"];

const WEEKDAYS = 5;
const DAYS = 7;
const MINUTE_MS = 60_000;
const MIN_PARENT_GAP_MS = 10 * MINUTE_MS;

type Window = readonly [number, number];
// Minutes of the day, end exclusive.
const WEEKDAY_WINDOW: Window = [7 * 60, 20 * 60];
const WEEKEND_WINDOW: Window = [8 * 60, 22 * 60];
const OFF_HOURS_WINDOWS: readonly Window[] = [
  [20 * 60, 24 * 60],
  [5 * 60, 7 * 60],
];

export const weekHistorySchema = z
  .object({
    scenario: z.string(),
    days: z.number().int(),
    senders: z.record(z.string(), senderHistorySchema),
  })
  .strict();
export type WeekHistory = z.infer<typeof weekHistorySchema>;

export interface DayCount {
  // 0 = Monday … 6 = Sunday
  day: number;
  total: number;
  byCategory: Record<ValueCategory, number>;
}

// The mail count of each of the 7 days and its split by category (largest remainder; a tie goes by the mix order).
export function dayCounts(spec: WeekSpec): DayCount[] {
  return Array.from({ length: DAYS }, (_, day) => {
    const total = day < WEEKDAYS ? spec.weekdayMails : spec.weekendMails;
    const counts = largestRemainder(
      mixOrder.map((category) => spec.mix[category]),
      total
    );
    const byCategory = Object.fromEntries(mixOrder.map((category, i) => [category, counts[i] as number])) as Record<
      ValueCategory,
      number
    >;
    return { day, total, byCategory };
  });
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const clock = (minute: number): string => `${pad(Math.floor(minute / 60), 2)}:${pad(minute % 60, 2)}`;

// Hands out the minutes of the week: no two mails share one minute.
class Clock {
  private readonly used = new Set<string>();

  constructor(private readonly timeZone: string) {}

  private take(date: string, minute: number): boolean {
    const key = `${date}T${minute}`;
    if (this.used.has(key)) return false;
    this.used.add(key);
    return true;
  }

  // A uniform minute inside the windows; on a clash the next free minute (wrapping inside the windows).
  draw(rng: Rng, date: string, windows: readonly Window[]): Date {
    const total = windows.reduce((sum, [from, to]) => sum + (to - from), 0);
    const start = rng.int(total);
    for (let step = 0; step < total; step++) {
      let offset = (start + step) % total;
      for (const [from, to] of windows) {
        if (offset >= to - from) {
          offset -= to - from;
          continue;
        }
        const minute = from + offset;
        if (this.take(date, minute)) return localToInstant(date, clock(minute), this.timeZone);
        break;
      }
    }
    throw new Error(`no free minute on ${date}`);
  }

  // A mail `minHours` to `maxHours` after `from`, at a normal hour of its day, on a free minute.
  after(rng: Rng, from: Date, minHours: number, maxHours: number, lastDate: string): Date {
    for (let tries = 0; tries < 500; tries++) {
      const at = new Date(from.getTime() + (minHours * 60 + rng.int((maxHours - minHours) * 60 + 1)) * MINUTE_MS);
      const local = localDateTime(at, this.timeZone);
      const [low, high] = local.weekday >= 1 && local.weekday <= 5 ? WEEKDAY_WINDOW : WEEKEND_WINDOW;
      const minute = Number(local.time.slice(0, 2)) * 60 + Number(local.time.slice(3, 5));
      if (local.date > lastDate || minute < low || minute >= high) continue;
      if (this.take(local.date, minute)) return at;
    }
    throw new Error("no free minute for a reply");
  }
}

interface Timed extends Planned {
  at: Date;
}

// The planned mails of the days (categories, hard cases and times); ids are temporary until the week is sorted.
function planDays(scenario: Scenario, spec: PlanSpec, dates: readonly string[], clockOfWeek: Clock): Timed[] {
  const { week } = spec;
  const ruleOf = (id: string): HardCaseRule => hardCaseRules.find((r) => r.id === id) as HardCaseRule;
  const phishing = hardCaseRules.filter((r) => r.id.startsWith("phishing_"));
  const plans: Timed[] = [];
  dayCounts(week).forEach(({ day, total, byCategory }) => {
    const date = dates[day] as string;
    const rng = createRng(deriveSeed(spec.seed, `week:${day + 1}`));
    const rules: Partial<Record<ValueCategory, HardCaseRule[]>> =
      day < WEEKDAYS
        ? { spam: phishing, notification: [ruleOf("auto_reply"), ruleOf("auto_reply"), ruleOf("bounce")] }
        : {};
    for (const [category, list] of Object.entries(rules) as [ValueCategory, HardCaseRule[]][]) {
      if (byCategory[category] < list.length) {
        throw new Error(
          `day ${day + 1} has ${byCategory[category]} ${category} slots; the hard cases need ${list.length}`
        );
      }
    }
    const categories = mixOrder.flatMap((category) => Array.from({ length: byCategory[category] }, () => category));
    const taken: Record<string, number> = {};
    const entries = categories.map((category) => {
      const list = rules[category];
      const next = taken[category] ?? 0;
      const rule = list?.[next];
      if (rule) taken[category] = next + 1;
      return { category, ...(rule ? { rule } : {}) };
    });
    // Off hours only on weekdays; a weekend day spreads over 08:00–22:00.
    const off =
      day < WEEKDAYS ? (largestRemainder([week.offHoursShare, 1 - week.offHoursShare], total)[0] as number) : 0;
    const hours = rng.shuffle([
      ...Array.from({ length: off }, () => true),
      ...Array.from({ length: total - off }, () => false),
    ]);
    entries.forEach((entry, index) => {
      const windows = hours[index] ? OFF_HOURS_WINDOWS : [day < WEEKDAYS ? WEEKDAY_WINDOW : WEEKEND_WINDOW];
      plans.push({ id: `t-${day + 1}-${pad(index + 1, 3)}`, ...entry, at: clockOfWeek.draw(rng, date, windows) });
    });
  });
  return plans;
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
  return groups;
}

interface Built {
  slot: Omit<Slot, "batch">;
  at: Date;
}

// Builds the slots of one group with the draws of the whole week for language and urgency source.
function buildGroup(
  env: Env,
  key: string,
  plans: readonly Timed[],
  fixed: { lang: Map<string, SimLang>; source: Map<string, UrgencySource> }
): Built[] {
  const sorted = [...plans].sort((a, b) => (a.id < b.id ? -1 : 1));
  const rng = createRng(deriveSeed(env.spec.seed, `week:group:${key}`));
  const draws = groupDraws(env.scenario, env.spec, sorted, rng);
  draws.langs = sorted.map((plan) => fixed.lang.get(plan.id) as SimLang);
  draws.sources = sorted.map((plan) => fixed.source.get(plan.id));
  // Week threads are chains of mails with a parent (below), not the earlier mails of a bank slot.
  draws.threads = sorted.map(() => false);
  const context: ContextState = { next: 0 };
  return sorted.map((plan, index) => ({
    slot: buildSlot(env, plan, index, draws, rng, context, plan.at.toISOString()),
    at: plan.at,
  }));
}

const cut = (text: string, max: number): string => (text.length <= max ? text : text.slice(0, max));

function sentSlot(
  env: Env,
  rng: Rng,
  id: string,
  at: Date,
  to: SimPersona,
  topic: Scenario["topics"][number]
): Omit<Slot, "batch"> {
  const { scenario } = env;
  const brief = `the executive writes to ${cut(to.displayName, 40)} about ${cut(topic.label, 60)} and asks for a short answer`;
  if (brief.length > BRIEF_MAX) throw new Error(`brief too long: ${brief.length}`);
  return {
    id,
    part: "week",
    persona: scenario.executive.key,
    direction: "sent",
    to: [to.key],
    cc: [],
    lang: to.lang,
    receivedAt: at.toISOString(),
    category: "info",
    topic: topic.key,
    hardCases: [],
    kind: "synthetic",
    style: {
      length: rng.pick(["short", "medium"] as const),
      format: "plain",
      signature: false,
      greeting: greetingOf(to, rng),
    },
    headers: {},
    attachments: [],
    thread: [],
    brief,
  };
}

function topicOf(scenario: Scenario, persona: SimPersona, rng: Rng): Scenario["topics"][number] {
  const mine = scenario.topics.filter((t) => t.personas.includes(persona.key));
  return rng.pick(mine.length > 0 ? mine : scenario.topics);
}

interface Node {
  slot: Omit<Slot, "batch">;
  at: Date;
  depth: number;
  root: string;
}

// An earlier incoming mail of the same topic from the same person (the executive is the other end).
// A thread the executive started gets only its planned reply, so a thread planned as dropped stays dropped.
function parentsOf(slot: Omit<Slot, "batch">, at: Date, nodes: readonly Node[], maxDepth: number): Node[] {
  if (slot.topic === undefined) return [];
  return nodes.filter(
    ({ slot: p, at: pAt, depth }) =>
      depth < maxDepth &&
      p.direction === "in" &&
      p.persona === slot.persona &&
      p.topic === slot.topic &&
      pAt.getTime() <= at.getTime() - MIN_PARENT_GAP_MS
  );
}

export function planWeek(scenario: Scenario, spec: PlanSpec): { slots: Slot[]; history: WeekHistory } {
  const { week, seed } = spec;
  const { timeZone } = scenario.executive;
  const dates = Array.from({ length: DAYS }, (_, i) => addDays(scenario.calendar.weekStart, i));
  const env: Env = {
    scenario,
    spec,
    part: "week",
    persons: new Map(scenario.personas.map((p) => [p.key, p])),
  };
  const clockOfWeek = new Clock(timeZone);

  // 1. The mix of the days.
  const plans = planDays(scenario, spec, dates, clockOfWeek);
  const ordered = [...plans].sort((a, b) => (a.id < b.id ? -1 : 1));
  const lang = new Map<string, SimLang>();
  quota(
    createRng(deriveSeed(seed, "week:lang")),
    ["pl", "en"] as const,
    [week.langShare.pl, week.langShare.en],
    ordered.length
  ).forEach((value, i) => lang.set((ordered[i] as Timed).id, value));
  const urgent = ordered.filter((plan) => plan.category === "urgent");
  const source = new Map<string, UrgencySource>();
  quota(createRng(deriveSeed(seed, "week:urgency")), urgencyOrder, [0.5, 0.25, 0.25], urgent.length).forEach(
    (value, i) => source.set((urgent[i] as Timed).id, value)
  );

  const built: Built[] = [];
  for (const [key, group] of groupBy(plans, (plan) => plan.rule?.id ?? plan.category)) {
    built.push(...buildGroup(env, key, group, { lang, source }));
  }

  // 2. Delegate behaviours, over the week's delegation slots.
  const delegation = built
    .filter(({ slot }) => slot.category === "delegation")
    .sort((a, b) => (a.slot.id < b.slot.id ? -1 : 1));
  const behaviours = createRng(deriveSeed(seed, "week:behaviour")).shuffle(
    largestRemainder(
      behaviourOrder.map((name) => week.behaviour[name]),
      delegation.length
    ).flatMap((count, i) => Array.from({ length: count }, () => behaviourOrder[i] as (typeof behaviourOrder)[number]))
  );
  delegation.forEach(({ slot }, i) => {
    slot.delegateBehaviour = behaviours[i] as (typeof behaviourOrder)[number];
  });

  // 3. Threads the executive started (sent side) and the replies planned for some of them.
  const nodes: Node[] = built.map(({ slot, at }) => ({ slot, at, depth: 1, root: slot.id }));
  const sent: { node: Node; to: SimPersona; topic: string }[] = [];
  const people = scenario.personas.filter((p) => personGroups.includes(p.group));
  for (let day = 0; day < WEEKDAYS; day++) {
    const rng = createRng(deriveSeed(seed, `week:${day + 1}:sent`));
    for (let n = 0; n < week.sentThreadsPerWeekday; n++) {
      const to = rng.pick(people);
      const topic = topicOf(scenario, to, rng);
      const at = clockOfWeek.draw(rng, dates[day] as string, [WEEKDAY_WINDOW]);
      const id = `t-s-${day + 1}-${pad(n + 1, 2)}`;
      const node: Node = { slot: sentSlot(env, rng, id, at, to, topic), at, depth: 1, root: id };
      nodes.push(node);
      sent.push({ node, to, topic: topic.key });
    }
  }
  const replyRng = createRng(deriveSeed(seed, "week:sent-replies"));
  const answered = largestRemainder([2, 1], sent.length)[0] as number;
  const replyPlans: Timed[] = [];
  const parentOf = new Map<string, Node>();
  replyRng
    .shuffle(sent)
    .slice(0, answered)
    .forEach(({ node, to, topic }, i) => {
      const id = `t-r-${pad(i + 1, 3)}`;
      const at = clockOfWeek.after(replyRng, node.at, 4, 48, dates[DAYS - 1] as string);
      replyPlans.push({ id, category: replyRng.pick(["needs_reply", "info"] as const), persona: to.key, topic, at });
      parentOf.set(id, node);
    });
  const replyLang = new Map(replyPlans.map((plan) => [plan.id, personaOf(env, plan.persona as string).lang]));
  for (const { slot, at } of buildGroup(env, "sent-reply", replyPlans, { lang: replyLang, source: new Map() })) {
    const parent = parentOf.get(slot.id) as Node;
    slot.parentId = parent.slot.id;
    slot.threadId = parent.root;
    nodes.push({ slot, at, depth: parent.depth + 1, root: parent.root });
  }

  // 4. Replies in threads: a share of the person mail answers an earlier mail of its exchange.
  const timeOrder = [...nodes].sort((a, b) => a.at.getTime() - b.at.getTime());
  const personal = timeOrder.filter(
    ({ slot }) =>
      slot.direction === "in" &&
      slot.parentId === undefined &&
      slot.hardCases.length === 0 &&
      personGroups.includes(personaOf(env, slot.persona).group)
  );
  const wanted = Math.round(week.replyShare * personal.length);
  const eligible = personal.filter(
    (node) => parentsOf(node.slot, node.at, timeOrder, week.maxThreadDepth + 1).length > 0
  );
  const threadRng = createRng(deriveSeed(seed, "week:threads"));
  const replying = new Set(threadRng.shuffle(eligible).slice(0, wanted));
  for (const node of timeOrder) {
    if (!replying.has(node)) continue;
    const parents = parentsOf(node.slot, node.at, timeOrder, week.maxThreadDepth);
    if (parents.length === 0) continue;
    const parent = threadRng.pick(parents);
    node.slot.parentId = parent.slot.id;
    node.slot.threadId = parent.root;
    node.depth = parent.depth + 1;
    node.root = parent.root;
  }
  // A root with a reply names itself as the thread.
  const roots = new Set(nodes.filter(({ slot }) => slot.parentId !== undefined).map(({ root }) => root));
  for (const node of nodes) if (roots.has(node.slot.id)) node.slot.threadId = node.slot.id;

  // 5. Final ids by local day and time, and the batches.
  const byTime = [...nodes].sort((a, b) => a.at.getTime() - b.at.getTime());
  const perDay = new Map<string, number>();
  const finalId = new Map<string, string>();
  for (const { slot, at } of byTime) {
    const date = localDateTime(at, timeZone).date;
    const day = dates.indexOf(date) + 1;
    if (day < 1) throw new Error(`mail ${slot.id} falls on ${date}, outside the week`);
    const count = (perDay.get(date) ?? 0) + 1;
    perDay.set(date, count);
    finalId.set(slot.id, `w-${day}-${pad(count, 3)}`);
  }
  const slots = byTime.map(({ slot }) => ({
    ...slot,
    id: finalId.get(slot.id) as string,
    batch: "batch-001",
    ...(slot.parentId === undefined ? {} : { parentId: finalId.get(slot.parentId) as string }),
    ...(slot.threadId === undefined ? {} : { threadId: finalId.get(slot.threadId) as string }),
  }));

  return { slots: batchSlots(slots, "week", 1), history: weekHistory(scenario, spec, slots) };
}

// A sender that is new in the week has no history.
const newSender = (days: number): SenderHistory => ({
  days,
  received: 0,
  byCategory: {},
  corrections: {},
  movedBack: 0,
  answered: 0,
  flagged: 0,
  unseen7d: 0,
  userMailsTo: 0,
  lastUserMailDaysAgo: null,
  delegationsTo: 0,
  bulkSignals: [],
  firstSeenDaysAgo: null,
  lastSeenDaysAgo: null,
  medianUserReplyHours: null,
  medianTheirReplyHours: null,
  relation: "new",
});

// The prior history of every sender of an incoming mail of the week, keyed by the address it writes from (counts and flags only).
function weekHistory(scenario: Scenario, spec: PlanSpec, slots: readonly Slot[]): WeekHistory {
  const days = spec.week.historyDays;
  const persons = new Map(scenario.personas.map((p) => [p.key, p]));
  const senders = new Map<string, SimPersona>();
  for (const slot of slots) {
    if (slot.direction !== "in") continue;
    const persona = persons.get(slot.persona) as SimPersona;
    senders.set(slot.fromOverride ?? persona.address, persona);
  }
  const out: Record<string, SenderHistory> = {};
  for (const address of [...senders.keys()].sort()) {
    const persona = senders.get(address) as SimPersona;
    out[address] =
      persona.group === "phishing" || persona.group === "spammer"
        ? newSender(days)
        : senderHistoryFor(persona, scenario, createRng(deriveSeed(spec.seed, `week:history:${address}`)), days);
  }
  return { scenario: scenario.id, days, senders: out };
}
