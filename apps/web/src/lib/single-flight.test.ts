import { describe, expect, test } from "bun:test";

import { singleFlight } from "./single-flight";

describe("singleFlight", () => {
  test("a double submit runs the task once", async () => {
    const run = singleFlight();
    let calls = 0;
    let release: () => void = () => undefined;
    const task = () => {
      calls += 1;
      return new Promise<string>((resolve) => {
        release = () => resolve("done");
      });
    };
    const first = run(task);
    const second = run(task);
    expect(await second).toBeUndefined();
    release();
    expect(await first).toBe("done");
    expect(calls).toBe(1);
  });

  test("the next submit runs after the task ended, also after a failure", async () => {
    const run = singleFlight();
    let calls = 0;
    let message = "";
    try {
      await run(() => {
        calls += 1;
        return Promise.reject(new Error("boom"));
      });
    } catch (caught) {
      message = (caught as Error).message;
    }
    expect(message).toBe("boom");
    expect(await run(() => Promise.resolve((calls += 1)))).toBe(2);
  });
});
