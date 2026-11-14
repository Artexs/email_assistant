import { describe, expect, test } from "bun:test";

import { localDateTime } from "../digest/local-time";

import { defaultWeekSpec, miniScenario } from "./fixtures";
import { senderHistoryFor } from "./history-gen";
import type { PlanSpec } from "./plan-spec";
import { planSpecSchema } from "./plan-spec";
import { dayCounts, planWeek, weekHistorySchema } from "./plan-week";
import { createRng } from "./random";
import { slotSchema, type Slot } from "./slot";

// Neutral display names: no brief of the week holds a banned word, so the tests strip nothing.
const scenario = {
  ...miniScenario,
  personas: miniScenario.personas.map((p, i) => ({ ...p, displayName: `Jan Kowalski ${i + 1}` })),
};
const spec: PlanSpec = {
  seed: 5,
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
  week: { ...defaultWeekSpec, weekdayMails: 20, weekendMails: 6, sentThreadsPerWeekday: 1 },
};

const { slots, history } = planWeek(scenario, spec);
const byId = new Map(slots.map((s) => [s.id, s]));
const personaOf = (key: string) => scenario.personas.find((p) => p.key === key);
const sentSlots = slots.filter((s) => s.direction === "sent");
const incoming = slots.filter((s) => s.direction === "in");
const sentReplies = slots.filter((s) => s.parentId !== undefined && byId.get(s.parentId)?.direction === "sent");
const dayOf = (slot: Slot) => Number(slot.id.split("-")[1]);
const localDate = (slot: Slot) => localDateTime(new Date(slot.receivedAt), "Europe/Warsaw").date;
const localHour = (slot: Slot) => Number(localDateTime(new Date(slot.receivedAt), "Europe/Warsaw").time.slice(0, 2));

describe("dayCounts", () => {
  test("1 the default spec gives 830 mails over 7 days", () => {
    const totals = dayCounts(defaultWeekSpec).map((d) => d.total);
    expect(totals).toEqual([150, 150, 150, 150, 150, 40, 40]);
    expect(totals.reduce((a, b) => a + b, 0)).toBe(830);
  });

  test("2 the mix by largest remainder, a tie by the mix order", () => {
    const order = ["notification", "spam", "info", "needs_reply", "delegation", "urgent"] as const;
    const counts = dayCounts(defaultWeekSpec);
    expect(order.map((c) => counts[0]?.byCategory[c])).toEqual([53, 30, 30, 20, 10, 7]);
    expect(order.map((c) => counts[5]?.byCategory[c])).toEqual([14, 8, 8, 5, 3, 2]);
    const week = order.map((c) => counts.reduce((sum, d) => sum + d.byCategory[c], 0));
    // The week sums are not forced to a target; these are the numbers of the rounding.
    expect(week).toEqual([293, 166, 166, 110, 56, 39]);
  });

  test("3 a mix that adds up to 0.99 is refused", () => {
    const week = { ...defaultWeekSpec, mix: { ...defaultWeekSpec.mix, notification: 0.34 } };
    expect(planSpecSchema.safeParse({ ...spec, week }).success).toBe(false);
  });
});

