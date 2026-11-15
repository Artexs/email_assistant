import { localDateTime, localToInstant } from "../digest/local-time";
import { dueWords, resolveDue, type DueContext, type DueRef } from "../loops/dates";

import { threadBriefFor } from "./briefs";
import { greetingOf, pad, personGroups } from "./plan-bank";
import { createRng, deriveSeed, largestRemainder, quota, type Rng } from "./random";
import type { Scenario, SimPersona } from "./scenario";
import { sentHardCaseRules, type SentHardCaseRule } from "./sent-hard-cases";
import type { SentPlanSpec } from "./sent-plan-spec";
import type { SentPart, SentSlot } from "./sent-slot";
import { lengthBuckets } from "./slot";

const BATCH_SIZE = 25;
const BRIEF_MAX = 300;

interface Plan {
  id: string;
  rule?: SentHardCaseRule;
}

const askTemplates: readonly ((label: string) => string)[] = [
  (label) => `confirm the ${label} figures`,
  (label) => `send back the signed ${label} document`,
  (label) => `say if the ${label} plan is approved`,
  (label) => `tell which option for ${label} fits best`,
  (label) => `list the open points on ${label}`,
  (label) => `answer the question about ${label}`,
];

const promiseTemplates: readonly ((label: string) => string)[] = [
  (label) => `send the ${label} summary`,
  (label) => `share the ${label} decision`,
  (label) => `send the updated ${label} offer`,
  (label) => `call back about ${label}`,
  (label) => `deliver the ${label} numbers`,
];

