import { describe, expect, test } from "bun:test";

import { z } from "./zod";

import { formatClock } from "./index";

describe("web zod", () => {
  test("runs without the JIT", () => {
    expect(z.config().jitless).toBe(true);
  });

  test("index exports formatClock", () => {
    expect(formatClock(new Date("2026-11-08T13:03:00Z"), "Europe/Warsaw", new Date("2026-11-08T18:00:00Z"))).toBe(
      "14:03"
    );
  });
});
