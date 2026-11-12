import { describe, expect, test } from "bun:test";

import { canWrite } from "./can-write";

const withPlan = (plan: "active" | "trial" | "suspended") => ({ organization: { plan } }) as never;

describe("canWrite", () => {
  test("active and trial organizations write", () => {
    expect(canWrite(withPlan("active"))).toBe(true);
    expect(canWrite(withPlan("trial"))).toBe(true);
  });

  test("a suspended organization does not write", () => {
    expect(canWrite(withPlan("suspended"))).toBe(false);
  });

  test("no account data does not write", () => {
    expect(canWrite(null)).toBe(false);
  });
});
