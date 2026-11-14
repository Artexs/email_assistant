import { describe, expect, test } from "bun:test";

import { localDateTime } from "../digest/local-time";
import { senderHistorySchema } from "../triage/sender-history";

import { defaultWeekSpec, miniScenario } from "./fixtures";
import { hardCaseRules } from "./hard-cases";
import { senderHistoryFor } from "./history-gen";
import { batchSlots, planBank } from "./plan-bank";
import type { PlanSpec } from "./plan-spec";
import { createRng } from "./random";
import { slotSchema, valueCategories, type Slot } from "./slot";

const spec: PlanSpec = {
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

const bank = planBank(miniScenario, spec);
const all: Slot[] = [...bank.dev, ...bank.holdout];
const categorySlots = (slots: Slot[]) => slots.filter((s) => s.id.startsWith("b-"));
const hardSlots = (slots: Slot[]) => slots.filter((s) => s.id.startsWith("h-"));
const personaOf = (key: string) => miniScenario.personas.find((p) => p.key === key);
const delegateKeys = miniScenario.delegates.map((d) => d.persona);

describe("planBank", () => {
  test("1 two calls give the same JSON", () => {
    expect(JSON.stringify(planBank(miniScenario, spec))).toBe(JSON.stringify(bank));
  });

  test("2 slot counts per category and per hard tag", () => {
    for (const category of valueCategories) {
      expect(categorySlots(bank.dev).filter((s) => s.category === category)).toHaveLength(5);
      expect(categorySlots(bank.holdout).filter((s) => s.category === category)).toHaveLength(20);
    }
    for (const rule of hardCaseRules) {
      const inPart = (slots: Slot[]) => hardSlots(slots).filter((s) => s.hardCases.includes(rule.id)).length;
      expect([inPart(bank.dev), inPart(bank.holdout)]).toEqual(rule.replyInjection ? [0, 1] : [1, 1]);
    }
  });

  test("3 ids are unique and never in both parts", () => {
    const ids = all.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(bank.dev.map((s) => s.id)).size + new Set(bank.holdout.map((s) => s.id)).size).toBe(ids.length);
  });

  test("4 urgent holdout sources: 10 text, 5 vip, 5 context", () => {
    const urgent = categorySlots(bank.holdout).filter((s) => s.category === "urgent");
    const count = (source: string) => urgent.filter((s) => s.urgencySource === source).length;
    expect([count("text"), count("vip"), count("context")]).toEqual([10, 5, 5]);
    for (const slot of urgent.filter((s) => s.urgencySource === "vip")) {
      expect(miniScenario.urgency.vip).toContain(slot.persona);
    }
    const { topics, deadlines } = miniScenario.urgency.profile;
    for (const slot of urgent.filter((s) => s.urgencySource === "context")) {
      const list = slot.contextRef?.kind === "topic" ? topics : deadlines;
      expect(slot.contextRef?.index).toBeLessThan(list.length);
    }
  });

  test("5 language counts follow the largest remainder of 0.6", () => {
    for (const slots of [bank.dev, bank.holdout]) {
      for (const category of valueCategories) {
        const group = categorySlots(slots).filter((s) => s.category === category);
        expect(group.filter((s) => s.lang === "pl")).toHaveLength(Math.round(0.6 * group.length));
      }
    }
    expect(categorySlots(bank.holdout).filter((s) => s.category === "info" && s.lang === "pl")).toHaveLength(12);
  });

  test("6 delegation slots carry a delegate, missing-data slots a clarification", () => {
    const delegation = all.filter((s) => s.category === "delegation");
    expect(delegation.length).toBeGreaterThan(0);
    for (const slot of delegation) {
      if (slot.hardCases.includes("delegation_missing_data")) {
        expect(slot.expectedDraft).toBe("clarification");
        expect(slot.expectedDelegate).toBeUndefined();
      } else {
        expect(slot.expectedDraft).toBe("delegation");
        expect(delegateKeys).toContain(slot.expectedDelegate as string);
        const tag = miniScenario.delegates.find((d) => d.persona === slot.expectedDelegate)?.tags[0] as string;
        if (slot.id.startsWith("b-")) expect(slot.brief).toContain(`a task in ${tag}:`);
      }
    }
    expect(all.filter((s) => s.expectedDraft === "clarification").every((s) => s.id.startsWith("h-dmd"))).toBe(true);
  });

  test("7 and 12 newsletter and marketing senders carry list headers with a .test host", () => {
    const lists = all.filter((s) => ["newsletter", "marketing"].includes(personaOf(s.persona)?.group as string));
    expect(lists.length).toBeGreaterThan(0);
    for (const slot of lists) {
      expect(slot.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/[a-z0-9.-]+\.test\/u\/\d+>$/);
      expect(slot.headers["List-Id"]).toMatch(/\.test>$/);
    }
    for (const slot of all.filter((s) => personaOf(s.persona)?.group === "newsletter")) {
      expect(slot.headers["List-Unsubscribe"]).toBeDefined();
    }
  });

  test("8 every slot parses and no brief names a category", () => {
    for (const slot of all) {
      expect(slotSchema.safeParse(slot).success).toBe(true);
      expect(slot.brief.length).toBeLessThanOrEqual(200);
      // The fixture names are "Persona <key>"; a persona name is not template text.
      const text = slot.brief.replaceAll(/Persona [a-z-]+/g, "");
      expect(text).not.toMatch(/\b(urgent|spam|notification|delegation|needs_reply)\b/i);
    }
  });

  test("9 receivedAt is a weekday inside the two bank weeks, local hour 7-18", () => {
    const start = Date.parse(`${miniScenario.calendar.bankStart}T00:00:00Z`);
    for (const slot of all) {
      const local = localDateTime(new Date(slot.receivedAt), "Europe/Warsaw");
      expect([1, 2, 3, 4, 5]).toContain(local.weekday);
      const day = Date.parse(`${local.date}T00:00:00Z`);
      expect(day).toBeGreaterThanOrEqual(start);
      expect(day).toBeLessThanOrEqual(start + 13 * 86_400_000);
      const hour = Number(local.time.slice(0, 2));
      expect(hour).toBeGreaterThanOrEqual(7);
      expect(hour).toBeLessThanOrEqual(18);
    }
  });

  test("10 another seed gives another urgent dev id set", () => {
    const urgentDev = (planned: { dev: Slot[] }) =>
      categorySlots(planned.dev)
        .filter((s) => s.category === "urgent")
        .map((s) => s.id)
        .sort();
    const other = planBank(miniScenario, { ...spec, seed: 8 });
    expect(urgentDev(other)).not.toEqual(urgentDev(bank));
  });

  test("11 batches hold at most 25 slots and count from batch-001 per part", () => {
    for (const slots of [bank.dev, bank.holdout]) {
      const sizes = new Map<string, number>();
      for (const slot of slots) sizes.set(slot.batch, (sizes.get(slot.batch) ?? 0) + 1);
      const names = [...sizes.keys()].sort();
      expect(names).toEqual(Array.from({ length: names.length }, (_, i) => `batch-${String(i + 1).padStart(3, "0")}`));
      for (const size of sizes.values()) expect(size).toBeLessThanOrEqual(25);
      expect(slots.map((s) => s.id)).toEqual(slots.map((s) => s.id).sort());
    }
  });

  test("hard slots keep style variety although each tag has one slot per part", () => {
    const hard = hardSlots(bank.holdout).filter((s) => !s.hardCases.some((t) => t.startsWith("reply_inj")));
    expect(new Set(hard.map((s) => s.style.length)).size).toBeGreaterThan(1);
    expect(new Set(hard.map((s) => s.style.signature)).size).toBeGreaterThan(1);
  });

  test("12 hard slots carry the facts of their category", () => {
    for (const slot of hardSlots(all)) {
      if (slot.category === "urgent") expect(slot.urgencySource).toBeDefined();
      if (slot.category === "delegation" && !slot.hardCases.includes("delegation_missing_data")) {
        expect(slot.expectedDelegate).toBeDefined();
      }
      expect(slot.hardCases).toHaveLength(1);
    }
    for (const slot of hardSlots(all).filter((s) => s.hardCases[0] === "urgent_no_keyword")) {
      expect(slot.urgencySource).toBe("text");
      expect(slot.contextRef).toBeUndefined();
    }
  });
});

