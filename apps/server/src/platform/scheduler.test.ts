import { describe, expect, spyOn, test } from "bun:test";

import { waitFor } from "../../test/wait-for";

import { createLog, setLogFormat, setLogLevel } from "./log";
import { createScheduler, runJobTick } from "./scheduler";

const EVERY_SECOND = "* * * * * *";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
      await waitFor(() => joined(logSpy.mock.calls).includes("job_skipped job=slow"), "a skipped tick");
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
      await waitFor(() => joined(errorSpy.mock.calls).includes("job_failed"), "the error line");
    } finally {
      scheduler.stop();
    }
    const output = joined(errorSpy.mock.calls);
    errorSpy.mockRestore();

    expect(output).toContain("job_failed");
    expect(output).toContain("job=throws");
    expect(output).toContain("error=Error");
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

  test("a tick writes its lines with the job and one run_id", async () => {
    const logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
    let calls: unknown[][] = [];
    setLogFormat("json");
    setLogLevel("debug");
    try {
      await runJobTick("mail.sync", async () => {
        await Bun.sleep(1);
        createLog("mail").info("sync_done");
      });
    } finally {
      calls = [...logSpy.mock.calls];
      setLogFormat("text");
      setLogLevel("info");
      logSpy.mockRestore();
    }

    const lines = calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
    expect(lines.map((line) => line.event)).toEqual(["sync_done", "job_done"]);
    expect(lines[0]?.module).toBe("mail");
    expect(lines[1]?.module).toBe("scheduler");
    expect(lines[1]?.ms).toBeGreaterThanOrEqual(0);
    expect(lines.every((line) => line.job === "mail.sync")).toBe(true);
    expect(String(lines[0]?.run_id)).toMatch(UUID);
    expect(lines[1]?.run_id).toBe(lines[0]?.run_id);
  });

  test("two ticks get two run ids", async () => {
    const logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
    let calls: unknown[][] = [];
    setLogFormat("json");
    setLogLevel("debug");
    try {
      await runJobTick("mail.sync", async () => undefined);
      await runJobTick("mail.sync", async () => undefined);
    } finally {
      calls = [...logSpy.mock.calls];
      setLogFormat("text");
      setLogLevel("info");
      logSpy.mockRestore();
    }

    const ids = calls.map((call) => (JSON.parse(String(call[0])) as Record<string, unknown>).run_id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  test("a failed tick resolves and writes one job_failed line", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    let calls: unknown[][] = [];
    setLogFormat("json");
    try {
      await runJobTick("x", async () => {
        throw Object.assign(new Error("MARKER-SCHED"), { code: "EAUTH" });
      });
    } finally {
      calls = [...errorSpy.mock.calls];
      setLogFormat("text");
      errorSpy.mockRestore();
    }

    expect(calls).toHaveLength(1);
    const raw = String(calls[0]?.[0]);
    const line = JSON.parse(raw) as Record<string, unknown>;
    expect(line.event).toBe("job_failed");
    expect(line.job).toBe("x");
    expect(line.error).toBe("Error");
    expect(line.error_code).toBe("EAUTH");
    expect(String(line.run_id)).toMatch(UUID);
    expect(raw).not.toContain("MARKER-SCHED");
  });
});
