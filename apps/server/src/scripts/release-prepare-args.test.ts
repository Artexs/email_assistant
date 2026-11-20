import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseReleasePrepareArgs } from "./release-prepare-args";

describe("parseReleasePrepareArgs", () => {
  test("a version alone gets today's date and the current folder", () => {
    expect(parseReleasePrepareArgs(["0.4.3"])).toEqual({ version: "0.4.3", date: null, root: "." });
  });

  test("--date and --root are read", () => {
    expect(parseReleasePrepareArgs(["0.4.3", "--date", "2026-11-21", "--root", "x"])).toEqual({
      version: "0.4.3",
      date: "2026-11-21",
      root: "x",
    });
  });

  test.each([
    ["no version", []],
    ["a version with a v", ["v0.4.3"]],
    ["two versions", ["0.4.3", "0.4.4"]],
    ["a date that is not a date", ["0.4.3", "--date", "today"]],
    ["an empty root", ["0.4.3", "--root", ""]],
  ])("%s throws a usage error", (_name, argv) => {
    expect(() => parseReleasePrepareArgs(argv)).toThrow(UsageError);
  });

  test("an unknown flag throws a parse error that runCli maps to exit 2", () => {
    expect(() => parseReleasePrepareArgs(["0.4.3", "--force"])).toThrow(
      expect.objectContaining({ code: "ERR_PARSE_ARGS_UNKNOWN_OPTION" })
    );
  });
});
