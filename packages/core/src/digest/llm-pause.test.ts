import { describe, expect, test } from "bun:test";

import { textTables } from "../texts";

import { llmPauseLine } from "./llm-pause";

const now = new Date("2026-11-20T10:00:00Z");

describe("llmPauseLine", () => {
  test.each([
    [
      "a spent quota says so in words",
      "http_429_quota",
      "2026-11-20T09:05:00Z",
      "⏸ LLM paused since 10:05: the provider quota or budget is spent (http_429_quota). Triage waits.",
    ],
    [
      "another code gets the generic line with the code",
      "timeout",
      "2026-11-20T09:05:00Z",
      "⏸ LLM paused since 10:05 (timeout). Triage waits.",
    ],
    [
      "a start on another day shows the day",
      "http_401",
      "2026-11-19T09:05:00Z",
      "⏸ LLM paused since 19 Nov 10:05 (http_401). Triage waits.",
    ],
  ])("%s", (_name, code, since, line) => {
    const pause = { code, since: new Date(since) };
    expect(llmPauseLine(pause, "Europe/Warsaw", now, textTables.en)).toBe(line);
  });

  test("Polish: both lines, with one colon at most besides the clock", () => {
    const quota = llmPauseLine(
      { code: "http_429_quota", since: new Date("2026-11-20T09:05:00Z") },
      "Europe/Warsaw",
      now,
      textTables.pl
    );
    expect(quota).toBe(
      "⏸ Klasyfikacja AI wstrzymana od 10:05. Wyczerpał się limit lub budżet u dostawcy (http_429_quota). Wiadomości czekają."
    );
    const other = llmPauseLine(
      { code: "timeout", since: new Date("2026-11-20T09:05:00Z") },
      "Europe/Warsaw",
      now,
      textTables.pl
    );
    expect(other).toBe("⏸ Klasyfikacja AI wstrzymana od 10:05 (timeout). Wiadomości czekają.");
  });
});
