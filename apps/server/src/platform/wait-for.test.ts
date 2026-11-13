import { describe, expect, test } from "bun:test";

import { waitFor } from "../../test/wait-for";

describe("waitFor", () => {
  test("a condition that is already true returns at once", async () => {
    let calls = 0;
    const started = Date.now();
    await waitFor(() => {
      calls += 1;
      return true;
    }, "already");

    expect(Date.now() - started).toBeLessThan(100);
    expect(calls).toBe(1);
  });

  test("a condition that turns true later returns after it", async () => {
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 100);
    const started = Date.now();
    await waitFor(() => ready, "later");
    const elapsed = Date.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(1000);
  });

  test("a condition that stays false rejects with the label", async () => {
    const started = Date.now();
    await expect(waitFor(() => false, "never", { timeoutMs: 100, everyMs: 10 })).rejects.toThrow(
      "waitFor: never not true after 100 ms"
    );

    expect(Date.now() - started).toBeLessThan(1000);
  });
});
