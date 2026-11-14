import { localToInstant } from "../digest/local-time";
import type { SenderHistory } from "../triage/sender-history";
import type { UrgencySource } from "../triage/urgency-profile";

import { briefFor, threadBriefFor } from "./briefs";
import { hardCaseRules, type HardCaseRule, type SlotDraft } from "./hard-cases";
import { senderHistoryFor } from "./history-gen";
import type { PlanSpec } from "./plan-spec";
import { createRng, deriveSeed, quota, type Rng } from "./random";
import type { Scenario, SimLang, SimPersona, SimPersonaGroup } from "./scenario";
import { valueCategories, type SimPart, type Slot, type ValueCategory } from "./slot";

const BATCH_SIZE = 25;
const HISTORY_DAYS = 90;
const BANK_WEEKDAYS = 10;

const categoryShort: Record<ValueCategory, string> = {
  urgent: "urg",
  needs_reply: "rep",
  delegation: "del",
  info: "inf",
  notification: "not",
  spam: "spa",
};

// Sender groups by category (rule 2).
const categoryGroups: Record<ValueCategory, readonly SimPersonaGroup[]> = {
  urgent: ["boss", "team", "client", "partner"],
  needs_reply: ["boss", "team", "client", "partner", "vendor"],
  delegation: ["boss", "client", "partner", "vendor", "team"],
  info: ["team", "boss", "partner", "client", "newsletter"],
  notification: ["system", "newsletter"],
  spam: ["marketing", "spammer", "phishing"],
};
// An urgent mail whose urgency comes from the profile context: any person writes it.
const contextGroups: readonly SimPersonaGroup[] = ["boss", "team", "client", "partner", "vendor"];
const personGroups: readonly SimPersonaGroup[] = ["boss", "team", "delegate", "client", "partner", "vendor"];
const listGroups: readonly SimPersonaGroup[] = ["newsletter", "marketing"];
const noGreetingGroups: readonly SimPersonaGroup[] = ["system", "newsletter", "marketing", "spammer", "phishing"];

const urgencyWeights = [0.5, 0.25, 0.25];
const urgencyOrder: readonly UrgencySource[] = ["text", "vip", "context"];

interface Planned {
  id: string;
  category: ValueCategory;
  rule?: HardCaseRule;
}

interface Env {
  scenario: Scenario;
  spec: PlanSpec;
  part: SimPart;
  persons: Map<string, SimPersona>;
  histories: Map<string, SenderHistory>;
}

interface GroupDraws {
  langs: SimLang[];
  lengths: Slot["style"]["length"][];
  formats: Slot["style"]["format"][];
  signatures: boolean[];
  threads: boolean[];
  sources: (UrgencySource | undefined)[];
}

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

function personaOf(env: Env, key: string): SimPersona {
  const found = env.persons.get(key);
  if (!found) throw new Error(`unknown persona: ${key}`);
  return found;
}

function senderDomain(persona: SimPersona): string {
  return persona.address.split("@")[1] as string;
}

function pickSender(rng: Rng, scenario: Scenario, groups: readonly SimPersonaGroup[], lang: SimLang): SimPersona {
  const group = rng.pick(groups);
  const pool = scenario.personas.filter((p) => p.group === group);
  if (pool.length === 0) throw new Error(`scenario has no persona of group ${group}`);
  const sameLang = pool.filter((p) => p.lang === lang);
  return rng.pick(sameLang.length > 0 ? sameLang : pool);
}

function greetingOf(persona: SimPersona, rng: Rng): Slot["style"]["greeting"] {
  if (noGreetingGroups.includes(persona.group)) return "none";
  if (persona.group === "team" || persona.group === "delegate") return "informal";
  if (persona.group === "boss") return rng.next() < 0.5 ? "formal" : "informal";
  return "formal";
}

// List headers of a newsletter or marketing sender (X1): the reserved host of the sender.
function listHeaders(persona: SimPersona, rng: Rng): Record<string, string> {
  if (!listGroups.includes(persona.group)) return {};
  const domain = senderDomain(persona);
  return {
    "List-Id": `<${persona.key}.lists.${domain}>`,
    "List-Unsubscribe": `<https://lists.${domain}/u/${1000 + rng.int(9000)}>`,
  };
}

function groupDraws(scenario: Scenario, spec: PlanSpec, plans: readonly Planned[], rng: Rng): GroupDraws {
  const n = plans.length;
  const { langShare, threadShare } = spec.bank;
  const rule = plans[0]?.rule;
  const langs: SimLang[] = rule?.lang
    ? Array.from({ length: n }, () => rule.lang as SimLang)
    : quota(rng, ["pl", "en"] as const, [langShare.pl, langShare.en], n);
  const urgentCount = plans.filter((p) => p.category === "urgent").length;
  const urgent: UrgencySource[] =
    rule?.id === "urgent_no_keyword"
      ? Array.from({ length: urgentCount }, () => "text" as const)
      : quota(rng, urgencyOrder, urgencyWeights, urgentCount);
  const sources = plans.map((p) => (p.category === "urgent" ? urgent.shift() : undefined));
  return {
    langs,
    lengths: quota(rng, ["short", "medium", "long"] as const, [0.3, 0.5, 0.2], n),
    formats: quota(rng, ["html", "plain"] as const, [0.15, 0.85], n),
    signatures: quota(rng, [true, false], [0.7, 0.3], n),
    threads: quota(rng, [true, false], [threadShare, 1 - threadShare], n),
    sources,
  };
}

