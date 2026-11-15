import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { createLog } from "../src/platform/log";

import { captureLogs, logProblems, type CapturedLogs } from "./log-capture";

const clean = `{"time":"2026-11-20T10:00:00.000Z","level":"info","module":"m","event":"a","msg":"a","count":1}`;

let capture: CapturedLogs | undefined;

afterEach(() => {
  capture?.stop();
  capture = undefined;
});

describe("log capture helper", () => {
  test("a clean line gives no problem", () => {
    expect(logProblems([clean], ["X-1"])).toEqual([]);
  });

  test("a planted value gives one problem that does not hold the value", () => {
    const line = `{"time":"t","level":"info","module":"m","event":"a","msg":"a","count":"X-1"}`;
    const problems = logProblems([line], ["X-1"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).not.toContain("X-1");
  });

  test("each rule gives one problem", () => {
    expect(logProblems(["not json"], [])).toHaveLength(1);
    expect(logProblems([`[1,2]`], [])).toHaveLength(1);
    const unknownKey = logProblems([`{"event":"a","msg":"a","subject":"s"}`], []);
    expect(unknownKey).toHaveLength(1);
    expect(unknownKey[0]).toContain("subject");
    expect(logProblems([`{"event":"a","msg":"a","dropped_fields":1}`], [])).toHaveLength(1);
    expect(logProblems([`{"event":"log_call_invalid","msg":"log_call_invalid"}`], [])).toHaveLength(1);
    expect(logProblems([`{"event":"a","msg":"free text"}`], [])).toHaveLength(1);
  });

  test("captureLogs captures JSON lines until stop", () => {
    capture = captureLogs();
    createLog("m").info("a");
    expect(capture.lines).toHaveLength(1);
    expect(JSON.parse(capture.lines[0] ?? "")).toMatchObject({ module: "m", event: "a", msg: "a", level: "info" });
    expect(logProblems(capture.lines, [])).toEqual([]);
    const { lines } = capture;
    capture.stop();
    capture = undefined;
    const after = spyOn(console, "log").mockImplementation(() => undefined);
    try {
      createLog("m").info("b");
      expect(after).toHaveBeenCalledTimes(1);
      expect(after.mock.calls[0]?.map(String).join(" ")).toBe("[m] b");
    } finally {
      after.mockRestore();
    }
    expect(lines).toHaveLength(1);
  });

  test("captureLogs takes the level and orders stdout and stderr lines", () => {
    capture = captureLogs({ level: "warn" });
    const log = createLog("m");
    log.debug("hidden");
    log.warn("w");
    log.error("e");
    expect(capture.lines.map((line) => (JSON.parse(line) as { event: string }).event)).toEqual(["w", "e"]);
  });
});
