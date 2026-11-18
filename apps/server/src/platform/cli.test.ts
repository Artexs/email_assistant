import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { createCliOutput } from "./cli";
import { setLogFormat, setLogLevel } from "./log";

describe("createCliOutput", () => {
  let logSpy: ReturnType<typeof spyOn<Console, "log">>;
  let errorSpy: ReturnType<typeof spyOn<Console, "error">>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    setLogLevel("info");
    setLogFormat("text");
  });

  test("print goes to console.log and fail to console.error, with the name prefix", () => {
    const out = createCliOutput("rules");
    out.print("added rule 3");
    out.fail("refused: x");
    expect(logSpy.mock.calls).toEqual([["[rules]", "added rule 3"]]);
    expect(errorSpy.mock.calls).toEqual([["[rules]", "refused: x"]]);
  });

  test("raw goes to console.log with no prefix", () => {
    createCliOutput("stats-week").raw("m3_total 4 hidden 2");
    expect(logSpy.mock.calls).toEqual([["m3_total 4 hidden 2"]]);
    expect(errorSpy.mock.calls).toEqual([]);
  });

  test("the log level and the log format do not change the output", () => {
    setLogLevel("error");
    setLogFormat("json");
    createCliOutput("rules").print("added rule 3");
    expect(logSpy.mock.calls).toEqual([["[rules]", "added rule 3"]]);
  });
});
