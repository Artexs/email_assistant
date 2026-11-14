import { describe, expect, test } from "bun:test";

import type { CaseText } from "./files";
import { miniPlanSpec, miniScenario } from "./fixtures";
import {
  defaultFreezeFloors,
  freezeIssues,
  manifestBody,
  manifestSchema,
  nextVersion,
  type FreezeInput,
} from "./manifest";
import { planBank } from "./plan-bank";
import { planWeek } from "./plan-week";
import { simParts, valueCategories, type SimPart, type ValueCategory } from "./slot";

const floors = { minDev: 5, minHoldout: 20, hardShare: 0.8 };

function text(id: string): CaseText {
  return { id, subject: `Temat ${id}`, body: `Tresc ${id}`, thread: [] };
}

// Every slot of the mini corpus with a text and a label equal to its category.
function complete(): FreezeInput {
  const bank = planBank(miniScenario, miniPlanSpec);
  const slots = { dev: bank.dev, holdout: bank.holdout, week: planWeek(miniScenario, miniPlanSpec).slots };
  const texts = {} as FreezeInput["texts"];
  const labels = {} as FreezeInput["labels"];
  for (const part of simParts) {
    texts[part] = new Map(slots[part].map((slot) => [slot.id, text(slot.id)]));
    labels[part] = new Map(
      slots[part].filter((slot) => slot.direction !== "sent").map((slot) => [slot.id, slot.category])
    );
  }
  return { slots, texts, labels, spec: miniPlanSpec };
}

const codes = (input: FreezeInput, f = floors) => [...new Set(freezeIssues(input, f).map((issue) => issue.code))];

// A bank slot with no hard-case tag in the part.
function plainSlot(input: FreezeInput, part: SimPart, category: ValueCategory) {
  const slot = input.slots[part].find(
    (s) => s.category === category && s.hardCases.length === 0 && s.direction !== "sent"
  );
  if (slot === undefined) throw new Error("no plain slot");
  return slot;
}

describe("freeze", () => {
  test("1 a complete corpus has no issue; the body parses and is stable", () => {
    const input = complete();
    expect(freezeIssues(input, floors)).toEqual([]);
    const body = manifestBody(input);
    expect(manifestBody(complete())).toEqual(body);
    const manifest = {
      scenario: "mini",
      version: "1",
      frozenAt: "2026-11-14",
      ...body,
      audit: { status: "pending", list: "audit/v1-list.md", verdicts: "audit/v1-verdicts.json", wrong: 0 },
    };
    expect(manifestSchema.parse(manifest)).toEqual(manifest);
    expect(body.parts.dev.cases).toBe(input.slots.dev.length);
  });

  test("an unwritten slot and a missing label are issues; a sent week mail needs no label", () => {
    const input = complete();
    const dev = plainSlot(input, "dev", "info");
    input.texts.dev.delete(dev.id);
    const holdout = plainSlot(input, "holdout", "spam");
    input.labels.holdout.delete(holdout.id);
    expect(freezeIssues(input, floors).map((issue) => issue.code)).toEqual(["unwritten", "unlabelled"]);
    expect(input.slots.week.some((slot) => slot.direction === "sent")).toBe(true);
  });

  test("2 a changed text body changes the hash of its part only", () => {
    const input = complete();
    const before = manifestBody(input);
    const slot = plainSlot(input, "holdout", "info");
    input.texts.holdout.set(slot.id, { ...text(slot.id), body: "Inna tresc" });
    const after = manifestBody(input);
    expect(after.parts.holdout.sha256).not.toBe(before.parts.holdout.sha256);
    expect(after.parts.dev).toEqual(before.parts.dev);
    expect(after.parts.week).toEqual(before.parts.week);
  });

  test("3 a label that differs is open unless the text has a borderline note", () => {
    const input = complete();
    const slot = plainSlot(input, "dev", "info");
    const other = valueCategories.find((c) => c !== slot.category) as ValueCategory;
    input.labels.dev.set(slot.id, other);
    expect(freezeIssues(input, floors)).toEqual([
      { code: "open_disagreement", detail: `dev ${slot.id} slot info blind ${other}` },
    ]);
    input.texts.dev.set(slot.id, { ...text(slot.id), note: "rewritten: clearer" });
    expect(codes(input)).toEqual(["open_disagreement"]);
    input.texts.dev.set(slot.id, { ...text(slot.id), note: "borderline: both fit" });
    expect(freezeIssues(input, floors)).toEqual([]);
  });

  test("4 a dropped week text is week_dropped; a dropped bank text leaves the hash", () => {
    const input = complete();
    const week = input.slots.week.find((slot) => slot.direction !== "sent" && slot.hardCases.length === 0);
    input.texts.week.set((week as { id: string }).id, { ...text((week as { id: string }).id), dropped: true });
    expect(freezeIssues(input, floors).map((issue) => issue.code)).toEqual(["week_dropped"]);

    const bank = complete();
    const before = manifestBody(bank).parts.dev;
    const slot = plainSlot(bank, "dev", "notification");
    bank.texts.dev.set(slot.id, { ...text(slot.id), dropped: true });
    const after = manifestBody(bank).parts.dev;
    expect(after.cases).toBe(before.cases - 1);
    expect(after.sha256).not.toBe(before.sha256);
  });

  test("5 too few kept cases of a category name the category; the defaults are P3's floors", () => {
    expect(defaultFreezeFloors).toEqual({ minDev: 50, minHoldout: 200, hardShare: 0.8 });
    const input = complete();
    const category: ValueCategory = "needs_reply";
    const plain = input.slots.holdout.filter((s) => s.category === category && s.hardCases.length === 0);
    const count = input.slots.holdout.filter((s) => s.category === category).length;
    for (const slot of plain.slice(0, count - 19)) {
      input.texts.holdout.set(slot.id, { ...text(slot.id), dropped: true });
    }
    expect(freezeIssues(input, floors)).toEqual([{ code: "too_few", detail: `holdout ${category} 19|20` }]);

    const defaults = freezeIssues(complete(), defaultFreezeFloors).filter((issue) => issue.code === "too_few");
    for (const part of ["dev", "holdout"]) {
      for (const c of valueCategories)
        expect(defaults.some((issue) => issue.detail.startsWith(`${part} ${c} `))).toBe(true);
    }
  });

  test("a tag that lost more than the share of its planned cases is hard_too_few", () => {
    const input = complete();
    const tagged = input.slots.holdout.filter((s) => s.hardCases.includes("html_only"));
    for (const slot of tagged) input.texts.holdout.set(slot.id, { ...text(slot.id), dropped: true });
    const found = freezeIssues(input, floors).filter((issue) => issue.code === "hard_too_few");
    expect(found.map((issue) => issue.detail.split(" ")[0])).toContain("html_only");
  });

  test("nextVersion adds one minor step", () => {
    expect(nextVersion("1")).toBe("1.1");
    expect(nextVersion("1.1")).toBe("1.2");
  });
});
