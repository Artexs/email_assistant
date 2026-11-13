import { describe, expect, spyOn, test } from "bun:test";

import { waitFor } from "../../test/wait-for";
import { setLogLevel } from "./log";
import { createScheduler } from "./scheduler";

const EVERY_SECOND = "* * * * * *";

const joined = (calls: unknown[][]): string => calls.map((call) => call.map(String).join(" ")).join("\n");

describe("scheduler", () => {
  test("a tick never overlaps the previous one", async () => {
    const logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
    setLogLevel("debug");
    const scheduler = createScheduler();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let running = 0;
    let maxRunning = 0;
    let runs = 0;
    scheduler.add("slow", EVERY_SECOND, async () => {
      running += 1;
      runs += 1;
      maxRunning = Math.max(maxRunning, running);
      if (runs === 1) await gate;
      running -= 1;
    });
    try {
      await waitFor(
        () => joined(logSpy.mock.calls).includes("slow skipped: the previous run is still going"),
        "a skipped tick"
      );
      expect(runs).toBe(1);
      release();
      await waitFor(() => runs >= 2, "a run after the release");
    } finally {
      scheduler.stop();
      release();
      setLogLevel("info");
      logSpy.mockRestore();
    }

    expect(maxRunning).toBe(1);
  }, 10_000);

  test("a throwing job does not stop the next tick", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    const scheduler = createScheduler();
    let runs = 0;
    scheduler.add("throws", EVERY_SECOND, async () => {
      runs += 1;
      throw new Error("boom");
    });
    try {
      await waitFor(() => runs >= 2, "two runs");
    } finally {
      scheduler.stop();
      errorSpy.mockRestore();
    }

    expect(runs).toBeGreaterThanOrEqual(2);
  }, 10_000);

  test("a failed job logs its error label and not its message", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    const scheduler = createScheduler();
    scheduler.add("throws", EVERY_SECOND, async () => {
      throw new Error("MARKER-SCHED");
    });
    try {
      await waitFor(() => joined(errorSpy.mock.calls).includes("throws failed: Error"), "the error line");
    } finally {
      scheduler.stop();
    }
    const output = joined(errorSpy.mock.calls);
    errorSpy.mockRestore();

    expect(output).toContain("throws failed: Error");
    expect(output).not.toContain("MARKER-SCHED");
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
    const witness = createScheduler();
    let witnessRuns = 0;
    witness.add("witness", EVERY_SECOND, async () => {
      witnessRuns += 1;
    });
    try {
      await waitFor(() => witnessRuns >= 2, "two witness ticks");
    } finally {
      witness.stop();
    }

    expect(runs).toBe(0);
  }, 10_000);
});