function weekdayDates(bankStart: string): string[] {
  const start = Date.parse(`${bankStart}T00:00:00Z`);
  return Array.from({ length: BANK_WEEKDAYS }, (_, i) => {
    const offset = Math.floor(i / 5) * 7 + (i % 5);
    return new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
  });
}

function receivedAt(scenario: Scenario, rng: Rng, preferredDate?: string): string {
  const dates = weekdayDates(scenario.calendar.bankStart);
  const drawn = rng.int(BANK_WEEKDAYS);
  const minutes = rng.int(12 * 60);
  const preferred = preferredDate === undefined ? -1 : dates.indexOf(preferredDate);
  const date = dates[preferred >= 0 ? preferred : drawn] as string;
  const time = `${pad(7 + Math.floor(minutes / 60), 2)}:${pad(minutes % 60, 2)}`;
  return localToInstant(date, time, scenario.executive.timeZone).toISOString();
}

function threadFor(env: Env, rng: Rng, persona: SimPersona, label: string): Slot["thread"] {
  const { scenario } = env;
  const topic = scenario.topics.find((t) => t.personas.includes(persona.key));
  const others = (topic?.personas ?? []).filter((key) => key !== persona.key);
  const first = rng.pick([scenario.executive.key, ...others]);
  const entries: Slot["thread"] = [
    { persona: first, brief: threadBriefFor(rng, label, first === scenario.executive.key) },
  ];
  if (rng.int(2) === 1) {
    const second = first === scenario.executive.key ? persona.key : scenario.executive.key;
    entries.push({ persona: second, brief: threadBriefFor(rng, label, second === scenario.executive.key) });
  }
  return entries;
}

interface ContextState {
  next: number;
}

function buildSlot(
  env: Env,
  plan: Planned,
  index: number,
  draws: GroupDraws,
  rng: Rng,
  context: ContextState
): Omit<Slot, "batch"> {
  const { scenario, part } = env;
  const { category, rule } = plan;
  const lang = draws.langs[index] as SimLang;
  const urgencySource = draws.sources[index];

  let persona: SimPersona;
  let contextRef: Slot["contextRef"];
  let label: string;
  let due: string | undefined;
  let topicKey: string | undefined;
  if (urgencySource === "vip") {
    const vips = scenario.urgency.vip.map((key) => personaOf(env, key));
    if (vips.length === 0) throw new Error("the scenario has no VIP persona for the vip urgency source");
    const sameLang = vips.filter((p) => p.lang === lang);
    persona = rng.pick(sameLang.length > 0 ? sameLang : vips);
  } else if (urgencySource === "context") {
    persona = pickSender(rng, scenario, contextGroups, lang);
  } else {
    persona = pickSender(rng, scenario, rule?.group ?? categoryGroups[category], lang);
  }

  if (urgencySource === "context") {
    const { topics, deadlines } = scenario.urgency.profile;
    const wantTopic = context.next % 2 === 0 ? topics.length > 0 : deadlines.length === 0;
    if (topics.length === 0 && deadlines.length === 0) throw new Error("the urgency profile has no topic or deadline");
    const list = wantTopic ? topics : deadlines;
    const at = Math.floor(context.next / 2) % list.length;
    context.next += 1;
    contextRef = { kind: wantTopic ? "topic" : "deadline", index: at };
    label = (list[at] as { label: string }).label;
    if (!wantTopic) due = deadlines[at]?.due;
  } else {
    const mine = scenario.topics.filter((t) => t.personas.includes(persona.key));
    const topic = rng.pick(mine.length > 0 ? mine : scenario.topics);
    topicKey = topic.key;
    label = topic.label;
  }

  const delegate = category === "delegation" ? rng.pick(scenario.delegates) : undefined;
  const style: Slot["style"] = {
    length: draws.lengths[index] as Slot["style"]["length"],
    format: draws.formats[index] as Slot["style"]["format"],
    signature: (draws.signatures[index] as boolean) && persona.signature !== "",
    greeting: greetingOf(persona, rng),
  };
  const baseHeaders = listHeaders(persona, rng);
  const person = personGroups.includes(persona.group);
  const thread = person && draws.threads[index] ? threadFor(env, rng, persona, label) : [];

  let draft: SlotDraft = {
    persona: persona.key,
    direction: "in",
    to: [scenario.executive.key],
    cc: [],
    lang,
    category,
    ...(urgencySource === undefined ? {} : { urgencySource }),
    ...(contextRef === undefined ? {} : { contextRef }),
    ...(topicKey === undefined ? {} : { topic: topicKey }),
    hardCases: rule ? [rule.id] : [],
    kind: rule?.kind ?? "synthetic",
    ...(delegate === undefined ? {} : { expectedDelegate: delegate.persona, expectedDraft: "delegation" as const }),
    style,
    headers: baseHeaders,
    attachments: [],
    thread,
    brief: briefFor(rng, {
      category,
      ...(urgencySource === undefined ? {} : { urgencySource }),
      label,
      ...(due === undefined ? {} : { due }),
      senderName: persona.displayName,
      ...(delegate === undefined ? {} : { tag: delegate.tags[0] as string }),
    }),
  };

  if (rule) draft = rule.apply(draft, { scenario, rng });

  // A rule may replace the sender (bounce, vip_looks_like_spam): the facts of the sender follow the final persona.
  const final = personaOf(env, draft.persona);
  if (final.key !== persona.key) {
    const headers = Object.fromEntries(
      Object.entries(draft.headers).filter(([name, value]) => baseHeaders[name] !== value)
    );
    draft = {
      ...draft,
      headers: { ...headers, ...listHeaders(final, rng) },
      style: {
        ...draft.style,
        signature: style.signature && final.signature !== "",
        greeting: greetingOf(final, rng),
      },
    };
  }

  const historyKey = final.key;
  let senderHistory = env.histories.get(historyKey);
  if (!senderHistory) {
    const historyRng = createRng(deriveSeed(env.spec.seed, `${part}:history:${final.key}`));
    senderHistory = senderHistoryFor(final, scenario, historyRng, HISTORY_DAYS);
    env.histories.set(historyKey, senderHistory);
  }

  return {
    ...draft,
    id: plan.id,
    part,
    receivedAt: receivedAt(scenario, rng, due),
    senderHistory,
  };
}

