import { describe, expect, test } from "bun:test";

import { createRng, deriveSeed, largestRemainder, quota } from "./random";

describe("createRng", () => {
  test("seed 97 gives the fixed first values", () => {
    const rng = createRng(97);
    const values = [rng.next(), rng.next(), rng.next()];
    expect(values.map((v) => Number(v.toFixed(6)))).toEqual([0.565584, 0.2195, 0.833951]);
  });

  test("shuffle is repeatable and does not change its input", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const first = createRng(1).shuffle(input);
    const second = createRng(1).shuffle(input);
    expect(first).toEqual(second);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect([...first].sort((a, b) => a - b)).toEqual(input);
  });

  test("int stays below its limit and pick refuses an empty list", () => {
    const rng = createRng(5);
    for (let i = 0; i < 200; i++) expect(rng.int(3)).toBeLessThan(3);
    expect(() => rng.int(0)).toThrow();
    expect(() => rng.pick([])).toThrow();
  });
});

describe("deriveSeed", () => {
  test("each label has its own stream", () => {
    expect(deriveSeed(97, "dev:urgent")).not.toBe(deriveSeed(97, "holdout:urgent"));
    expect(deriveSeed(97, "dev:urgent")).toBe(deriveSeed(97, "dev:urgent"));
    expect(deriveSeed(97, "dev:urgent")).not.toBe(deriveSeed(98, "dev:urgent"));
  });
});

describe("largestRemainder and quota", () => {
  test("counts add up to the total and follow the shares", () => {
    expect(largestRemainder([0.6, 0.4], 20)).toEqual([12, 8]);
    expect(largestRemainder([0.6, 0.4], 5)).toEqual([3, 2]);
    expect(largestRemainder([0.5, 0.25, 0.25], 20)).toEqual([10, 5, 5]);
    expect(largestRemainder([0.5, 0.25, 0.25], 1)).toEqual([1, 0, 0]);
    expect(largestRemainder([0.3, 0.5, 0.2], 7).reduce((a, b) => a + b, 0)).toBe(7);
  });

  test("quota shuffles the items and keeps the counts", () => {
    const out = quota(createRng(3), ["a", "b"], [0.6, 0.4], 10);
    expect(out.filter((x) => x === "a")).toHaveLength(6);
    expect(out).toHaveLength(10);
  });
});
