import { describe, expect, test } from "bun:test";

import { applyVerdict, pickAuditCases, verdictFileSchema } from "./audit";
import { miniPlanSpec, miniScenario } from "./fixtures";
import { planBank } from "./plan-bank";
import { slotSchema } from "./slot";

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("fixture slot missing");
  return value;
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c-${String(i).padStart(3, "0")}`);

describe("pickAuditCases", () => {
  test("1 30 random and 20 contested, no overlap, the same twice, other with another version", () => {
    const all = ids(100);
    const input = { ids: all, contested: all.slice(40, 70), seed: 7, version: "1" };
    const picked = pickAuditCases(input);
    expect(picked.random).toHaveLength(30);
    expect(picked.contested).toHaveLength(20);
    expect(picked.contested.some((id) => picked.random.includes(id))).toBe(false);
    expect(new Set(picked.random).size).toBe(30);
    expect(pickAuditCases(input)).toEqual(picked);
    expect(pickAuditCases({ ...input, version: "2" }).random).not.toEqual(picked.random);
  });

  test("2 fewer than 30 ids are all random and none is contested", () => {
    const all = ids(12);
    expect(pickAuditCases({ ids: all, contested: all.slice(0, 5), seed: 7, version: "1" })).toEqual({
      random: all,
      contested: [],
    });
  });
});

describe("applyVerdict", () => {
  const { dev } = planBank(miniScenario, miniPlanSpec);

  test("ok and pending change nothing", () => {
    const slot = must(dev[0]);
    expect(applyVerdict(slot, "ok")).toBe(slot);
    expect(applyVerdict(slot, "pending")).toBe(slot);
    expect(applyVerdict(slot, `wrong: ${slot.category}`)).toBe(slot);
  });

  test("3 an urgent slot with source vip that is wrong: info loses its urgency fields", () => {
    const slot = must(dev.find((s) => s.category === "urgent" && s.urgencySource === "vip"));
    const next = applyVerdict(slot, "wrong: info");
    expect(next.category).toBe("info");
    expect(next.urgencySource).toBeUndefined();
    expect(next.contextRef).toBeUndefined();
    expect(slotSchema.parse(next)).toEqual(next);
  });

  test("a context urgent slot that is wrong: needs_reply loses its context reference", () => {
    const slot = must(dev.find((s) => s.urgencySource === "context"));
    const next = applyVerdict(slot, "wrong: needs_reply");
    expect(next.contextRef).toBeUndefined();
    expect(slotSchema.parse(next)).toEqual(next);
  });

  test("4 an info slot that is wrong: delegation asks for a clarification and has no delegate", () => {
    const slot = must(dev.find((s) => s.category === "info"));
    const next = applyVerdict(slot, "wrong: delegation");
    expect(next.category).toBe("delegation");
    expect(next.expectedDraft).toBe("clarification");
    expect(next.expectedDelegate).toBeUndefined();
    expect(slotSchema.parse(next)).toEqual(next);
  });

  test("a delegation slot that is wrong: urgent gets source text and loses its delegate", () => {
    const slot = must(dev.find((s) => s.category === "delegation" && s.expectedDelegate !== undefined));
    const next = applyVerdict(slot, "wrong: urgent");
    expect(next.urgencySource).toBe("text");
    expect(next.expectedDraft).toBeUndefined();
    expect(next.expectedDelegate).toBeUndefined();
    expect(slotSchema.parse(next)).toEqual(next);
  });
});

describe("verdictFileSchema", () => {
  test("accepts pending, ok and wrong with a category; rejects another text", () => {
    const file = (verdict: string) => ({ scenario: "mini", version: "1", verdicts: [{ id: "a", verdict }] });
    for (const verdict of ["pending", "ok", "wrong: spam"])
      expect(verdictFileSchema.safeParse(file(verdict)).success).toBe(true);
    for (const verdict of ["", "wrong", "wrong: other", "OK"])
      expect(verdictFileSchema.safeParse(file(verdict)).success).toBe(false);
  });
});
