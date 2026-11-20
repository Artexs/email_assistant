import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { localDateTime } from "../digest/local-time";
import { resolveDue, type DueRef } from "../loops/dates";
import { DAY_MS } from "../time";

import { miniScenario, miniSentPlanSpec } from "./fixtures";
import { personGroups } from "./plan-bank";
import { planSentBank } from "./plan-sent";
import { scenarioSchema, type Scenario } from "./scenario";
import { sentHardCaseRules } from "./sent-hard-cases";
import { sentPlanSpecSchema } from "./sent-plan-spec";
import { sentSlotSchema, type SentSlot } from "./sent-slot";

const labDir = join(import.meta.dir, "../../../../evals/sim/lab-01");
const readJson = (name: string): unknown => JSON.parse(readFileSync(join(labDir, name), "utf8"));
const scenario: Scenario = scenarioSchema.parse(readJson("scenario.json"));
const spec = sentPlanSpecSchema.parse(readJson("sent-plan-spec.json"));
const bank = planSentBank(scenario, spec);
const dev = bank["sent-dev"];
const holdout = bank["sent-holdout"];
const timeZone = scenario.executive.timeZone;
const delegateKeys = scenario.delegates.map((d) => d.persona);

const share = (slots: SentSlot[], predicate: (slot: SentSlot) => boolean) => slots.filter(predicate).length;
const expecting = (slots: SentSlot[]) => slots.filter((s) => s.labels.expectsReply);
const withTag = (slots: SentSlot[], tag: string) => slots.filter((s) => s.hardCases.includes(tag));

