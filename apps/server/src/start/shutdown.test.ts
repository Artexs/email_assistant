import { describe, expect, test } from "bun:test";

import { createShutdown, type ShutdownSteps } from "./shutdown";

const never = () => new Promise<void>(() => undefined);

// Fake steps: each pushes its name to `calls`. A sleep resolves only when the test calls `release(ms)`.
function fakeSteps(over: Partial<ShutdownSteps> = {}) {
  const calls: string[] = [];
  const sleeps = new Map<number, () => void>();
  const steps: ShutdownSteps = {
    stopScheduler: () => void calls.push("stopScheduler"),
    stopTelegram: async () => void calls.push("stopTelegram"),
    settled: async () => void calls.push("settled"),
    stopServer: async () => void calls.push("stopServer"),
    closeWeb: async () => void calls.push("closeWeb"),
    destroyDb: async () => void calls.push("destroyDb"),
    exit: (code) => void calls.push(`exit(${code})`),
    sleep: (ms) => new Promise<void>((resolve) => sleeps.set(ms, resolve)),
    ...over,
  };
  return { steps, calls, release: (ms: number) => sleeps.get(ms)?.() };
}

const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("the shutdown", () => {
  test("every step runs in the order of the start-up file, then exit(0)", async () => {
    const { steps, calls } = fakeSteps();
    await createShutdown(() => steps)();
    expect(calls).toEqual([
      "stopScheduler",
      "stopTelegram",
      "settled",
      "stopServer",
      "closeWeb",
      "destroyDb",
      "exit(0)",
    ]);
  });

  test("a Telegram stop that never ends is cut after 10 000 ms", async () => {
    const { steps, calls, release } = fakeSteps({ stopTelegram: never });
    const done = createShutdown(() => steps)();
    await macrotask();
    expect(calls).toEqual(["stopScheduler"]);
    release(10_000);
    await done;
    expect(calls).toEqual(["stopScheduler", "settled", "stopServer", "closeWeb", "destroyDb", "exit(0)"]);
  });

  test("a wait for the runs that never ends is cut after 30 000 ms", async () => {
    const { steps, calls, release } = fakeSteps({ settled: never });
    const done = createShutdown(() => steps)();
    await macrotask();
    expect(calls).toEqual(["stopScheduler", "stopTelegram"]);
    release(30_000);
    await done;
    expect(calls).toEqual(["stopScheduler", "stopTelegram", "stopServer", "closeWeb", "destroyDb", "exit(0)"]);
  });

  test("without a Telegram runtime there is no Telegram step", async () => {
    const { steps, calls } = fakeSteps({ stopTelegram: null });
    await createShutdown(() => steps)();
    expect(calls).toEqual(["stopScheduler", "settled", "stopServer", "closeWeb", "destroyDb", "exit(0)"]);
  });

  test("a second call does nothing", async () => {
    const { steps, calls } = fakeSteps();
    const shutdown = createShutdown(() => steps);
    await Promise.all([shutdown(), shutdown()]);
    await shutdown();
    expect(calls.filter((name) => name === "stopScheduler")).toHaveLength(1);
    expect(calls.filter((name) => name === "exit(0)")).toHaveLength(1);
    expect(calls).toHaveLength(7);
  });

  test("a Telegram stop that fails does not stop the shutdown", async () => {
    const { steps, calls } = fakeSteps({ stopTelegram: () => Promise.reject(new Error("net")) });
    await createShutdown(() => steps)();
    expect(calls).toEqual(["stopScheduler", "settled", "stopServer", "closeWeb", "destroyDb", "exit(0)"]);
  });

  test("the steps are read when the shutdown runs, not when it is built", async () => {
    const early = fakeSteps({ stopTelegram: null });
    const late = fakeSteps();
    let current = early.steps;
    const shutdown = createShutdown(() => current);
    current = late.steps;
    await shutdown();
    expect(early.calls).toEqual([]);
    expect(late.calls).toContain("stopTelegram");
  });
});