describe("sender history", () => {
  test("every slot has a valid history; one persona has one history per part", () => {
    for (const slots of [bank.dev, bank.holdout]) {
      const seen = new Map<string, string>();
      for (const slot of slots) {
        expect(senderHistorySchema.safeParse(slot.senderHistory).success).toBe(true);
        const json = JSON.stringify(slot.senderHistory);
        expect(seen.get(slot.persona) ?? json).toBe(json);
        seen.set(slot.persona, json);
      }
    }
  });

  test("a replaced sender (bounce, vip_looks_like_spam) has the history of the final persona", () => {
    const replaced = hardSlots(all).filter((s) => ["bounce", "vip_looks_like_spam"].includes(s.hardCases[0] as string));
    expect(replaced).toHaveLength(4);
    for (const slot of replaced) {
      const same = all.find((o) => o.part === slot.part && o.persona === slot.persona && o.id.startsWith("b-"));
      if (same) expect(JSON.stringify(same.senderHistory)).toBe(JSON.stringify(slot.senderHistory));
      if (slot.hardCases[0] === "bounce") {
        expect(personaOf(slot.persona)?.group).toBe("system");
        expect(slot.headers["List-Id"]).toBeUndefined();
        expect(slot.senderHistory?.bulkSignals).toEqual(["noreply", "auto_submitted"]);
      } else {
        expect(miniScenario.urgency.vip).toContain(slot.persona);
        expect(slot.senderHistory?.relation).toBe("vip");
      }
    }
  });

  test("group profiles: boss, system and phishing", () => {
    const history = (key: string) => senderHistoryFor(personaOf(key) as never, miniScenario, createRng(5), 90);
    const boss = history("prezes");
    expect(boss.received).toBeGreaterThanOrEqual(40);
    expect(boss.received).toBeLessThanOrEqual(80);
    expect(boss.answered / boss.received).toBeGreaterThanOrEqual(0.59);
    expect(boss.relation).toBe("vip");
    const system = history("system-f");
    expect(Object.keys(system.byCategory)).toEqual(["notification"]);
    expect(system.bulkSignals.length).toBeGreaterThan(0);
    expect(system.relation).toBe("bulk");
    const phishing = history("phish-h");
    expect(phishing.received).toBeLessThanOrEqual(2);
    expect(phishing.relation).toBe("new");
    if (phishing.received > 0) expect(phishing.firstSeenDaysAgo).toBeLessThanOrEqual(2);
  });
});

describe("batchSlots", () => {
  test("sets part and batch in id order, 25 per batch, from the start index", () => {
    const slots = [...bank.holdout].reverse();
    const batched = batchSlots(slots, "holdout", 3);
    expect(batched[0]?.batch).toBe("batch-003");
    expect(batched[25]?.batch).toBe("batch-004");
    expect(batched.map((s) => s.id)).toEqual(bank.holdout.map((s) => s.id));
  });
});
