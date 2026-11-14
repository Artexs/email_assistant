import { describe, expect, test } from "bun:test";

import { createRng, deriveSeed } from "./random";

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
