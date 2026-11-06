import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { llmProviders } from "../../platform/llm";

import { createLlmPause } from "./pause";

const t0 = new Date("2026-11-05T12:00:00Z");
const minutes = (from: Date, to: Date): number => (to.getTime() - from.getTime()) / 60_000;

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

  test("options change the base and the maximum", () => {
    const pause = createLlmPause({ baseMs: 1000, maxMs: 3000 });
    const lengths = [1, 2, 3, 4].map(() => pause.trip("soft", "timeout", t0).getTime() - t0.getTime());
    expect(lengths).toEqual([1000, 2000, 3000, 3000]);
  });

  test("a soft trip writes one warn line, a config trip one error line", () => {
    const pause = createLlmPause({ configHint: llmProviders.gemini.configHint });
    const until = pause.trip("soft", "http_429", t0);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[1]).toBe(
      `LLM soft error http_429: triage paused for 5 min, until ${until.toISOString()}`
    );

    errorSpy.mockClear();
    pause.reset();
    const configUntil = pause.trip("config", "http_404", t0);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[1]).toBe(
      `LLM config error http_404: check GEMINI_API_KEY, GEMINI_MODEL_CLASSIFIER and the Google project (billing, region); triage paused for 5 min, until ${configUntil.toISOString()}`
    );
  });

  test("a config trip holds the hint of the provider", () => {
    const pause = createLlmPause({ configHint: "HINT" });
    const until = pause.trip("config", "http_401", t0);
    expect(errorSpy.mock.calls[0]?.[1]).toBe(
      `LLM config error http_401: HINT; triage paused for 5 min, until ${until.toISOString()}`
    );
  });

  test("a config trip without a hint holds the default text", () => {
    const pause = createLlmPause();
    pause.trip("config", "http_401", t0);
    expect(errorSpy.mock.calls[0]?.[1]).toContain(
      "LLM config error http_401: check the LLM API key, the classifier model and the provider project;"
    );
  });
});
