import { describe, expect, test } from "bun:test";

import { createScheduler } from "./scheduler";

const EVERY_SECOND = "* * * * * *";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("scheduler", () => {
  test("a tick never overlaps the previous one", async () => {
    const scheduler = createScheduler();
    let running = 0;
    let maxRunning = 0;
    let runs = 0;
    scheduler.add("slow", EVERY_SECOND, async () => {
      running += 1;
      runs += 1;
      maxRunning = Math.max(maxRunning, running);
      await sleep(1500);
      running -= 1;
    });
    await sleep(3500);
    scheduler.stop();
    await sleep(1600);

    expect(runs).toBeGreaterThanOrEqual(1);
    expect(maxRunning).toBe(1);
  }, 10_000);

  test("a throwing job does not stop the next tick", async () => {
    const scheduler = createScheduler();
    let runs = 0;
    scheduler.add("throws", EVERY_SECOND, async () => {
      runs += 1;
      throw new Error("boom");
    });
    await sleep(2500);
    scheduler.stop();

    expect(runs).toBeGreaterThanOrEqual(2);
  }, 10_000);

  test("stop() stops all jobs", async () => {
    const scheduler = createScheduler();
    let runs = 0;
    scheduler.add("a", EVERY_SECOND, async () => {
      runs += 1;
    });
    scheduler.add("b", EVERY_SECOND, async () => {
      runs += 1;
    });
    scheduler.stop();
    await sleep(2200);

    expect(runs).toBe(0);
  }, 10_000);
});
