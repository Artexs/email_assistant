import { HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { createLlmPause } from "./pause";

const t0 = new Date("2026-11-05T12:00:00Z");
const minutes = (from: Date, to: Date): number => (to.getTime() - from.getTime()) / MINUTE_MS;

let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("createLlmPause", () => {
  test("trips give 5, 10, 20, 40, 60, 60 minutes", () => {
    const pause = createLlmPause();
    const lengths = [1, 2, 3, 4, 5, 6].map(() => minutes(t0, pause.trip("soft", "http_429", t0)));
    expect(lengths).toEqual([5, 10, 20, 40, 60, 60]);
  });

  test("isPaused is true before the end and false at the end", () => {
    const pause = createLlmPause();
    expect(pause.isPaused(t0)).toBe(false);
    const until = pause.trip("soft", "http_503", t0);
    expect(pause.isPaused(t0)).toBe(true);
    expect(pause.isPaused(new Date(until.getTime() - 1))).toBe(true);
    expect(pause.isPaused(until)).toBe(false);
  });

  test("reset gives the base length again", () => {
    const pause = createLlmPause();
    pause.trip("soft", "http_429", t0);
    pause.trip("soft", "http_429", t0);
    pause.reset();
    expect(minutes(t0, pause.trip("soft", "http_429", t0))).toBe(5);
  });

  test("pausedSince is the first trip of the run; only reset clears it (F109 stage 15)", () => {
    const pause = createLlmPause();
    expect(pause.pausedSince()).toBeNull();
    const second = new Date(t0.getTime() + 5 * MINUTE_MS);
    pause.trip("soft", "http_429", t0);
    pause.trip("soft", "http_429", second);
    expect(pause.pausedSince()).toEqual(t0);
    // The pause ended and nothing was reset: the run goes on.
    expect(pause.isPaused(new Date(t0.getTime() + HOUR_MS))).toBe(false);
    expect(pause.pausedSince()).toEqual(t0);
    pause.reset();
    expect(pause.pausedSince()).toBeNull();
    pause.trip("soft", "http_429", second);
    expect(pause.pausedSince()).toEqual(second);
  });

  test("options change the base and the maximum", () => {
    const pause = createLlmPause({ baseMs: 1000, maxMs: 3000 });
    const lengths = [1, 2, 3, 4].map(() => pause.trip("soft", "timeout", t0).getTime() - t0.getTime());
    expect(lengths).toEqual([1000, 2000, 3000, 3000]);
  });

  test("a soft trip writes llm_paused as a warn event, a config trip llm_config_paused as an error event", () => {
    const pause = createLlmPause();
    const until = pause.trip("soft", "http_429", t0);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]).toEqual([
      "[triage]",
      `llm_paused code=http_429 wait_ms=300000 until=${until.toISOString()}`,
    ]);

    errorSpy.mockClear();
    pause.reset();
    const configUntil = pause.trip("config", "http_404", t0);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]).toEqual([
      "[triage]",
      `llm_config_paused code=http_404 wait_ms=300000 until=${configUntil.toISOString()}`,
    ]);
  });

  test("a config trip holds no hint text, only the code, the wait and the end time", () => {
    const pause = createLlmPause();
    pause.trip("config", "http_401", t0);
    const output = errorSpy.mock.calls.map((call: unknown[]) => call.map(String).join(" ")).join("\n");
    expect(output).toMatch(/^\[triage\] llm_config_paused code=http_401 wait_ms=300000 until=\S+$/);
    for (const hint of ["API_KEY", "MODEL_CLASSIFIER", "project", "billing"]) expect(output).not.toContain(hint);
  });

  test("the wait doubles on each trip in the line", () => {
    const pause = createLlmPause();
    pause.trip("soft", "http_503", t0);
    errorSpy.mockClear();
    pause.trip("soft", "http_503", t0);
    expect(String(errorSpy.mock.calls[0]?.[1])).toContain("wait_ms=600000");
  });

  test("pausedUntil is the end of the pause that runs, and null before and after it (the history check waits for it)", () => {
    const pause = createLlmPause();
    expect(pause.pausedUntil(t0)).toBeNull();
    const until = pause.trip("soft", "http_503", t0);
    expect(pause.pausedUntil(t0)).toEqual(until);
    expect(pause.pausedUntil(new Date(until.getTime() - 1))).toEqual(until);
    expect(pause.pausedUntil(until)).toBeNull();
  });
});