function buildPart(scenario: Scenario, spec: PlanSpec, part: SimPart, plans: readonly Planned[]): Slot[] {
  const env: Env = {
    scenario,
    spec,
    part,
    persons: new Map(scenario.personas.map((p) => [p.key, p])),
    histories: new Map(),
  };
  const groups = new Map<string, Planned[]>();
  for (const plan of plans) {
    const key = plan.rule?.id ?? plan.category;
    groups.set(key, [...(groups.get(key) ?? []), plan]);
  }
  const slots: Slot[] = [];
  for (const [key, group] of groups) {
    const sorted = [...group].sort((a, b) => (a.id < b.id ? -1 : 1));
    const rng = createRng(deriveSeed(spec.seed, `${part}:${key}`));
    const draws = groupDraws(scenario, spec, sorted, rng);
    const context: ContextState = { next: 0 };
    sorted.forEach((plan, index) => {
      slots.push({ ...buildSlot(env, plan, index, draws, rng, context), batch: "batch-001" });
    });
  }
  return batchSlots(slots, part, 1);
}

// Sets `part` and `batch` (batch-NNN from `startIndex`, 25 slots per batch) in id order.
export function batchSlots(slots: readonly Slot[], part: SimPart, startIndex: number): Slot[] {
  return [...slots]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((slot, index) => ({
      ...slot,
      part,
      batch: `batch-${pad(startIndex + Math.floor(index / BATCH_SIZE), 3)}`,
    }));
}

function splitPlans(seed: number, label: string, plans: Planned[], devCount: number) {
  const shuffled = createRng(deriveSeed(seed, `split:${label}`)).shuffle(plans);
  return { dev: shuffled.slice(0, devCount), holdout: shuffled.slice(devCount) };
}

// The label and the planned facts of every bank mail, split into dev and holdout (seeded; same input, same output).
export function planBank(scenario: Scenario, spec: PlanSpec): { dev: Slot[]; holdout: Slot[] } {
  const { bank, seed } = spec;
  const dev: Planned[] = [];
  const holdout: Planned[] = [];

  for (const category of valueCategories) {
    const total = bank.devPerCategory + bank.holdoutPerCategory;
    const plans = Array.from({ length: total }, (_, i) => ({
      id: `b-${categoryShort[category]}-${pad(i + 1, 4)}`,
      category,
    }));
    const split = splitPlans(seed, category, plans, bank.devPerCategory);
    dev.push(...split.dev);
    holdout.push(...split.holdout);
  }

  for (const rule of hardCaseRules) {
    const total = rule.replyInjection ? bank.replyInjectionPerTag : bank.hardPerTag;
    const devCount = rule.replyInjection ? bank.replyInjectionDevPerTag : bank.hardDevPerTag;
    const plans = Array.from({ length: total }, (_, i) => ({
      id: `h-${rule.short}-${pad(i + 1, 2)}`,
      category: rule.categories[i % rule.categories.length] as ValueCategory,
      rule,
    }));
    const split = splitPlans(seed, rule.id, plans, devCount);
    dev.push(...split.dev);
    holdout.push(...split.holdout);
  }

  return { dev: buildPart(scenario, spec, "dev", dev), holdout: buildPart(scenario, spec, "holdout", holdout) };
}
