import { describe, expect, test } from "bun:test";

import { defaultWeekSpec } from "./fixtures";
import { planSpecSchema } from "./plan-spec";

const spec = {
  seed: 97,
  batchSize: 25,
  bank: {
    devPerCategory: 53,
    holdoutPerCategory: 210,
    hardPerTag: 10,
    hardDevPerTag: 3,
    replyInjectionPerTag: 5,
    replyInjectionDevPerTag: 2,
    langShare: { pl: 0.6, en: 0.4 },
    threadShare: 0.2,
  },
  week: defaultWeekSpec,
};

describe("planSpecSchema", () => {
  test("accepts the lab-01 numbers and refuses a bad seed, batch size or key", () => {
    expect(planSpecSchema.safeParse(spec).success).toBe(true);
    expect(planSpecSchema.safeParse({ ...spec, seed: -1 }).success).toBe(false);
    expect(planSpecSchema.safeParse({ ...spec, seed: 2 ** 32 }).success).toBe(false);
    expect(planSpecSchema.safeParse({ ...spec, batchSize: 20 }).success).toBe(false);
    expect(planSpecSchema.safeParse({ ...spec, extra: true }).success).toBe(false);
  });

  test("refuses a week mix that does not add up to 1", () => {
    const mix = { ...defaultWeekSpec.mix, notification: 0.34 };
    expect(planSpecSchema.safeParse({ ...spec, week: { ...defaultWeekSpec, mix } }).success).toBe(false);
  });
});