describe("planWeek", () => {
  test("1 two calls give the same JSON", () => {
    expect(JSON.stringify(planWeek(scenario, spec))).toBe(JSON.stringify({ slots, history }));
  });

  test("2 the counts: 112 mix slots, 5 sent threads, 3 planned replies", () => {
    expect(incoming.length - sentReplies.length).toBe(112);
    expect(sentSlots).toHaveLength(5);
    expect(sentReplies).toHaveLength(3);
    expect(slots).toHaveLength(112 + 5 + 3);
    for (const slot of slots) expect(slotSchema.safeParse(slot).success).toBe(true);
    for (const slot of sentSlots) expect(slot.persona).toBe(scenario.executive.key);
    for (const slot of sentReplies) expect(["needs_reply", "info"]).toContain(slot.category);
    // Two of the five sent threads get no reply at all (the dropped-thread case).
    expect(sentSlots.filter((s) => !slots.some((o) => o.parentId === s.id))).toHaveLength(2);
  });

  test("the default week holds 830 mix slots, 15 sent threads and 10 planned replies", () => {
    const full = planWeek(scenario, { ...spec, week: defaultWeekSpec }).slots;
    const replies = full.filter((s) => full.find((p) => p.id === s.parentId)?.direction === "sent");
    expect(full).toHaveLength(830 + 15 + 10);
    expect(full.filter((s) => s.direction === "sent")).toHaveLength(15);
    expect(replies).toHaveLength(10);
    const threaded = full.filter((s) => s.parentId !== undefined && !replies.includes(s));
    expect(threaded.length).toBeGreaterThan(0);
    for (const slot of full) expect(slotSchema.safeParse(slot).success).toBe(true);
  });

  test("3 a parent is an earlier mail of the same thread, 10 minutes or more, at most 5 deep", () => {
    const depth = (slot: Slot): number =>
      slot.parentId === undefined ? 1 : 1 + depth(byId.get(slot.parentId) as Slot);
    const replies = slots.filter((s) => s.parentId !== undefined);
    expect(replies.length).toBeGreaterThan(sentReplies.length);
    for (const slot of replies) {
      const parent = byId.get(slot.parentId as string) as Slot;
      expect(Date.parse(slot.receivedAt) - Date.parse(parent.receivedAt)).toBeGreaterThanOrEqual(10 * 60_000);
      expect(slot.threadId).toBeDefined();
      expect(parent.threadId).toBe(slot.threadId);
      expect(depth(slot)).toBeLessThanOrEqual(5);
      // The executive is one end and the other person is the same.
      const other = (s: Slot) => (s.direction === "sent" ? (s.to[0] as string) : s.persona);
      expect(other(parent)).toBe(other(slot));
      expect(parent.topic).toBe(slot.topic);
    }
  });

  test("4 days and hours: the local date follows the id; few weekday mails are off hours", () => {
    const start = Date.parse(`${scenario.calendar.weekStart}T00:00:00Z`);
    for (const slot of slots) {
      expect(localDate(slot)).toBe(new Date(start + (dayOf(slot) - 1) * 86_400_000).toISOString().slice(0, 10));
    }
    const minutes = slots.map((s) => Math.floor(Date.parse(s.receivedAt) / 60_000));
    expect(new Set(minutes).size).toBe(slots.length);
    for (let day = 1; day <= 5; day++) {
      const off = slots.filter((s) => dayOf(s) === day && (localHour(s) < 7 || localHour(s) >= 20));
      expect(off.length).toBeLessThanOrEqual(Math.ceil(0.05 * 20) + 1);
    }
    for (const slot of slots.filter((s) => dayOf(s) > 5)) {
      expect(localHour(slot)).toBeGreaterThanOrEqual(8);
      expect(localHour(slot)).toBeLessThan(22);
    }
  });

  test("5 every delegation slot has a behaviour; the counts follow the shares", () => {
    const delegation = slots.filter((s) => s.category === "delegation");
    expect(delegation.length).toBeGreaterThan(0);
    expect(slots.filter((s) => s.delegateBehaviour !== undefined)).toHaveLength(delegation.length);
    for (const slot of delegation) {
      expect(slot.expectedDraft).toBe("delegation");
      expect(miniScenario.delegates.map((d) => d.persona)).toContain(slot.expectedDelegate as string);
    }
    const shares = Object.values(defaultWeekSpec.behaviour);
    const total = delegation.length;
    const exact = shares.map((share) => share * total);
    const counts = (["done", "late", "out_of_office", "other_address", "silent"] as const).map(
      (name) => delegation.filter((s) => s.delegateBehaviour === name).length
    );
    exact.forEach((x, i) => {
      expect(counts[i]).toBeGreaterThanOrEqual(Math.floor(x + 1e-9));
      expect(counts[i]).toBeLessThanOrEqual(Math.ceil(x - 1e-9));
    });
    expect(counts.reduce((a, b) => a + b, 0)).toBe(total);
  });

  test("6 each weekday has one slot of each phishing tag, two auto-replies and one bounce", () => {
    for (let day = 1; day <= 5; day++) {
      const tags = slots.filter((s) => dayOf(s) === day).flatMap((s) => s.hardCases);
      const count = (tag: string) => tags.filter((t) => t === tag).length;
      expect(count("phishing_urgent_push")).toBe(1);
      expect(count("phishing_delegation")).toBe(1);
      expect(count("phishing_unsubscribe")).toBe(1);
      expect(count("auto_reply")).toBe(2);
      expect(count("bounce")).toBe(1);
    }
    expect(slots.filter((s) => dayOf(s) > 5).flatMap((s) => s.hardCases)).toEqual([]);
    for (const slot of slots.filter((s) => s.hardCases.includes("phishing_urgent_push"))) {
      expect(slot.category).toBe("spam");
      expect(personaOf(slot.persona)?.group).toBe("phishing");
    }
  });

  test("7 batches are in time order", () => {
    const batches = [...new Set(slots.map((s) => s.batch))].sort();
    expect(batches[0]).toBe("batch-001");
    batches.slice(1).forEach((batch, i) => {
      const before = slots.filter((s) => s.batch === batches[i]);
      const after = slots.filter((s) => s.batch === batch);
      expect(Math.max(...before.map((s) => Date.parse(s.receivedAt)))).toBeLessThanOrEqual(
        Math.min(...after.map((s) => Date.parse(s.receivedAt)))
      );
    });
    for (const slot of slots) expect(slot.batch).toMatch(/^batch-\d{3}$/);
    expect(slots.map((s) => s.id)).toEqual(slots.map((s) => s.id).sort());
  });

  test("language and urgency sources follow the shares over the week", () => {
    const mix = incoming.filter((s) => !sentReplies.includes(s));
    expect(mix.filter((s) => s.lang === "pl")).toHaveLength(Math.round(0.7 * mix.length));
    const urgent = slots.filter((s) => s.category === "urgent");
    const count = (source: string) => urgent.filter((s) => s.urgencySource === source).length;
    expect(count("text") + count("vip") + count("context")).toBe(urgent.length);
    expect(count("text")).toBe(Math.round(urgent.length / 2));
  });

  test("no brief of the week holds a banned word, with no strip", () => {
    for (const slot of slots) {
      expect(slot.brief.length).toBeLessThanOrEqual(200);
      expect(slot.brief).not.toMatch(/\b(urgent|spam|notification|delegation|needs_reply)\b/i);
    }
  });
});