describe("planSentBank", () => {
  test("T5 the same seed gives byte-equal slots twice; another seed differs", () => {
    expect(JSON.stringify(planSentBank(scenario, spec))).toBe(JSON.stringify(bank));
    expect(JSON.stringify(planSentBank(scenario, { ...spec, seed: spec.seed + 1 }))).not.toBe(JSON.stringify(bank));
  });

  test("the sizes are 50 dev and 250 holdout, 25 slots per batch, and every slot is valid", () => {
    expect([dev.length, holdout.length]).toEqual([50, 250]);
    for (const [part, slots] of [
      ["sent-dev", dev],
      ["sent-holdout", holdout],
    ] as const) {
      for (const slot of slots) {
        expect(sentSlotSchema.parse(slot)).toEqual(slot);
        expect(slot.part).toBe(part);
      }
      const perBatch = new Map<string, number>();
      for (const slot of slots) perBatch.set(slot.batch, (perBatch.get(slot.batch) ?? 0) + 1);
      expect([...perBatch.values()].every((count) => count === 25)).toBe(true);
    }
    expect(holdout.at(-1)?.batch).toBe("batch-010");
  });

  test("T6 the language share is 60% pl in each part (±1)", () => {
    expect(Math.abs(share(holdout, (s) => s.lang === "pl") - 150)).toBeLessThanOrEqual(1);
    expect(Math.abs(share(dev, (s) => s.lang === "pl") - 30)).toBeLessThanOrEqual(1);
  });

  test("T6 expectsReply 50%, dated promise 25%, stated due 30% of the expectsReply cases", () => {
    for (const slots of [dev, holdout]) {
      const n = slots.length;
      expect(Math.abs(expecting(slots).length - n / 2)).toBeLessThanOrEqual(1);
      expect(Math.abs(share(slots, (s) => s.labels.promise !== null) - n * 0.25)).toBeLessThanOrEqual(1);
      const asks = expecting(slots);
      expect(Math.abs(share(asks, (s) => s.labels.due !== null) - asks.length * 0.3)).toBeLessThanOrEqual(1);
    }
    expect(expecting(holdout)).toHaveLength(125);
    expect(share(holdout, (s) => s.labels.promise !== null)).toBe(63);
    expect(share(expecting(holdout), (s) => s.labels.due !== null)).toBe(38);
  });

  test("T6 at least 15% of the expectsReply cases go to a delegate (D8); no other slot has one as first recipient", () => {
    for (const slots of [dev, holdout]) {
      const asks = expecting(slots);
      const toDelegate = (s: SentSlot) => delegateKeys.includes(s.to[0] as string);
      expect(share(asks, toDelegate)).toBeGreaterThanOrEqual(Math.ceil(asks.length * 0.15));
      expect(
        share(
          slots.filter((s) => !s.labels.expectsReply && s.hardCases[0] !== "many_recipients"),
          toDelegate
        )
      ).toBe(0);
    }
  });

  test("T6 sentAt is inside the scenario week, 20% on the weekend, between 07:00 and 19:00 local", () => {
    const { weekStart } = scenario.calendar;
    const end = Date.parse(`${weekStart}T00:00:00Z`) + 8 * DAY_MS;
    for (const slot of holdout) {
      const local = localDateTime(new Date(slot.sentAt), timeZone);
      expect(Date.parse(`${local.date}T00:00:00Z`)).toBeGreaterThanOrEqual(Date.parse(`${weekStart}T00:00:00Z`));
      expect(Date.parse(`${local.date}T00:00:00Z`)).toBeLessThan(end - DAY_MS);
      expect(local.time >= "07:00" && local.time < "19:00").toBe(true);
    }
    const weekend = (s: SentSlot) => [0, 6].includes(localDateTime(new Date(s.sentAt), timeZone).weekday);
    expect(share(holdout, weekend)).toBe(50);
    expect(share(dev, weekend)).toBe(10);
  });

  test("T7 no slot id repeats across the parts", () => {
    const ids = [...dev, ...holdout].map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^(s-\d{4}|sh-[a-z]{2,4}-\d{2})$/.test(id))).toBe(true);
  });

  test("T8 every hard-case tag meets its floor: 6 in holdout, 1 in dev", () => {
    for (const rule of sentHardCaseRules) {
      expect(withTag(holdout, rule.id).length).toBeGreaterThanOrEqual(6);
      expect(withTag(dev, rule.id).length).toBeGreaterThanOrEqual(1);
    }
  });

  test("T4 conditional_promise slots never carry a promise; the other tags keep their label rule", () => {
    for (const slots of [dev, holdout]) {
      for (const slot of withTag(slots, "conditional_promise")) {
        expect(slot.labels.promise).toBeNull();
        expect(slot.labels.promiseDue).toBeNull();
      }
      for (const tag of ["thanks_only", "fyi_team", "reported_speech", "many_recipients"]) {
        for (const slot of withTag(slots, tag)) expect(slot.labels.expectsReply).toBe(false);
      }
      for (const tag of ["past_date", "far_date"]) {
        for (const slot of withTag(slots, tag)) {
          expect(slot.labels.expectsReply).toBe(true);
          expect(slot.labels.due).toBeNull();
        }
      }
      for (const slot of withTag(slots, "time_word_due")) expect(slot.labels.due?.kind).toBe("word");
    }
  });

  test("the structure of the tags: threads, quotes, recipients", () => {
    for (const slot of withTag(holdout, "many_recipients")) {
      expect(slot.to.length + slot.cc.length).toBeGreaterThan(10);
      expect(slot.to.length).toBeLessThanOrEqual(12);
    }
    for (const tag of ["question_in_forward", "reply_to_ooo", "other_thread_subject", "injection_quote"]) {
      for (const slot of withTag(holdout, tag)) expect(slot.thread.length).toBeGreaterThan(0);
    }
    for (const tag of ["question_in_forward", "injection_quote"]) {
      for (const slot of withTag(holdout, tag)) expect(slot.quoted).toBe(true);
    }
    // The brief names the topic of the mail ("about <label>."); the thread subject starts with it, except for this tag.
    const topicOf = (slot: SentSlot) => slot.brief.match(/, about (.+?)\. /)?.[1] as string;
    for (const slot of withTag(holdout, "other_thread_subject")) {
      expect(slot.brief).toContain("The thread is about");
      expect(slot.thread[0]?.subject.startsWith(topicOf(slot))).toBe(false);
    }
    const plain = holdout.filter((s) => s.thread.length > 0 && !s.hardCases.includes("other_thread_subject"));
    expect(plain.length).toBeGreaterThan(30);
    for (const slot of plain) expect(slot.thread[0]?.subject.startsWith(topicOf(slot))).toBe(true);
    for (const slot of withTag(holdout, "fyi_team")) expect(slot.to.length).toBeGreaterThanOrEqual(2);
  });

  test("every due label resolves to a date; a past or far date is in the brief", () => {
    const resolves = (slot: SentSlot, ref: DueRef | null) =>
      ref === null || resolveDue(ref, { sentAt: new Date(slot.sentAt), timeZone }) !== null;
    for (const slot of [...dev, ...holdout]) {
      expect(resolves(slot, slot.labels.due)).toBe(true);
      expect(resolves(slot, slot.labels.promiseDue)).toBe(true);
    }
    for (const tag of ["past_date", "far_date"]) {
      for (const slot of withTag(holdout, tag)) {
        const stated = slot.brief.match(/by (\d{4}-\d{2}-\d{2})/)?.[1] as string;
        const result = resolveDue({ kind: "date", date: stated }, { sentAt: new Date(slot.sentAt), timeZone });
        expect(result).toBeNull();
      }
    }
  });

  test("recipients are persona keys of the scenario; the executive never receives", () => {
    const keys = new Set(scenario.personas.map((p) => p.key));
    const people = new Set(scenario.personas.filter((p) => personGroups.includes(p.group)).map((p) => p.key));
    for (const slot of [...dev, ...holdout]) {
      expect(slot.persona).toBe(scenario.executive.key);
      for (const key of [...slot.to, ...slot.cc]) expect(keys.has(key)).toBe(true);
      if (slot.hardCases[0] !== "many_recipients") {
        for (const key of [...slot.to, ...slot.cc]) expect(people.has(key)).toBe(true);
      }
    }
  });

  test("a brief names no label word", () => {
    for (const slot of [...dev, ...holdout]) expect(slot.brief).not.toMatch(/expects_reply|expectsReply|promiseDue/);
  });

  test("the mini scenario and plan also hold the rules (small spec)", () => {
    const mini = planSentBank(miniScenario, miniSentPlanSpec);
    expect([mini["sent-dev"].length, mini["sent-holdout"].length]).toEqual([20, 60]);
    for (const slot of [...mini["sent-dev"], ...mini["sent-holdout"]]) sentSlotSchema.parse(slot);
    expect(expecting(mini["sent-holdout"])).toHaveLength(30);
  });

  test("a spec that cannot hold its shares is an error, not a silent change", () => {
    expect(() => planSentBank(scenario, { ...spec, sizes: { dev: 10, holdout: 250 } })).toThrow();
    expect(() => planSentBank(scenario, { ...spec, expectsReplyShare: 0.05 })).toThrow();
  });
});