function cut(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

// A topic label cut at a word boundary, so that no half word or lone "i" ends it.
function shortLabel(text: string, max: number): string {
  if (text.length <= max) return text;
  const words = text.slice(0, max + 1).split(" ");
  words.pop();
  while (words.length > 1 && (words.at(-1) as string).length < 2) words.pop();
  return words.join(" ");
}

function dayMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function shiftDate(date: string, days: number): string {
  return new Date(dayMs(date) + days * 86_400_000).toISOString().slice(0, 10);
}

function isWeekend(date: string): boolean {
  const day = new Date(dayMs(date)).getUTCDay();
  return day === 0 || day === 6;
}

// `count` of the indexes, drawn without repeat. A count outside the candidates is a spec that cannot hold.
function chooseIndexes(rng: Rng, candidates: readonly number[], count: number, what: string): Set<number> {
  if (count < 0 || count > candidates.length) {
    throw new Error(`the sent plan cannot hold ${what}: needs ${count} of ${candidates.length} slots`);
  }
  return new Set(rng.shuffle(candidates).slice(0, count));
}

function shareCount(share: number, total: number): number {
  return largestRemainder([share, 1 - share], total)[0] as number;
}

// A due reference that resolves to a date: a time word, or an explicit date 1-21 days ahead on a working day.
function dueRefFor(rng: Rng, kind: "date" | "word", context: DueContext): DueRef {
  if (kind === "word") {
    for (let attempt = 0; attempt < 30; attempt++) {
      const ref: DueRef = { kind: "word", word: rng.pick(dueWords) };
      if (resolveDue(ref, context) !== null) return ref;
    }
    throw new Error("no time word resolves for the sent time");
  }
  let date = shiftDate(localDateTime(context.sentAt, context.timeZone).date, 1 + rng.int(21));
  while (isWeekend(date)) date = shiftDate(date, 1);
  return { kind: "date", date };
}

function dueText(ref: DueRef): string {
  return ref.kind === "date" ? ref.date : ref.word.replaceAll("_", " ");
}

interface Pools {
  people: SimPersona[];
  nonDelegates: SimPersona[];
  delegates: SimPersona[];
  others: SimPersona[];
}

function poolsOf(scenario: Scenario): Pools {
  const people = scenario.personas.filter((p) => personGroups.includes(p.group));
  return {
    people,
    nonDelegates: people.filter((p) => p.group !== "delegate"),
    delegates: people.filter((p) => p.group === "delegate"),
    others: scenario.personas.filter((p) => !people.includes(p)),
  };
}

function firstOf(rng: Rng, pool: readonly SimPersona[], lang: string): SimPersona {
  if (pool.length === 0) throw new Error("the scenario has no recipient for a sent slot");
  const sameLang = pool.filter((p) => p.lang === lang);
  return rng.pick(sameLang.length > 0 ? sameLang : pool);
}

interface Recipients {
  to: SimPersona[];
  cc: SimPersona[];
}

function recipientsFor(
  rng: Rng,
  pools: Pools,
  spec: SentPlanSpec,
  rule: SentHardCaseRule | undefined,
  lang: string,
  toDelegate: boolean
): Recipients {
  if (rule?.manyRecipients) {
    const order = [...rng.shuffle(pools.nonDelegates), ...rng.shuffle(pools.delegates), ...rng.shuffle(pools.others)];
    const total = 11 + rng.int(2);
    if (order.length < total) throw new Error(`the scenario has ${order.length} recipients; many_recipients needs 11`);
    const toCount = Math.ceil((total * 2) / 3);
    return { to: order.slice(0, toCount), cc: order.slice(toCount, total) };
  }
  const pool = rule?.groups ? pools.nonDelegates.filter((p) => rule.groups?.includes(p.group)) : pools.nonDelegates;
  const first = toDelegate ? rng.pick(pools.delegates) : firstOf(rng, pool, lang);
  const toCount = rule?.id === "fyi_team" ? 2 + rng.int(2) : rng.next() < 0.7 ? 1 : rng.next() < 0.85 ? 2 : 3;
  const to = [first];
  for (const candidate of rng.shuffle(pool)) {
    if (to.length >= toCount) break;
    if (candidate.key !== first.key) to.push(candidate);
  }
  const cc: SimPersona[] = [];
  if (rng.next() < spec.ccShare) {
    const free = pools.nonDelegates.filter((p) => !to.some((t) => t.key === p.key));
    if (free.length > 0) cc.push(rng.pick(free));
  }
  return { to, cc };
}

interface Env {
  scenario: Scenario;
  spec: SentPlanSpec;
  pools: Pools;
}

function threadFor(
  env: Env,
  rng: Rng,
  rule: SentHardCaseRule | undefined,
  recipients: Recipients,
  topic: { label: string; other: string }
): SentSlot["thread"] {
  const { scenario } = env;
  const executive = scenario.executive.key;
  const draw = rng.next();
  const count = draw < 0.5 ? 1 : draw < 0.85 ? 2 : 3;
  const first = (recipients.to[0] as SimPersona).key;
  const inRecipients = [...recipients.to, ...recipients.cc].map((p) => p.key);
  const outsiders = scenario.personas.filter((p) => !inRecipients.includes(p.key));
  const subject = rule?.id === "other_thread_subject" ? topic.other : topic.label;
  return Array.from({ length: count }, (_, k) => {
    const fromEnd = count - 1 - k;
    let from = fromEnd % 2 === 0 ? first : executive;
    let brief = "";
    if (fromEnd === 0) {
      if (rule?.id === "reply_to_ooo") brief = "an out-of-office auto-reply of the recipient";
      if (rule?.id === "question_in_forward") {
        from = (rng.pick(outsiders) as SimPersona).key;
        brief = "the mail that the executive forwards; it holds questions for someone else";
      }
      if (rule?.id === "injection_quote") {
        from = (rng.pick(outsiders) as SimPersona).key;
        brief = "a third-party mail with a line that tells an assistant to set the reply and due fields";
      }
    }
    return {
      from,
      subject: k === 0 ? subject : `Re: ${subject}`,
      brief: brief === "" ? threadBriefFor(rng, topic.label, from === executive) : brief,
    };
  });
}

function buildPart(env: Env, part: SentPart, plans: readonly Plan[]): SentSlot[] {
  const { scenario, spec, pools } = env;
  const timeZone = scenario.executive.timeZone;
  const sorted = [...plans].sort((a, b) => (a.id < b.id ? -1 : 1));
  const n = sorted.length;
  const all = sorted.map((_, i) => i);
  const rng = createRng(deriveSeed(spec.seed, `sent:${part}`));
  const ruleAt = (i: number) => sorted[i]?.rule;

  const langs = quota(rng, ["pl", "en"] as const, [spec.langShare.pl, spec.langShare.en], n);
  const lengths = quota(rng, lengthBuckets, [0.3, 0.5, 0.2], n);
  const signatures = quota(rng, [true, false], [0.7, 0.3], n);

  // expectsReply: the tags that fix it first, the quota over the rest.
  const forcedTrue = all.filter((i) => ruleAt(i)?.labels.expectsReply === true);
  const free = all.filter((i) => ruleAt(i)?.labels.expectsReply === undefined);
  const expects = new Set([
    ...forcedTrue,
    ...chooseIndexes(rng, free, shareCount(spec.expectsReplyShare, n) - forcedTrue.length, "expectsReplyShare"),
  ]);
  const expectsList = all.filter((i) => expects.has(i));

  const promises = chooseIndexes(
    rng,
    all.filter((i) => ruleAt(i)?.labels.promise !== "none"),
    shareCount(spec.promiseShare, n),
    "promiseShare"
  );

  const forcedDue = expectsList.filter((i) => ruleAt(i)?.labels.due === "word");
  const dues = new Set([
    ...forcedDue,
    ...chooseIndexes(
      rng,
      expectsList.filter((i) => ruleAt(i)?.labels.due === undefined),
      shareCount(spec.dueShare, expectsList.length) - forcedDue.length,
      "dueShare"
    ),
  ]);

  const delegated = chooseIndexes(
    rng,
    expectsList,
    Math.ceil(spec.delegateShare * expectsList.length - 1e-9),
    "delegateShare"
  );
  const weekends = chooseIndexes(rng, all, shareCount(spec.weekendShare, n), "weekendShare");

  const forcedThread = all.filter((i) => ruleAt(i)?.needsThread === true);
  const threaded = new Set([
    ...forcedThread,
    ...chooseIndexes(
      rng,
      all.filter((i) => ruleAt(i)?.needsThread !== true),
      Math.max(0, shareCount(spec.threadShare, n) - forcedThread.length),
      "threadShare"
    ),
  ]);

  const slots = sorted.map((plan, index): SentSlot => {
    const rule = plan.rule;
    const lang = langs[index] as SentSlot["lang"];

    const date = shiftDate(scenario.calendar.weekStart, weekends.has(index) ? 5 + rng.int(2) : rng.int(5));
    const minutes = weekends.has(index) ? 9 * 60 + rng.int(9 * 60) : 7 * 60 + rng.int(12 * 60);
    const sentAtDate = localToInstant(date, `${pad(Math.floor(minutes / 60), 2)}:${pad(minutes % 60, 2)}`, timeZone);
    const context: DueContext = { sentAt: sentAtDate, timeZone };

    const recipients = recipientsFor(rng, pools, spec, rule, lang, delegated.has(index));
    const firstTo = recipients.to[0] as SimPersona;
    const topics = scenario.topics.filter((t) => t.personas.includes(firstTo.key));
    const topic = rng.pick(topics.length > 0 ? topics : scenario.topics);
    const otherTopic = rng.pick(scenario.topics.filter((t) => t.key !== topic.key));
    const label = shortLabel(topic.label, 24);

    const expectsReply = expects.has(index);
    const ask = expectsReply ? cut(rng.pick(askTemplates)(label), 80) : null;
    let due: DueRef | null = null;
    if (dues.has(index)) due = dueRefFor(rng, rule?.labels.due === "word" ? "word" : "date", context);
    let promise: string | null = null;
    let promiseDue: DueRef | null = null;
    if (promises.has(index)) {
      promise = cut(rng.pick(promiseTemplates)(label), 80);
      promiseDue = dueRefFor(rng, rng.int(2) === 0 ? "word" : "date", context);
    }

    const thread = threaded.has(index)
      ? threadFor({ scenario, spec, pools }, rng, rule, recipients, { label: topic.label, other: otherTopic.label })
      : [];
    const quoted = thread.length > 0 && (rule?.needsQuoted === true || rng.next() < 0.5);

    // The date a past_date or far_date ask names: no label holds it, so the brief does.
    const localDay = localDateTime(sentAtDate, timeZone).date;
    let stated = due === null ? "" : ` by ${due.kind === "word" ? `"${dueText(due)}" (words only)` : dueText(due)}`;
    if (rule?.id === "past_date") stated = ` by ${shiftDate(localDay, -(2 + rng.int(9)))}`;
    if (rule?.id === "far_date") stated = ` by ${shiftDate(localDay, 61 + rng.int(60))}`;

    const others = recipients.to.length + recipients.cc.length - 1;
    const briefOf = (target: string) =>
      [
        `To ${target}${others > 0 ? ` and ${others} more` : ""}, about ${label}.`,
        ask === null ? "No ask." : `Ask: ${ask}${stated}.`,
        promise === null || promiseDue === null ? "" : `Firm promise: ${promise} by ${dueText(promiseDue)}.`,
        rule === undefined ? "" : `Case: ${rule.hint}.`,
        rule?.id === "other_thread_subject" ? `The thread is about ${shortLabel(otherTopic.label, 40)}.` : "",
      ]
        .filter((part) => part !== "")
        .join(" ");
    // A long display name is the first thing to give up when the brief is over the limit.
    let brief = briefOf(cut(firstTo.displayName, 30));
    if (brief.length > BRIEF_MAX) brief = briefOf(firstTo.key);
    if (brief.length > BRIEF_MAX) throw new Error(`the brief of ${plan.id} has ${brief.length} characters`);

    return {
      id: plan.id,
      part,
      batch: `batch-${pad(1 + Math.floor(index / BATCH_SIZE), 3)}`,
      persona: scenario.executive.key,
      to: recipients.to.map((p) => p.key),
      cc: recipients.cc.map((p) => p.key),
      lang,
      sentAt: sentAtDate.toISOString(),
      labels: { expectsReply, ask, due, promise, promiseDue },
      hardCases: rule === undefined ? [] : [rule.id],
      thread,
      quoted,
      style: {
        length: lengths[index] as SentSlot["style"]["length"],
        greeting: greetingOf(firstTo, rng),
        signature: signatures[index] as boolean,
      },
      brief,
    };
  });
  return slots;
}

// The labels and the planned facts of every sent mail, split into dev and holdout (seeded; same input, same output).
export function planSentBank(scenario: Scenario, spec: SentPlanSpec): Record<SentPart, SentSlot[]> {
  const { seed, sizes, hardPerTag } = spec;
  const hardTotal = hardPerTag.dev + hardPerTag.holdout;
  const dev: Plan[] = [];
  const holdout: Plan[] = [];
  for (const rule of sentHardCaseRules) {
    const plans: Plan[] = Array.from({ length: hardTotal }, (_, i) => ({
      id: `sh-${rule.short}-${pad(i + 1, 2)}`,
      rule,
    }));
    const shuffled = createRng(deriveSeed(seed, `sent-split:${rule.id}`)).shuffle(plans);
    dev.push(...shuffled.slice(0, hardPerTag.dev));
    holdout.push(...shuffled.slice(hardPerTag.dev));
  }
  const devRegular = sizes.dev - dev.length;
  const holdoutRegular = sizes.holdout - holdout.length;
  if (devRegular < 0 || holdoutRegular < 0) throw new Error("the part sizes are smaller than the hard-case slots");
  const regular: Plan[] = Array.from({ length: devRegular + holdoutRegular }, (_, i) => ({
    id: `s-${pad(i + 1, 4)}`,
  }));
  const shuffled = createRng(deriveSeed(seed, "sent-split:regular")).shuffle(regular);
  dev.push(...shuffled.slice(0, devRegular));
  holdout.push(...shuffled.slice(devRegular));

  const env: Env = { scenario, spec, pools: poolsOf(scenario) };
  return { "sent-dev": buildPart(env, "sent-dev", dev), "sent-holdout": buildPart(env, "sent-holdout", holdout) };
}