describe("week history", () => {
  test("1 the schema parses it and every sender of an incoming slot is a key", () => {
    expect(weekHistorySchema.safeParse(history).success).toBe(true);
    expect(history.days).toBe(30);
    for (const slot of incoming) {
      const address = slot.fromOverride ?? (personaOf(slot.persona)?.address as string);
      expect(history.senders[address]).toBeDefined();
    }
    for (const slot of slots) expect(slot.senderHistory).toBeUndefined();
  });

  test("2 a phishing or spammer persona is new with no mail", () => {
    for (const key of ["phish-h", "spam-g"]) {
      const sender = history.senders[personaOf(key)?.address as string];
      if (sender) expect([sender.received, sender.relation]).toEqual([0, "new"]);
    }
    const phishing = incoming.filter((s) => s.hardCases.some((t) => t.startsWith("phishing_")));
    expect(phishing.length).toBeGreaterThan(0);
    for (const slot of phishing) {
      const sender = history.senders[personaOf(slot.persona)?.address as string];
      expect([sender?.received, sender?.relation]).toEqual([0, "new"]);
    }
  });

  test("3 the JSON holds no voice text and no display name", () => {
    const json = JSON.stringify(history);
    for (const persona of scenario.personas) {
      expect(json.includes(persona.voice)).toBe(false);
      expect(json.includes(persona.displayName)).toBe(false);
    }
  });

  test("the counts scale with the days: a 30-day boss history is a third of the 90-day ranges", () => {
    const boss = personaOf("prezes") as never;
    for (let seed = 1; seed <= 20; seed++) {
      const thirty = senderHistoryFor(boss, scenario, createRng(seed), 30);
      expect(thirty.received).toBeGreaterThanOrEqual(13);
      expect(thirty.received).toBeLessThanOrEqual(27);
      expect(thirty.userMailsTo).toBeLessThanOrEqual(20);
      expect(thirty.firstSeenDaysAgo).toBeLessThanOrEqual(30);
      expect(thirty.days).toBe(30);
    }
  });
});
